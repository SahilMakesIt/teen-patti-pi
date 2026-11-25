import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, FIRESTORE_DATABASE_ID);

if (typeof window !== 'undefined') {
  isAnalyticsSupported()
    .then((ok) => {
      if (ok) getAnalytics(app);
    })
    .catch(() => {});
}

export async function ensureUserProfile(playerId, displayName) {
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
      soundEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

export function observeUserProfile(playerId, onProfile, onError) {
  const docRef = doc(db, 'users', playerId);
  return onSnapshot(
    docRef,
    (snap) => {
      onProfile(snap.exists() ? snap.data() : null);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function updateUserProfileFields(playerId, fields) {
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
        soundEnabled: updates.soundEnabled ?? true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      throw err;
    }
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
  const safeBoot = [50, 100, 200].includes(bootAmount) ? bootAmount : 100;
  const safeMax = Math.max(2, Math.min(5, maxPlayers));

  // Single-field equality query matching firestore.rules (zero composite indexes required)
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
  return onSnapshot(
    doc(db, 'rooms', normalizedCode),
    (snap) => {
      onRoom(snap.exists() ? snap.data() : null);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export function observeRoomSeats(playerId, roomCode, onSeats, onError) {
  const normalizedCode = roomCode.trim().toUpperCase();
  const q = query(
    collection(db, 'rooms', normalizedCode, 'seats'),
    where('memberUids', 'array-contains', playerId)
  );
  return onSnapshot(
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
}

export async function syncRoomAndSeats(roomCode, roomUpdates, seatUpdatesByUid) {
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
  const normalizedCode = roomCode.trim().toUpperCase();
  await updateDoc(doc(db, 'rooms', normalizedCode), {
    status: 'finished',
    matchmakingState: 'finished',
    bannerMessage: 'Table closed by host',
    updatedAt: serverTimestamp()
  });
}
