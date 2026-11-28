import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { STARTING_CHIPS } from '../engine/teenPattiEngine';

const firebaseConfig = {
  apiKey: 'AIzaSyBBsfGUIa4ZYcCvCx-FZU4pxjBMq15bjBQ',
  authDomain: 'teen-patti-pi.firebaseapp.com',
  databaseURL: 'https://teen-patti-pi-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'teen-patti-pi',
  storageBucket: 'teen-patti-pi.firebasestorage.app',
  messagingSenderId: '1066539831175',
  appId: '1:1066539831175:web:0b9e4951742ce86c2ecd22',
  measurementId: 'G-DLELKMLGTK'
};

export const FIRESTORE_DATABASE_ID = 'ai-studio-android-teenpatt-40f016a0-2258-4001-a4b3-a545bea9020f';
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LdenDYuAAAAAFQIc4tfpfLCYfL1BjGjroscht0X';

const app = initializeApp(firebaseConfig);

if (typeof window !== 'undefined') {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}

const auth = getAuth(app);
const db = getFirestore(app, FIRESTORE_DATABASE_ID);

let authReadyPromise = null;
export function ensureFirebaseAuth() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!authReadyPromise) {
    authReadyPromise = signInAnonymously(auth)
      .then((cred) => cred.user)
      .catch((err) => {
        authReadyPromise = null;
        throw err;
      });
  }
  return authReadyPromise;
}

if (typeof window !== 'undefined') {
  ensureFirebaseAuth().catch(() => {});
  isAnalyticsSupported()
    .then((ok) => {
      if (ok) getAnalytics(app);
    })
    .catch(() => {});
}

export async function ensureUserProfile(playerId, displayName) {
  await ensureFirebaseAuth();
  const docRef = doc(db, 'users', playerId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    const safeDisplay = (displayName || 'Pioneer_1').trim().slice(0, 40) || 'Pioneer_1';
    const safePioneer = (displayName || 'Pioneer_1').trim().slice(0, 30) || 'Pioneer_1';
    await setDoc(docRef, {
      userId: playerId,
      displayName: safeDisplay,
      pioneerName: safePioneer,
      piVerified: false,
      chipsBalance: STARTING_CHIPS,
      handsPlayed: 0,
      handsWon: 0,
      totalGiftsSent: 0,
      totalGiftsReceived: 0,
      soundEnabled: true,
      hideBalance: false,
      adHistory: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

export function observeUserProfile(playerId, onProfile, onError) {
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseAuth()
    .then(() => {
      if (cancelled) return;
      const docRef = doc(db, 'users', playerId);
      unsubscribe = onSnapshot(
        docRef,
        (snap) => {
          onProfile(snap.exists() ? snap.data() : null);
        },
        (err) => {
          if (onError) onError(err);
        }
      );
    })
    .catch((err) => {
      if (onError) onError(err);
    });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function updateUserProfileFields(playerId, fields, adminEvent = null) {
  await ensureFirebaseAuth();
  const docRef = doc(db, 'users', playerId);
  const updates = { updatedAt: serverTimestamp() };
  if (fields.pioneerName !== undefined) {
    const clean = (fields.pioneerName || 'Pioneer_1').trim().slice(0, 30) || 'Pioneer_1';
    updates.pioneerName = clean;
    updates.displayName = clean;
  }
  if (fields.piVerified !== undefined) updates.piVerified = Boolean(fields.piVerified);
  if (fields.chipsBalance !== undefined) updates.chipsBalance = Math.max(0, Math.floor(fields.chipsBalance));
  if (fields.handsPlayed !== undefined) updates.handsPlayed = Math.max(0, Math.floor(fields.handsPlayed));
  if (fields.handsWon !== undefined) updates.handsWon = Math.max(0, Math.floor(fields.handsWon));
  if (fields.soundEnabled !== undefined) updates.soundEnabled = Boolean(fields.soundEnabled);
  if (fields.hideBalance !== undefined) updates.hideBalance = Boolean(fields.hideBalance);
  if (Array.isArray(fields.adHistory)) updates.adHistory = fields.adHistory;

  try {
    await updateDoc(docRef, updates);
  } catch (err) {
    if (err?.code === 'not-found') {
      const cleanName = updates.pioneerName || 'Pioneer_1';
      await setDoc(docRef, {
        userId: playerId,
        displayName: cleanName,
        pioneerName: cleanName,
        piVerified: updates.piVerified ?? false,
        chipsBalance: updates.chipsBalance ?? STARTING_CHIPS,
        handsPlayed: updates.handsPlayed ?? 0,
        handsWon: updates.handsWon ?? 0,
        totalGiftsSent: 0,
        totalGiftsReceived: 0,
        soundEnabled: updates.soundEnabled ?? true,
        hideBalance: updates.hideBalance ?? false,
        adHistory: updates.adHistory ?? [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      throw err;
    }
  }

  if (adminEvent) {
    await setDoc(doc(collection(db, 'admin_logs')), {
      userId: playerId,
      ...adminEvent,
      chipsBalanceAfter: updates.chipsBalance ?? null,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp()
    });
  }
}

export async function createOnlineRoom({
  playerId,
  roomCode,
  hostName,
  bootAmount,
  maxPlayers,
  hostChips,
  piVerified,
  isPublic
}) {
  await ensureFirebaseAuth();
  const normalizedCode = roomCode.trim().toUpperCase();
  const safeBoot = [50, 100, 200].includes(bootAmount) ? bootAmount : 100;
  const safeMax = Math.max(2, Math.min(5, maxPlayers));
  const safeName = (hostName || 'Pioneer_1').trim().slice(0, 30) || 'Pioneer_1';

  const roomRef = doc(db, 'rooms', normalizedCode);
  const seatRef = doc(db, 'rooms', normalizedCode, 'seats', playerId);
  const batch = writeBatch(db);

  batch.set(roomRef, {
    hostId: playerId,
    roomCode: normalizedCode,
    status: 'waiting',
    isPublic: Boolean(isPublic),
    matchmakingState: isPublic ? 'public_waiting' : 'private',
    bootAmount: safeBoot,
    maxPlayers: safeMax,
    memberUids: [playerId],
    pot: 0,
    currentBlindStake: safeBoot,
    turnIndex: 0,
    dealerIndex: 0,
    roundCount: 1,
    handNumber: 0,
    bannerMessage: `Waiting for real players: 1/${safeMax} joined...`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(seatRef, {
    userId: playerId,
    seatIndex: 0,
    displayName: safeName,
    chips: Math.max(0, Math.floor(hostChips)),
    status: 'ACTIVE_BLIND',
    cards: [],
    totalBetInHand: 0,
    piVerified: Boolean(piVerified),
    memberUids: [playerId],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  return normalizedCode;
}

export async function joinOnlineRoom({
  playerId,
  roomCode,
  playerName,
  playerChips,
  piVerified
}) {
  await ensureFirebaseAuth();
  const normalizedCode = roomCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(normalizedCode)) {
    throw new Error('Enter a valid 6-digit invite code.');
  }

  const roomRef = doc(db, 'rooms', normalizedCode);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) {
    throw new Error(`Table code ${normalizedCode} not found.`);
  }

  const room = roomSnap.data();
  const members = Array.isArray(room.memberUids) ? room.memberUids : [];
  if (members.includes(playerId)) {
    return normalizedCode;
  }
  if (room.status !== 'waiting') {
    throw new Error('This table is already in progress or closed.');
  }
  if (members.length >= room.maxPlayers) {
    throw new Error('This table is already full.');
  }

  const newMembers = [...members, playerId];
  const safeName = (playerName || 'Pioneer_1').trim().slice(0, 30) || 'Pioneer_1';
  const seatIndex = members.length;

  await updateDoc(roomRef, {
    memberUids: newMembers,
    bannerMessage: `Waiting for real players: ${newMembers.length}/${room.maxPlayers} joined...`,
    updatedAt: serverTimestamp()
  });

  const seatRef = doc(db, 'rooms', normalizedCode, 'seats', playerId);
  await setDoc(seatRef, {
    userId: playerId,
    seatIndex,
    displayName: safeName,
    chips: Math.max(0, Math.floor(playerChips)),
    status: 'ACTIVE_BLIND',
    cards: [],
    totalBetInHand: 0,
    piVerified: Boolean(piVerified),
    memberUids: newMembers,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const existingSeatsSnap = await getDocs(collection(db, 'rooms', normalizedCode, 'seats'));
  const batch = writeBatch(db);
  let hasUpdates = false;
  existingSeatsSnap.forEach((seatDoc) => {
    if (seatDoc.id !== playerId) {
      hasUpdates = true;
      batch.update(seatDoc.ref, {
        memberUids: newMembers,
        updatedAt: serverTimestamp()
      });
    }
  });
  if (hasUpdates) {
    await batch.commit();
  }

  return normalizedCode;
}

export async function findOrCreatePublicRoom({
  playerId,
  playerName,
  bootAmount,
  maxPlayers,
  playerChips,
  piVerified,
  fallbackRoomCode
}) {
  await ensureFirebaseAuth();
  const safeBoot = [50, 100, 200].includes(bootAmount) ? bootAmount : 100;
  const safeMax = Math.max(2, Math.min(5, maxPlayers));

  const q = query(
    collection(db, 'rooms'),
    where('matchmakingState', '==', 'public_waiting'),
    limit(20)
  );
  const snap = await getDocs(q);
  const candidate = snap.docs
    .map((d) => d.data())
    .find(
      (room) =>
        room.status === 'waiting' &&
        room.bootAmount === safeBoot &&
        room.maxPlayers === safeMax &&
        (room.memberUids?.includes(playerId) || (room.memberUids?.length || 0) < safeMax)
    );

  if (candidate) {
    try {
      await joinOnlineRoom({
        playerId,
        roomCode: candidate.roomCode,
        playerName,
        playerChips,
        piVerified
      });
      return candidate.roomCode;
    } catch (_err) {
      // Fall through to creating a fresh room if candidate filled concurrently
    }
  }

  return createOnlineRoom({
    playerId,
    roomCode: fallbackRoomCode,
    hostName: playerName,
    bootAmount: safeBoot,
    maxPlayers: safeMax,
    hostChips: playerChips,
    piVerified,
    isPublic: true
  });
}

export function observeRoom(roomCode, onRoom, onError) {
  const normalizedCode = roomCode.trim().toUpperCase();
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseAuth()
    .then(() => {
      if (cancelled) return;
      unsubscribe = onSnapshot(
        doc(db, 'rooms', normalizedCode),
        (snap) => {
          onRoom(snap.exists() ? snap.data() : null);
        },
        (err) => {
          if (onError) onError(err);
        }
      );
    })
    .catch((err) => {
      if (onError) onError(err);
    });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export function observeRoomSeats(playerId, roomCode, onSeats, onError) {
  const normalizedCode = roomCode.trim().toUpperCase();
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseAuth()
    .then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, 'rooms', normalizedCode, 'seats'),
        where('memberUids', 'array-contains', playerId)
      );
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          const seats = snap.docs
            .map((d) => d.data())
            .sort((a, b) => (a.seatIndex || 0) - (b.seatIndex || 0));
          onSeats(seats);
        },
        (err) => {
          if (onError) onError(err);
        }
      );
    })
    .catch((err) => {
      if (onError) onError(err);
    });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function syncRoomAndSeats(roomCode, roomUpdates, seatUpdatesByUid) {
  await ensureFirebaseAuth();
  const normalizedCode = roomCode.trim().toUpperCase();
  const roomRef = doc(db, 'rooms', normalizedCode);
  const batch = writeBatch(db);

  const cleanRoom = { updatedAt: serverTimestamp() };
  Object.entries(roomUpdates || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) cleanRoom[k] = v;
  });
  batch.update(roomRef, cleanRoom);

  Object.entries(seatUpdatesByUid || {}).forEach(([seatUid, fields]) => {
    const cleanSeat = { updatedAt: serverTimestamp() };
    Object.entries(fields || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined) cleanSeat[k] = v;
    });
    batch.update(doc(db, 'rooms', normalizedCode, 'seats', seatUid), cleanSeat);
  });

  await batch.commit();
}

export async function closeOnlineRoom(roomCode) {
  await ensureFirebaseAuth();
  const normalizedCode = roomCode.trim().toUpperCase();
  await updateDoc(doc(db, 'rooms', normalizedCode), {
    status: 'finished',
    matchmakingState: 'finished',
    bannerMessage: 'Table closed by host',
    updatedAt: serverTimestamp()
  });
}

const MAX_DAILY_GIFT_CHIPS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function giftChipsToFriend(senderUid, recipientInput, rawAmount) {
  await ensureFirebaseAuth();
  const cleanRecipient = String(recipientInput || '').trim().replace(/^@/, '');
  const amount = Math.floor(Number(rawAmount));

  if (!senderUid) throw new Error('Player session not ready.');
  if (!cleanRecipient) throw new Error("Enter your friend's Pi username or Player ID.");
  if (!Number.isFinite(amount) || amount < 100 || amount > MAX_DAILY_GIFT_CHIPS) {
    throw new Error('Gift amount must be between 100 and 50,000 chips.');
  }

  let recipientUid = null;
  let recipientName = cleanRecipient;

  const directSnap = await getDoc(doc(db, 'users', cleanRecipient));
  if (directSnap.exists()) {
    recipientUid = directSnap.id;
    recipientName = directSnap.data().pioneerName || cleanRecipient;
  } else {
    const q = query(
      collection(db, 'users'),
      where('pioneerName', '==', cleanRecipient),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      recipientUid = snap.docs[0].id;
      recipientName = snap.docs[0].data().pioneerName || cleanRecipient;
    }
  }

  if (!recipientUid) {
    throw new Error(`Player "${cleanRecipient}" not found. Ask them to open the game once first.`);
  }
  if (recipientUid === senderUid) {
    throw new Error('You cannot send chips to your own account.');
  }

  const cutoffMs = Date.now() - DAY_MS;

  // 1. Check sender's rolling 24-hour sent limit (max 50,000)
  const sentSnap = await getDocs(
    query(collection(db, 'gift_transfers'), where('senderUid', '==', senderUid))
  );
  const sentLast24h = sentSnap.docs.reduce((sum, d) => {
    const data = d.data();
    return (data.createdAtMs || 0) >= cutoffMs ? sum + Number(data.amount || 0) : sum;
  }, 0);

  if (sentLast24h + amount > MAX_DAILY_GIFT_CHIPS) {
    const remainingSend = Math.max(0, MAX_DAILY_GIFT_CHIPS - sentLast24h);
    throw new Error(
      `24h send limit (50,000) reached. You can send ${remainingSend.toLocaleString('en-US')} more chips right now.`
    );
  }

  // 2. Check recipient's rolling 24-hour received limit (max 50,000)
  const receivedSnap = await getDocs(
    query(collection(db, 'gift_transfers'), where('recipientUid', '==', recipientUid))
  );
  const receivedLast24h = receivedSnap.docs.reduce((sum, d) => {
    const data = d.data();
    return (data.createdAtMs || 0) >= cutoffMs ? sum + Number(data.amount || 0) : sum;
  }, 0);

  if (receivedLast24h + amount > MAX_DAILY_GIFT_CHIPS) {
    const remainingReceive = Math.max(0, MAX_DAILY_GIFT_CHIPS - receivedLast24h);
    throw new Error(
      `${recipientName} can only receive ${remainingReceive.toLocaleString('en-US')} more chips in the next 24h.`
    );
  }

  const senderRef = doc(db, 'users', senderUid);
  const recipientRef = doc(db, 'users', recipientUid);
  const transferRef = doc(collection(db, 'gift_transfers'));
  const adminLogRef = doc(collection(db, 'admin_logs'));

  const newSenderBalance = await runTransaction(db, async (tx) => {
    const senderSnap = await tx.get(senderRef);
    const recipientSnap = await tx.get(recipientRef);

    if (!senderSnap.exists()) throw new Error('Sender profile not found.');
    if (!recipientSnap.exists()) throw new Error('Friend profile not found.');

    const senderData = senderSnap.data();
    const recipientData = recipientSnap.data();
    const senderChips = Number(senderData.chipsBalance || 0);
    const recipientChips = Number(recipientData.chipsBalance || 0);

    if (senderChips < amount) {
      throw new Error(`Insufficient chips. You have ${senderChips.toLocaleString('en-US')}.`);
    }

    const updatedSender = senderChips - amount;
    const updatedRecipient = recipientChips + amount;
    const nowMs = Date.now();

    tx.update(senderRef, {
      chipsBalance: updatedSender,
      totalGiftsSent: increment(amount),
      updatedAt: serverTimestamp()
    });

    tx.update(recipientRef, {
      chipsBalance: updatedRecipient,
      totalGiftsReceived: increment(amount),
      updatedAt: serverTimestamp()
    });

    tx.set(transferRef, {
      senderUid,
      senderName: senderData.pioneerName || senderUid,
      recipientUid,
      recipientName,
      amount,
      status: 'completed',
      createdAtMs: nowMs,
      createdAt: serverTimestamp()
    });

    tx.set(adminLogRef, {
      type: 'GIFT_TRANSFER',
      senderUid,
      senderName: senderData.pioneerName || senderUid,
      recipientUid,
      recipientName,
      amount,
      senderBalanceAfter: updatedSender,
      recipientBalanceAfter: updatedRecipient,
      createdAtMs: nowMs,
      createdAt: serverTimestamp()
    });

    return updatedSender;
  });

  return { newSenderBalance, recipientName, amount };
}
