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
import { PiProfileModal, RefillChipsModal, RulesModal } from './components/Modals';
import { TableView } from './components/TableView';

const FOUNDER_PI_USERNAME = 'Bilalrehmanbajwa';
const FOUNDER_PLAYER_ID = 'pioneer_8462_eu69uysf';
const FOUNDER_DEFAULT_CHIPS = 100_000_000_000;
const VIDEO_REWARD_CHIPS = 2000;

export function formatVisiblePiUsername(rawName) {
  const clean = String(rawName || '').trim().replace(/^@/, '');
  if (!clean) return 'PiUser';
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}***`;
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
    name: formatVisiblePiUsername(doc.displayName || 'PiUser'),
    fullName: doc.displayName || 'PiUser',
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
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState({
    playerId: guest.playerId,
    pioneerName: '',
    isPiVerified: false,
    chipsBalance: STARTING_CHIPS,
    handsPlayed: 0,
    handsWon: 0,
    soundEnabled: true,
    hideBalance: false,
    adHistory: [],
  });
  const [piStatusMessage, setPiStatusMessage] = useState('Connecting to Pi Browser...');
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
  const [isPiModalOpen, setIsPiModalOpen] = useState(false);
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

  // Require Pi Browser authentication and lock real Pi username permanently
  useEffect(() => {
    let unsubProfile = null;
    let active = true;

    (async () => {
      setIsPiConnecting(true);
      const piResult = await authenticateWithPi();
      if (!active) return;

      if (!piResult.isPiAuthenticated || !piResult.username) {
        setIsPiConnecting(false);
        setAuthChecked(true);
        setPiStatusMessage('Please open this app inside Pi Browser to sign in.');
        return;
      }

      const verifiedUsername = String(piResult.username).trim().replace(/^@/, '');
      const stableId = piResult.uid || guest.playerId;
      const isFounder =
        verifiedUsername.toLowerCase() === FOUNDER_PI_USERNAME.toLowerCase() ||
        stableId === FOUNDER_PLAYER_ID;

      try {
        await ensureUserProfile(stableId, verifiedUsername);
      } catch (_err) {
        // Offline fallback
      }

      setProfile((prev) => ({
        ...prev,
        playerId: stableId,
        pioneerName: verifiedUsername,
        isPiVerified: true,
        chipsBalance: isFounder ? Math.max(prev.chipsBalance, FOUNDER_DEFAULT_CHIPS) : prev.chipsBalance,
      }));
      setPiStatusMessage(piResult.environmentLabel || 'Pi Browser Verified');
      setIsPiConnecting(false);
      setAuthChecked(true);

      updateUserProfileFields(stableId, {
        pioneerName: verifiedUsername,
        username: verifiedUsername,
        usernameLocked: true,
        piVerified: true,
      }).catch(() => {});

      unsubProfile = observeUserProfile(
        stableId,
        (doc) => {
          if (!active || !doc) return;
          const rawChips = Number(doc.chipsBalance ?? STARTING_CHIPS);
          const effectiveChips =
            isFounder && rawChips < FOUNDER_DEFAULT_CHIPS ? FOUNDER_DEFAULT_CHIPS : rawChips;

          if (isFounder && rawChips < FOUNDER_DEFAULT_CHIPS) {
