import LegalPages from "./components/LegalPages";
import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Globe,
  HelpCircle,
  Play,
  PlusCircle,
  Bot,
  Users,
  Volume2,
  VolumeX,
  Wallet
} from 'lucide-react';
import { soundEffects } from './audio/soundEffects';
import { chooseBotAction } from './engine/botAi';
import {
  GAME_MODES,
  LOW_CHIPS_THRESHOLD,
  PLAYER_STATUS,
  STARTING_CHIPS,
  TABLE_PHASE,
  bet,
  callShow,
  createLocalBotTable,
  decodeCardCode,
  encodeCardCode,
  getCurrentPlayer,
  pack,
  seeCards,
  startNewHand,
  topUpPlayer
} from './engine/teenPattiEngine';
import {
  authenticateWithPi,
  createPiChipsPayment,
  getOrCreateGuestIdentity,
  watchRewardedAdForChips
} from './pi/piIntegration';
import {
  closeOnlineRoom,
  createOnlineRoom,
  ensureUserProfile,
  findOrCreatePublicRoom,
  giftChipsToFriend,
  joinOnlineRoom,
  observeRoom,
  observeRoomSeats,
  observeUserProfile,
  syncRoomAndSeats,
  updateUserProfileFields
} from './firebase/teenPattiFirebase';
import { RefillChipsModal, RulesModal } from './components/Modals';
import { TableView } from './components/TableView';

const FOUNDER_PI_USERNAME = 'Bilalrehmanbajwa';
const FOUNDER_PLAYER_ID = 'pioneer_8462_eu69uysf';
const FOUNDER_DEFAULT_CHIPS = 100_000_000_000;
const VIDEO_REWARD_CHIPS = 2000;

export function formatVisiblePiUsername(rawName) {
  const clean = String(rawName || '').trim().replace(/^@/, '');
  if (!clean) return 'PiUse****';
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}****`;
}

function generateSixDigitInviteCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generatePublicRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'PB';
  for (let i = 0; i < 4; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function mapRoomAndSeatsToTable(room, seats, fallbackMode) {
  const mappedSeats = (seats || []).map((doc) => ({
    id: doc.userId,
    seatIndex: Number(doc.seatIndex || 0),
    name: formatVisiblePiUsername(doc.displayName || doc.username || 'PiUser'),
    fullName: doc.displayName || doc.username || 'PiUser',
    isBot: false,
    chips: Number(doc.chips || 0),
    cards: (doc.cards || []).map(decodeCardCode).filter(Boolean),
    status: doc.status || PLAYER_STATUS.ACTIVE_BLIND,
    totalBetInHand: Number(doc.totalBetInHand || 0),
    lastActionLabel: doc.lastActionLabel || null,
    isPiVerified: Boolean(doc.piVerified),
    hideBalance: Boolean(doc.hideBalance),
  }));

  let phase = TABLE_PHASE.BETTING;
  if (room.status === 'waiting') phase = TABLE_PHASE.IDLE;
  else if (Array.isArray(room.winnerNames) && room.winnerNames.length > 0) phase = TABLE_PHASE.SHOWDOWN;

  const handResult =
    phase === TABLE_PHASE.SHOWDOWN && room.winnerNames?.length
      ? {
          winnerIds: [],
          winnerNames: room.winnerNames.map(formatVisiblePiUsername),
          potWon: Number(room.pot || 0),
          winningHandDescription: room.winningHandDescription || 'Winner takes pot',
          wonByShow: !String(room.winningHandDescription || '').toLowerCase().includes('packed')
        }
      : null;

  const resolvedMode = room.isPublic ? GAME_MODES.PUBLIC_LIVE : fallbackMode;

  return {
    mode: resolvedMode,
    roomCode: room.roomCode,
    hostId: room.hostId,
    isPublicRoom: Boolean(room.isPublic),
    maxPlayers: Number(room.maxPlayers || 3),
    bootAmount: Number(room.bootAmount || 100),
    pot: Number(room.pot || 0),
    currentBlindStake: Number(room.currentBlindStake || room.bootAmount || 100),
    dealerIndex: Number(room.dealerIndex || 0),
    currentTurnIndex: Math.min(
      Math.max(0, Number(room.turnIndex || 0)),
      Math.max(0, mappedSeats.length - 1)
    ),
    roundCount: Number(room.roundCount || 1),
    handNumber: Number(room.handNumber || 0),
    phase,
    players: mappedSeats,
    previousActiveSeatId: room.previousActiveSeatId || null,
    pendingSideshow: null,
    lastSideshowResolution: null,
    handResult,
    bannerMessage: room.bannerMessage || 'Waiting for players...'
  };
}

export default function App() {
  const path = window.location.pathname.toLowerCase();
  if (path === "/privacy") {
    return <LegalPages mode="privacy" onBack={() => (window.location.href = "/")} />;
  }
  if (path === "/terms") {
    return <LegalPages mode="terms" onBack={() => (window.location.href = "/")} />;
  }

  const guest = useRef(getOrCreateGuestIdentity()).current;

  const [screen, setScreen] = useState('LOBBY');
  const [profile, setProfile] = useState({
    playerId: guest.playerId,
    pioneerName: guest.username || 'PiUser',
    isPiVerified: false,
    chipsBalance: STARTING_CHIPS,
    handsPlayed: 0,
    handsWon: 0,
    soundEnabled: true,
    hideBalance: false,
    adHistory: [],
  });
  const [piStatusMessage, setPiStatusMessage] = useState(guest.environmentLabel || 'Pi Wallet Not Connected');
  const [isPiConnecting, setIsPiConnecting] = useState(false);

  const [selectedMode, setSelectedMode] = useState(GAME_MODES.VS_AUTO_BOT);
  const [playerCount, setPlayerCount] = useState(3);
  const [bootAmount, setBootAmount] = useState(100);
  const [joinRoomCodeInput, setJoinRoomCodeInput] = useState('');
  const [isRoomBusy, setIsRoomBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState(null);

  const [tableState, setTableState] = useState(null);
  const [dealtStage, setDealtStage] = useState(3);
  const [turnTimerProgress, setTurnTimerProgress] = useState(1);

  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [showWalletInfoBanner, setShowWalletInfoBanner] = useState(false);
  const [isRefillOpen, setIsRefillOpen] = useState(false);
  const [refillTargetId, setRefillTargetId] = useState(null);
  const [isAdRunning, setIsAdRunning] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(0);
  const [isPiPayBusy, setIsPiPayBusy] = useState(false);
  const [refillStatusMessage, setRefillStatusMessage] = useState(null);

  const lowPromptKeyRef = useRef(null);
  const adInFlightRef = useRef(false);
  const persistedHandRef = useRef(0);
  const autoStartKeyRef = useRef(null);
  const onlineRoomUnsubRef = useRef(null);
  const onlineSeatsUnsubRef = useRef(null);
  const latestRoomRef = useRef(null);
  const latestSeatsRef = useRef([]);

  const syncVerifiedPiUser = async (piResult) => {
    const cleanName = String(piResult?.username || '').trim().replace(/^@/, '');
    if (!piResult?.isPiAuthenticated || !cleanName) {
      return false;
    }

    const stableId = piResult.uid || profile.playerId || guest.playerId;
    const isFounder =
      cleanName.toLowerCase() === FOUNDER_PI_USERNAME.toLowerCase() ||
      stableId === FOUNDER_PLAYER_ID;

    try {
      await ensureUserProfile(stableId, cleanName);
    } catch (_err) {
      // Offline fallback
    }

    setProfile((prev) => ({
      ...prev,
      playerId: stableId,
      pioneerName: cleanName,
      isPiVerified: true,
      chipsBalance: isFounder ? Math.max(prev.chipsBalance, FOUNDER_DEFAULT_CHIPS) : prev.chipsBalance,
    }));
    setPiStatusMessage(piResult.environmentLabel || 'Pi Wallet Connected');
    setCloudMessage(null);

    updateUserProfileFields(stableId, {
      pioneerName: cleanName,
      username: cleanName,
      usernameLocked: true,
      piVerified: true,
    }).catch(() => {});

    return true;
  };

  useEffect(() => {
    let unsubProfile = null;
    let active = true;

    (async () => {
      try {
        await ensureUserProfile(guest.playerId, guest.username || 'PiUser');
      } catch (_err) {
        // Offline fallback
      }

      unsubProfile = observeUserProfile(
        guest.playerId,
        (doc) => {
          if (!active || !doc) return;
          const storedName = String(doc.username || doc.pioneerName || guest.username || 'PiUser').trim();
          const isFounder =
            storedName.toLowerCase() === FOUNDER_PI_USERNAME.toLowerCase() ||
            guest.playerId === FOUNDER_PLAYER_ID;
          const rawChips = Number(doc.chipsBalance ?? STARTING_CHIPS);
          const effectiveChips =
            isFounder && rawChips < FOUNDER_DEFAULT_CHIPS ? FOUNDER_DEFAULT_CHIPS : rawChips;

          if (isFounder && rawChips < FOUNDER_DEFAULT_CHIPS) {
            updateUserProfileFields(guest.playerId, {
              chipsBalance: FOUNDER_DEFAULT_CHIPS,
            }).catch(() => {});
          }

          soundEffects.enabled = doc.soundEnabled !== false;
          setProfile((prev) => ({
            ...prev,
            playerId: guest.playerId,
            pioneerName: prev.isPiVerified ? prev.pioneerName : storedName,
            chipsBalance: effectiveChips,
            handsPlayed: Number(doc.handsPlayed || 0),
            handsWon: Number(doc.handsWon || 0),
            soundEnabled: doc.soundEnabled !== false,
            hideBalance: Boolean(doc.hideBalance),
            adHistory: Array.isArray(doc.adHistory) ? doc.adHistory : [],
          }));
        },
        () => {}
      );

      try {
        const piResult = await authenticateWithPi();
        if (active && piResult?.isPiAuthenticated && piResult?.username) {
          await syncVerifiedPiUser(piResult);
        }
      } catch (_err) {
        // Do not block lobby if Pi auth fails on initial load; user can tap Connect Pi Wallet
      }
    })();

    return () => {
      active = false;
      if (unsubProfile) unsubProfile();
    };
  }, [guest.playerId, guest.username]);

  useEffect(() => {
    if (screen === 'LOBBY' && profile.chipsBalance < LOW_CHIPS_THRESHOLD) {
      const key = `lobby_${profile.chipsBalance}`;
      if (lowPromptKeyRef.current !== key) {
        lowPromptKeyRef.current = key;
        setRefillTargetId(null);
        setRefillStatusMessage(null);
        setIsRefillOpen(true);
      }
    }
  }, [screen, profile.chipsBalance]);

  const stopObservingOnlineRoom = () => {
    if (onlineRoomUnsubRef.current) {
      onlineRoomUnsubRef.current();
      onlineRoomUnsubRef.current = null;
    }
    if (onlineSeatsUnsubRef.current) {
      onlineSeatsUnsubRef.current();
      onlineSeatsUnsubRef.current = null;
    }
    latestRoomRef.current = null;
    latestSeatsRef.current = [];
  };

  useEffect(() => stopObservingOnlineRoom, []);

  const pushOnlineTableState = async (nextTable, syncCards = false) => {
    const code = nextTable.roomCode;
    if (!code) return;

    const roomUpdates = {
      status: nextTable.phase === TABLE_PHASE.IDLE ? 'waiting' : 'playing',
      matchmakingState:
        nextTable.phase === TABLE_PHASE.IDLE && nextTable.isPublicRoom ? 'public_waiting' : 'active',
      pot: nextTable.pot,
      currentBlindStake: nextTable.currentBlindStake,
      turnIndex: nextTable.currentTurnIndex,
      dealerIndex: nextTable.dealerIndex,
      roundCount: nextTable.roundCount,
      handNumber: nextTable.handNumber,
      bannerMessage: nextTable.bannerMessage,
      previousActiveSeatId: nextTable.previousActiveSeatId || ''
    };

    if (nextTable.phase === TABLE_PHASE.SHOWDOWN && nextTable.handResult) {
      roomUpdates.winnerNames = nextTable.handResult.winnerNames;
      roomUpdates.winningHandDescription = nextTable.handResult.winningHandDescription;
    } else if (syncCards) {
      roomUpdates.winnerNames = [];
      roomUpdates.winningHandDescription = '';
    }

    const seatUpdates = {};
    for (const seat of nextTable.players) {
      const sMap = {
        chips: seat.chips,
        status: seat.status,
        totalBetInHand: seat.totalBetInHand,
        lastActionLabel: seat.lastActionLabel || ''
      };
      if (syncCards) {
        sMap.cards = (seat.cards || []).map(encodeCardCode);
      }
      seatUpdates[seat.id] = sMap;
    }

    try {
      await syncRoomAndSeats(code, roomUpdates, seatUpdates);
    } catch (err) {
      setCloudMessage(err?.message || 'Failed to sync move');
    }
  };

  const startObservingRoom = (roomCode, fallbackMode) => {
    stopObservingOnlineRoom();
    autoStartKeyRef.current = null;

    const handleSnapshotUpdate = () => {
      const room = latestRoomRef.current;
      const seats = latestSeatsRef.current;
      if (!room) return;

      const mapped = mapRoomAndSeatsToTable(room, seats, fallbackMode);
      setTableState((prev) => {
        if (!prev || mapped.handNumber > prev.handNumber) {
          soundEffects.playCardDeal();
        }
        return mapped;
      });

      const autoKey = `${room.roomCode}_${room.handNumber}`;
      if (
        room.status === 'waiting' &&
        room.hostId === profile.playerId &&
        seats.length >= room.maxPlayers &&
        autoStartKeyRef.current !== autoKey
      ) {
        autoStartKeyRef.current = autoKey;
        const dealt = startNewHand(mapped);
        pushOnlineTableState(dealt, true);
      }
    };

    onlineRoomUnsubRef.current = observeRoom(
      roomCode,
      (room) => {
        latestRoomRef.current = room;
        handleSnapshotUpdate();
      },
      (err) => setCloudMessage(err?.message || `Lost connection to table ${roomCode}`)
    );

    onlineSeatsUnsubRef.current = observeRoomSeats(
      profile.playerId,
      roomCode,
      (seats) => {
        latestSeatsRef.current = seats;
        handleSnapshotUpdate();
      },
      (err) => setCloudMessage(err?.message || `Seat listener error on ${roomCode}`)
    );
  };

  useEffect(() => {
    if (screen !== 'TABLE' || !tableState || tableState.phase !== TABLE_PHASE.SHOWDOWN || !tableState.handResult) {
      return;
    }
    if (persistedHandRef.current === tableState.handNumber) return;
    persistedHandRef.current = tableState.handNumber;

    const isOnline = tableState.mode?.isOnline;
    const mySeat = isOnline
      ? tableState.players.find((p) => p.id === profile.playerId)
      : tableState.players[0];
    if (!mySeat) return;

    const iWon =
      tableState.handResult.winnerIds?.includes(mySeat.id) ||
      tableState.handResult.winnerNames?.includes(mySeat.name);
    if (iWon) soundEffects.playWinFanfare();

    const nextPlayed = profile.handsPlayed + 1;
    const nextWon = profile.handsWon + (iWon ? 1 : 0);

    setProfile((prev) => ({
      ...prev,
      chipsBalance: mySeat.chips,
      handsPlayed: nextPlayed,
      handsWon: nextWon
    }));

    updateUserProfileFields(profile.playerId, {
      chipsBalance: mySeat.chips,
      handsPlayed: nextPlayed,
      handsWon: nextWon
    }).catch(() => {});

    if (mySeat.chips < LOW_CHIPS_THRESHOLD) {
      const key = `table_${tableState.handNumber}_${mySeat.chips}`;
      if (lowPromptKeyRef.current !== key) {
        lowPromptKeyRef.current = key;
        setRefillTargetId(mySeat.id);
        setRefillStatusMessage(null);
        setIsRefillOpen(true);
      }
    }
  }, [screen, tableState, profile.playerId, profile.handsPlayed, profile.handsWon]);

  useEffect(() => {
    if (screen !== 'TABLE' || !tableState || tableState.phase !== TABLE_PHASE.BETTING) return undefined;
    const current = getCurrentPlayer(tableState);
    if (!current) return undefined;

    if (current.isBot) {
      setTurnTimerProgress(1);
      const timer = setTimeout(() => {
        const decision = chooseBotAction(tableState, current);
        let nextState = tableState;
        if (decision.type === 'SEE') {
          soundEffects.playCardFlip();
          nextState = seeCards(tableState, current.id);
        } else if (decision.type === 'BET') {
          soundEffects.playChipBet();
          nextState = bet(tableState, current.id, decision.isRaise);
        } else if (decision.type === 'PACK') {
          soundEffects.playPack();
          nextState = pack(tableState, current.id);
        } else if (decision.type === 'SHOW') {
          soundEffects.playCardFlip();
          nextState = callShow(tableState, current.id);
        }
        setTableState(nextState);
      }, 850);
      return () => clearTimeout(timer);
    }

    if (tableState.mode?.isOnline && current.id !== profile.playerId) {
      setTurnTimerProgress(1);
      return undefined;
    }

    const totalMs = 30000;
    const startedAt = Date.now();
    setTurnTimerProgress(1);
    const interval = setInterval(() => {
      if (isRulesOpen || isRefillOpen) return;
      const elapsed = Date.now() - startedAt;
      const ratio = Math.max(0, 1 - elapsed / totalMs);
      setTurnTimerProgress(ratio);
      if (ratio <= 0) {
        clearInterval(interval);
        soundEffects.playPack();
        const folded = pack(tableState, current.id);
        if (folded.mode?.isOnline) pushOnlineTableState(folded, false);
        else setTableState(folded);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [screen, tableState, profile.playerId, isRulesOpen, isRefillOpen]);

  const triggerDealAnim = () => {
    setDealtStage(0);
    setTimeout(() => {
      soundEffects.playCardDeal();
      setDealtStage(1);
    }, 90);
    setTimeout(() => {
      soundEffects.playCardDeal();
      setDealtStage(2);
    }, 190);
    setTimeout(() => {
      soundEffects.playCardDeal();
      setDealtStage(3);
    }, 300);
  };

  const handleToggleSound = () => {
    const next = !profile.soundEnabled;
    soundEffects.enabled = next;
    setProfile((prev) => ({ ...prev, soundEnabled: next }));
    updateUserProfileFields(profile.playerId, { soundEnabled: next }).catch(() => {});
  };

  const handleConnectPiWallet = async () => {
    if (isPiConnecting) return;
    setIsPiConnecting(true);
    setCloudMessage(null);
    try {
      const result = await authenticateWithPi();
      const connected = await syncVerifiedPiUser(result);
      if (!connected) {
        const msg = result?.errorMessage || result?.reason || 'Pi Wallet request failed. Open in Pi Browser and try again.';
        setPiStatusMessage(msg);
        setCloudMessage(msg);
      }
    } catch (err) {
      const msg = err?.message || 'Pi Wallet request failed.';
      setPiStatusMessage(msg);
      setCloudMessage(msg);
    } finally {
      setIsPiConnecting(false);
    }
  };

  const applyGrantedChips = async (amount, label) => {
    if (amount <= 0) return;
    soundEffects.playChipBet();

    if (screen === 'TABLE' && tableState) {
      const targetId =
        refillTargetId || (tableState.mode?.isOnline ? profile.playerId : tableState.players[0]?.id);
      if (targetId) {
        const updated = {
          ...topUpPlayer(tableState, targetId, amount),
          bannerMessage: `${label} added!`
        };
        if (updated.mode?.isOnline) {
          const seat = updated.players.find((p) => p.id === targetId);
          if (seat && updated.roomCode) {
            await syncRoomAndSeats(
              updated.roomCode,
              { bannerMessage: updated.bannerMessage },
              { [targetId]: { chips: seat.chips } }
            ).catch(() => {});
            if (targetId === profile.playerId) {
              setProfile((prev) => ({ ...prev, chipsBalance: seat.chips }));
              updateUserProfileFields(profile.playerId, { chipsBalance: seat.chips }).catch(() => {});
            }
          }
        } else {
          setTableState(updated);
          if (targetId === updated.players[0]?.id) {
            const nextChips = updated.players[0].chips;
            setProfile((prev) => ({ ...prev, chipsBalance: nextChips }));
            updateUserProfileFields(profile.playerId, { chipsBalance: nextChips }).catch(() => {});
          }
        }
        return;
      }
    }

    const nextChips = profile.chipsBalance + amount;
    setProfile((prev) => ({ ...prev, chipsBalance: nextChips }));
    updateUserProfileFields(profile.playerId, { chipsBalance: nextChips }).catch(() => {});
  };

  const handleWatchVideoAd = async () => {
    if (adInFlightRef.current || isAdRunning || isPiPayBusy) return;

    adInFlightRef.current = true;
    setIsAdRunning(true);
    setAdSecondsLeft(3);
    setRefillStatusMessage('Loading video...');

    try {
      const res = await watchRewardedAdForChips({
        onPreviewTick: (secs) => setAdSecondsLeft(secs)
      });

      if (res.granted && res.chips > 0) {
        const rewardChips = Math.min(Number(res.chips) || VIDEO_REWARD_CHIPS, VIDEO_REWARD_CHIPS);
        await applyGrantedChips(rewardChips, `Video (+${rewardChips.toLocaleString('en-US')} Chips)`);
        setRefillStatusMessage(`+${rewardChips.toLocaleString('en-US')} Play Chips granted!`);
      } else {
        setRefillStatusMessage(
          res.reason || 'Video closed before completion—watch until reward finishes.'
        );
      }
    } catch (err) {
      setRefillStatusMessage(err?.message || 'Unable to verify video reward.');
    } finally {
      adInFlightRef.current = false;
      setIsAdRunning(false);
      setAdSecondsLeft(0);
    }
  };

  const handleBuyPiChips = async (qty) => {
    if (isAdRunning || isPiPayBusy) return;
    setIsPiPayBusy(true);
    setRefillStatusMessage('Processing Pi Wallet checkout...');
    try {
      const res = await createPiChipsPayment({
        quantity: qty,
        playerId: profile.playerId,
        isPiConnected: profile.isPiVerified
      });
      if (res.completed && res.chipsGranted > 0) {
        await applyGrantedChips(res.chipsGranted, `Chip Store (+${res.chipsGranted.toLocaleString('en-US')} Chips)`);
      }
      setRefillStatusMessage(res.message);
    } catch (err) {
      setRefillStatusMessage(err?.message || 'Pi payment error.');
    } finally {
      setIsPiPayBusy(false);
    }
  };

  const handleGiftChips = async (recipientInput, amount) => {
    if (isAdRunning || isPiPayBusy) return;
    setRefillStatusMessage('Sending chips to friend...');
    const res = await giftChipsToFriend(profile.playerId, recipientInput, amount);
    setProfile((prev) => ({ ...prev, chipsBalance: res.newSenderBalance }));
    if (tableState && Array.isArray(tableState.players)) {
      const updatedPlayers = tableState.players.map((p) =>
        p.id === profile.playerId ? { ...p, chips: res.newSenderBalance } : p
      );
      setTableState((prev) => (prev ? { ...prev, players: updatedPlayers } : prev));
    }
    setRefillStatusMessage(
      `Sent ${res.amount.toLocaleString('en-US')} Play Chips to ${formatVisiblePiUsername(res.recipientName)}!`
    );
  };

  const handleEnterTable = async () => {
    setCloudMessage(null);
    persistedHandRef.current = 0;
    const maskedSelfName = formatVisiblePiUsername(profile.pioneerName);

    if (selectedMode.id === GAME_MODES.VS_AUTO_BOT.id) {
      const initial = createLocalBotTable({
        playerName: maskedSelfName,
        humanChips: profile.chipsBalance,
        bootAmount,
        humanIsPiVerified: profile.isPiVerified
      });
      const dealt = startNewHand(initial);
      setTableState(dealt);
      setScreen('TABLE');
      triggerDealAnim();
      return;
    }

    setIsRoomBusy(true);
    try {
      if (selectedMode.id === GAME_MODES.PUBLIC_LIVE.id) {
        const code = await findOrCreatePublicRoom({
          playerId: profile.playerId,
          playerName: maskedSelfName,
          bootAmount,
          maxPlayers: playerCount,
          playerChips: profile.chipsBalance,
          piVerified: profile.isPiVerified,
          fallbackRoomCode: generatePublicRoomCode()
        });
        setScreen('TABLE');
        startObservingRoom(code, GAME_MODES.PUBLIC_LIVE);
      } else {
        const code = generateSixDigitInviteCode();
        await createOnlineRoom({
          playerId: profile.playerId,
          roomCode: code,
          hostName: maskedSelfName,
          bootAmount,
          maxPlayers: playerCount,
          hostChips: profile.chipsBalance,
          piVerified: profile.isPiVerified,
          isPublic: false
        });
        setScreen('TABLE');
        startObservingRoom(code, GAME_MODES.INVITE_FRIENDS);
      }
    } catch (err) {
      setCloudMessage(err?.message || 'Unable to connect to Firebase table.');
    } finally {
      setIsRoomBusy(false);
    }
  };

  const handleJoinInviteCode = async () => {
    const code = joinRoomCodeInput.trim().toUpperCase();
    if (code.length < 4) {
      setCloudMessage("Enter a friend's 6-digit invite code.");
      return;
    }
    setIsRoomBusy(true);
    setCloudMessage(null);
    try {
      await joinOnlineRoom({
        playerId: profile.playerId,
        roomCode: code,
        playerName: formatVisiblePiUsername(profile.pioneerName),
        playerChips: profile.chipsBalance,
        piVerified: profile.isPiVerified
      });
      setScreen('TABLE');
      startObservingRoom(code, GAME_MODES.INVITE_FRIENDS);
    } catch (err) {
      setCloudMessage(err?.message || `Unable to join table ${code}`);
    } finally {
      setIsRoomBusy(false);
    }
  };

  const handleToggleHideBalance = () => {
    const next = !profile.hideBalance;
    setProfile((prev) => ({ ...prev, hideBalance: next }));
    updateUserProfileFields(profile.playerId, { hideBalance: next }).catch(() => {});
    if (screen === 'TABLE' && tableState?.mode?.isOnline && tableState.roomCode) {
      syncRoomAndSeats(tableState.roomCode, {}, { [profile.playerId]: { hideBalance: next } }).catch(() => {});
    }
  };

  const handleLeaveTable = () => {
    stopObservingOnlineRoom();
    if (tableState?.mode?.isOnline && tableState.roomCode && tableState.hostId === profile.playerId) {
      closeOnlineRoom(tableState.roomCode).catch(() => {});
    }
    setTableState(null);
    setScreen('LOBBY');
  };

  const applyPlayerAction = (nextTable) => {
    if (nextTable.mode?.isOnline) {
      pushOnlineTableState(nextTable, false);
    } else {
      setTableState(nextTable);
    }
  };

  const handleDealNextHand = () => {
    if (!tableState) return;
    if (tableState.mode?.isOnline) {
      if (tableState.players.length < 2 || tableState.hostId !== profile.playerId) return;
      const lowSeat = tableState.players.find((p) => p.chips < tableState.bootAmount);
      if (lowSeat) {
        setRefillTargetId(lowSeat.id);
        setIsRefillOpen(true);
        return;
      }
      const dealt = startNewHand(tableState);
      pushOnlineTableState(dealt, true);
      return;
    }

    const lowHuman = tableState.players.find((p) => !p.isBot && p.chips < tableState.bootAmount);
    if (lowHuman) {
      setRefillTargetId(lowHuman.id);
      setIsRefillOpen(true);
      return;
    }
    const dealt = startNewHand(tableState);
    setTableState(dealt);
    triggerDealAnim();
  };

  const visibleUsername = formatVisiblePiUsername(profile.pioneerName);
  const isAutoBot = selectedMode.id === GAME_MODES.VS_AUTO_BOT.id;

  return (
    <div className="app-shell">
      {screen === 'LOBBY' ? (
        <>
          <div className="lobby-scroll">
            <div className="top-brand-row">
              <h1 className="brand-title">TEEN PATTI</h1>
              <div className="icon-actions">
                <button className="icon-btn" onClick={() => setIsRulesOpen(true)} aria-label="Rules">
                  <HelpCircle size={20} />
                </button>
                <button
                  className="icon-btn"
                  style={{ color: profile.soundEnabled ? 'var(--gold)' : 'var(--text-secondary)' }}
                  onClick={handleToggleSound}
                  aria-label="Sound"
                >
                  {profile.soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
              </div>
            </div>

            <div className="wallet-actions-row">
              {profile.isPiVerified ? (
                <div className="pi-pill connected" style={{ cursor: 'default' }}>
                  <span className="dot-live" />
                  <CheckCircle2 size={15} />
                  <span className="pi-pill-text">Pi Wallet Connected • @{visibleUsername}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="pi-pill"
                  disabled={isPiConnecting}
                  onClick={handleConnectPiWallet}
                >
                  <Wallet size={15} color="#8B5CF6" />
                  <span className="pi-pill-text">
                    {isPiConnecting ? 'Connecting Pi Wallet...' : 'Connect Pi Wallet'}
                  </span>
                </button>
              )}

              <button
                type="button"
                className="get-chips-pill"
                onClick={() => {
                  setRefillTargetId(null);
                  setRefillStatusMessage(null);
                  setIsRefillOpen(true);
                }}
              >
                <PlusCircle size={15} />+ Get Chips
              </button>
            </div>

            {cloudMessage && <div className="error-banner">{cloudMessage}</div>}

            {showWalletInfoBanner && (
              <div className="notice-box" style={{ marginBottom: 10 }}>
                @{visibleUsername} • {profile.isPiVerified ? 'Pi Wallet Connected (Locked)' : piStatusMessage}
              </div>
            )}

            <div className="hero-banner">
              <div>
                <div className="hero-kicker">CLASSIC 3-CARD TEEN PATTI</div>
                <div className="hero-sub">Play Chips have zero monetary value. Entertainment only.</div>
              </div>
              <span className="profile-chip-btn" style={{ cursor: 'default' }}>
                @{visibleUsername}
              </button>
            </div>

            <div className="balance-card">
              <div className="balance-left">
                <div className="chip-emblem">₹</div>
                <div style={{ minWidth: 0 }}>
                  <div className="balance-label">@{visibleUsername} • Cloud Play Chips</div>
                  <div className="balance-value">{profile.chipsBalance.toLocaleString('en-US')}</div>
                </div>
              </div>
              <div className="balance-right">
                <div className="won-badge">
                  {profile.handsWon}/{profile.handsPlayed} Won
                </div>
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Select Table Mode</div>
              <div className="modes-grid">
                {[GAME_MODES.VS_AUTO_BOT, GAME_MODES.PUBLIC_LIVE, GAME_MODES.INVITE_FRIENDS].map((mode) => {
                  const selected = selectedMode.id === mode.id;
                  const IconComp =
                    mode.id === GAME_MODES.VS_AUTO_BOT.id
                      ? Bot
                      : mode.id === GAME_MODES.PUBLIC_LIVE.id
                        ? Globe
                        : Users;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`mode-card ${selected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedMode(mode);
                        setCloudMessage(null);
                      }}
                    >
                      <IconComp size={16} color={selected ? '#F2C94C' : '#A7B4C2'} />
                      <div className="mode-title">{mode.label}</div>
                      <div className="mode-sub">{mode.subtitle}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="section-block">
              <div className="section-head">
                <span className="section-title">Select Players (Table Size)</span>
                {isAutoBot && <span className="section-hint">1v1 vs Smart Auto Bot</span>}
              </div>
              <div className="pills-row cols-4">
                {[2, 3, 4, 5].map((count) => {
                  const effective = isAutoBot ? 2 : playerCount;
                  const active = effective === count;
                  const enabled = !isAutoBot || count === 2;
                  return (
                    <button
                      key={count}
                      type="button"
                      disabled={!enabled}
                      className={`pill-btn ${active ? 'active-gold' : ''}`}
                      onClick={() => setPlayerCount(count)}
                    >
                      {isAutoBot && count === 2 ? '2 (1v1)' : `${count} Players`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Boot Amount (Starting Bet per Hand)</div>
              <div className="pills-row cols-3">
                {[50, 100, 200].map((boot) => (
                  <button
                    key={boot}
                    type="button"
                    className={`pill-btn ${bootAmount === boot ? 'active-emerald' : ''}`}
                    onClick={() => setBootAmount(boot)}
                  >
                    {boot} Chips
                  </button>
                ))}
              </div>
            </div>

            {selectedMode.id === GAME_MODES.INVITE_FRIENDS.id && (
              <div className="invite-join-card">
                <div className="section-head">
                  <span className="section-title">Join with Code</span>
                  <span className="section-hint">Or Create Invite Table below</span>
                </div>
                <div className="invite-join-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="6-digit invite code"
                    className="code-input"
                    value={joinRoomCodeInput}
                    onChange={(e) =>
                      setJoinRoomCodeInput(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
                      )
                    }
                  />
                  <button
                    type="button"
                    className="join-btn"
                    disabled={
                      isRoomBusy ||
                      joinRoomCodeInput.length < 4 ||
                      profile.chipsBalance < bootAmount
                    }
                    onClick={handleJoinInviteCode}
                  >
                    Join
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="sticky-bottom-bar">
            <button
              type="button"
              className="primary-cta"
              disabled={isRoomBusy || profile.chipsBalance < bootAmount}
              onClick={handleEnterTable}
            >
              <Play size={18} fill="currentColor" />
              {isRoomBusy
                ? 'Connecting...'
                : selectedMode.id === GAME_MODES.VS_AUTO_BOT.id
                  ? 'Start vs Auto Bot (Deal Now)'
                  : selectedMode.id === GAME_MODES.PUBLIC_LIVE.id
                    ? `Join Public Live Table (${playerCount} Players)`
                    : `Create Invite Table (${playerCount} Players)`}
            </button>
          </div>
        </>
      ) : (
        tableState && (
          <TableView
            tableState={tableState}
            currentUserId={profile.playerId}
            soundEnabled={profile.soundEnabled}
            hideBalance={profile.hideBalance}
            onToggleHideBalance={handleToggleHideBalance}
            dealtStage={dealtStage}
            turnTimerProgress={turnTimerProgress}
            onLeaveTable={handleLeaveTable}
            onToggleSound={handleToggleSound}
            onOpenRules={() => setIsRulesOpen(true)}
            onOpenRefillDialog={(targetId) => {
              setRefillTargetId(targetId);
              setRefillStatusMessage(null);
              setIsRefillOpen(true);
            }}
            onSeeCards={() => {
              const player = getCurrentPlayer(tableState);
              if (!player || player.isBot) return;
              soundEffects.playCardFlip();
              applyPlayerAction(seeCards(tableState, player.id));
            }}
            onBet={(isRaise) => {
              const player = getCurrentPlayer(tableState);
              if (!player || player.isBot) return;
              soundEffects.playChipBet();
              applyPlayerAction(bet(tableState, player.id, isRaise));
            }}
            onPack={() => {
              const player = getCurrentPlayer(tableState);
              if (!player || player.isBot) return;
              soundEffects.playPack();
              applyPlayerAction(pack(tableState, player.id));
            }}
            onShow={() => {
              const player = getCurrentPlayer(tableState);
              if (!player || player.isBot) return;
              soundEffects.playCardFlip();
              applyPlayerAction(callShow(tableState, player.id));
            }}
            onDealNextHand={handleDealNextHand}
          />
        )
      )}

      {isRulesOpen && <RulesModal onDismiss={() => setIsRulesOpen(false)} />}

      {isRefillOpen && (
        <RefillChipsModal
          playerName={
            (refillTargetId && tableState?.players?.find((p) => p.id === refillTargetId)?.name) ||
            visibleUsername
          }
          currentChips={
            (refillTargetId && tableState?.players?.find((p) => p.id === refillTargetId)?.chips) ??
            profile.chipsBalance
          }
          isAdPreviewRunning={isAdRunning}
          adPreviewSecondsLeft={adSecondsLeft}
          isPiPaymentBusy={isPiPayBusy}
          statusMessage={refillStatusMessage}
          onWatchVideoAd={handleWatchVideoAd}
          onBuyPiChipsPack={handleBuyPiChips}
          onGiftChips={handleGiftChips}
          onDismiss={() => {
            if (!isAdRunning && !isPiPayBusy) setIsRefillOpen(false);
          }}
        />
      )}
    </div>
  );
}
