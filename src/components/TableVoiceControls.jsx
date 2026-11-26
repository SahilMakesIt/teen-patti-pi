import React, { useState, useRef, useEffect } from 'react';
import { getApps, initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  onValue,
  onChildAdded,
  push,
  remove,
  onDisconnect,
} from 'firebase/database';

const RTDB_CONFIG = {
  apiKey: 'AIzaSyBBsfGUIa4ZYcCvCx-FZU4pxjBMq15bjBQ',
  authDomain: 'teen-patti-pi.firebaseapp.com',
  databaseURL: 'https://teen-patti-pi-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'teen-patti-pi',
  storageBucket: 'teen-patti-pi.firebasestorage.app',
  messagingSenderId: '1066539831175',
  appId: '1:1066539831175:web:0b9e4951742ce86c2ecd22',
};

function getRtdb() {
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(RTDB_CONFIG);
  return getDatabase(app);
}

export default function TableVoiceControls({
  roomId,
  userId,
  isVoiceMutedByListener,
  onToggleListenerMute,
  onSpeakingChange,
}) {
  const [isHandsFree, setIsHandsFree] = useState(false);
  const [isHoldingMic, setIsHoldingMic] = useState(false);
  const [micError, setMicError] = useState('');
  const [peerCount, setPeerCount] = useState(0);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const loopTimerRef = useRef(null);
  const mutedRef = useRef(isVoiceMutedByListener);
  const isTransmittingRef = useRef(false);
  const joinedAtRef = useRef(Date.now());

  const isTransmitting = isHandsFree || isHoldingMic;
  isTransmittingRef.current = isTransmitting;

  useEffect(() => {
    mutedRef.current = isVoiceMutedByListener;
  }, [isVoiceMutedByListener]);

  // Unlock Android WebView audio playback on any user tap
  function unlockWebViewAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      }
    } catch (_e) {}
  }

  async function ensureMicStream() {
    if (streamRef.current && streamRef.current.active) {
      return streamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    streamRef.current = stream;
    setMicError('');
    return stream;
  }

  function stopActiveRecording() {
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch (_e) {}
    }
    recorderRef.current = null;
  }

  // Record & send audio clip ONLY while Hold to Talk is held OR Hands-Free is checked
  useEffect(() => {
    let cancelled = false;

    async function sendClipToRoom(blob) {
      if (!blob || blob.size < 400) return;
      if (!roomId || roomId === 'local' || !userId) return;

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64DataUrl = reader.result;
        if (typeof base64DataUrl !== 'string') return;
        const db = getRtdb();
        const cleanRoom = String(roomId).trim().toUpperCase();
        const clipsRef = ref(db, `voiceRooms/${cleanRoom}/clips`);
        push(clipsRef, {
          senderId: String(userId).trim(),
          audio: base64DataUrl,
          ts: Date.now(),
        }).catch(() => {});
      };
      reader.readAsDataURL(blob);
    }

    async function startClipCycle() {
      if (cancelled || !isTransmittingRef.current) return;

      try {
        const stream = await ensureMicStream();
        if (cancelled || !isTransmittingRef.current) return;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

        const chunks = [];
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })
          : new MediaRecorder(stream);

        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          sendClipToRoom(blob);
          // If Hands-Free is still checked, start the next 1.8s clip automatically
          if (!cancelled && isTransmittingRef.current && isHandsFree) {
            startClipCycle();
          }
        };

        recorder.start();

        // In Hands-Free mode, slice every 1.8s so the other phone hears near-real-time speech
        if (isHandsFree) {
          loopTimerRef.current = setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop();
            }
          }, 1800);
        }
      } catch (_err) {
        setMicError('Mic blocked');
        setIsHandsFree(false);
        setIsHoldingMic(false);
        onSpeakingChange?.(false);
      }
    }

    if (isTransmitting) {
      unlockWebViewAudio();
      onSpeakingChange?.(true);
      startClipCycle();
    } else {
      stopActiveRecording();
      onSpeakingChange?.(false);
    }

    return () => {
      cancelled = true;
      stopActiveRecording();
    };
  }, [isTransmitting, isHandsFree, roomId, userId]);

  // Listen for incoming voice clips from other players at the table
  useEffect(() => {
    if (!roomId || roomId === 'local' || !userId) {
      setPeerCount(0);
      return undefined;
    }

    const db = getRtdb();
    const cleanRoom = String(roomId).trim().toUpperCase();
    const cleanUser = String(userId).trim();
    joinedAtRef.current = Date.now();

    const myPresenceRef = ref(db, `voiceRooms/${cleanRoom}/peers/${cleanUser}`);
    const peersListRef = ref(db, `voiceRooms/${cleanRoom}/peers`);
    const clipsRef = ref(db, `voiceRooms/${cleanRoom}/clips`);

    set(myPresenceRef, { joinedAt: Date.now() }).catch(() => {});
    onDisconnect(myPresenceRef).remove().catch(() => {});

    const unsubPeers = onValue(peersListRef, (snap) => {
      const data = snap.val() || {};
      const others = Object.keys(data).filter((id) => id !== cleanUser);
      setPeerCount(others.length);
    });

    const unsubClips = onChildAdded(clipsRef, (snap) => {
      const clip = snap.val();
      if (!clip || !clip.audio) return;
      if (clip.senderId === cleanUser) return;
      if (clip.ts && clip.ts < joinedAtRef.current - 3000) return;

      // Auto-clean played clip from RTDB after 5 seconds
      setTimeout(() => {
        remove(snap.ref).catch(() => {});
      }, 5000);

      if (mutedRef.current) return;

      try {
        const audio = new Audio(clip.audio);
        audio.volume = 1.0;
        audio.play().catch(() => {});
      } catch (_e) {}
    });

    return () => {
      unsubPeers();
      unsubClips();
      remove(myPresenceRef).catch(() => {});
    };
  }, [roomId, userId]);

  useEffect(() => {
    return () => {
      stopActiveRecording();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        padding: '6px 10px',
        background: 'rgba(15, 23, 42, 0.78)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      <button
        type="button"
        disabled={isHandsFree}
        onMouseDown={() => {
          if (!isHandsFree) {
            unlockWebViewAudio();
            setIsHoldingMic(true);
          }
        }}
        onMouseUp={() => !isHandsFree && setIsHoldingMic(false)}
        onMouseLeave={() => !isHandsFree && setIsHoldingMic(false)}
        onTouchStart={(e) => {
          if (!isHandsFree) {
            e.preventDefault();
            unlockWebViewAudio();
            setIsHoldingMic(true);
          }
        }}
        onTouchEnd={() => !isHandsFree && setIsHoldingMic(false)}
        onTouchCancel={() => !isHandsFree && setIsHoldingMic(false)}
        style={{
          padding: '5px 11px',
          borderRadius: '8px',
          border: '1px solid rgba(242, 201, 76, 0.45)',
          background: isTransmitting ? '#16a34a' : '#1e293b',
          color: '#f8fafc',
          fontSize: '12px',
          fontWeight: 700,
          cursor: isHandsFree ? 'default' : 'pointer',
          userSelect: 'none',
        }}
      >
        {isTransmitting ? '🎙️ Speaking...' : '🎙️ Hold to Talk'}
      </button>

      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '12px',
          color: '#e2e8f0',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={isHandsFree}
          onChange={(e) => {
            unlockWebViewAudio();
            setIsHandsFree(e.target.checked);
            if (e.target.checked) setIsHoldingMic(false);
          }}
        />
        <span>Hands-Free</span>
      </label>

      <button
        type="button"
        onClick={() => {
          unlockWebViewAudio();
          onToggleListenerMute();
        }}
        title="Mute or unmute table voice without affecting game sounds"
        style={{
          padding: '5px 10px',
          borderRadius: '8px',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          background: isVoiceMutedByListener ? '#7f1d1d' : '#1e293b',
          color: '#f8fafc',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {isVoiceMutedByListener ? '🔇 Voice Muted' : '🔊 Voice On'}
      </button>

      {peerCount > 0 && (
        <span style={{ color: '#4ade80', fontSize: '11px', fontWeight: 700 }}>
          ● Voice Live ({peerCount + 1})
        </span>
      )}

      {micError && (
        <span style={{ color: '#f87171', fontSize: '11px' }}>{micError}</span>
      )}
    </div>
  );
}
