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

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
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
  const [voiceStatus, setVoiceStatus] = useState('Idle');

  const streamRef = useRef(null);
  const peersRef = useRef({});
  const audioElsRef = useRef({});
  const mutedRef = useRef(isVoiceMutedByListener);

  const isTransmitting = isHandsFree || isHoldingMic;

  useEffect(() => {
    mutedRef.current = isVoiceMutedByListener;
    Object.values(audioElsRef.current).forEach((el) => {
      if (el) {
        el.muted = Boolean(isVoiceMutedByListener);
        if (!isVoiceMutedByListener && el.paused) {
          el.play().catch(() => {});
        }
      }
    });
  }, [isVoiceMutedByListener]);

  function unlockAllRemoteAudio() {
    Object.values(audioElsRef.current).forEach((el) => {
      if (el && el.paused) {
        el.play().catch(() => {});
      }
    });
  }

  async function ensureMicStream() {
    if (streamRef.current) return streamRef.current;
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

  // Toggle local mic track enabled/disabled when speaking or hands-free
  useEffect(() => {
    let cancelled = false;

    async function syncMic() {
      if (isTransmitting) {
        unlockAllRemoteAudio();
        try {
          const stream = await ensureMicStream();
          if (cancelled) return;
          stream.getAudioTracks().forEach((t) => {
            t.enabled = true;
          });
          // Attach local track to any already-open peer connections
          Object.values(peersRef.current).forEach((pc) => {
            const senders = pc.getSenders();
            stream.getAudioTracks().forEach((track) => {
              if (!senders.some((s) => s.track === track)) {
                pc.addTrack(track, stream);
              }
            });
          });
          onSpeakingChange?.(true);
        } catch (_err) {
          setMicError('Mic blocked');
          setIsHandsFree(false);
          setIsHoldingMic(false);
          onSpeakingChange?.(false);
        }
      } else {
        if (streamRef.current) {
          streamRef.current.getAudioTracks().forEach((t) => {
            t.enabled = false;
          });
        }
        onSpeakingChange?.(false);
      }
    }

    syncMic();
    return () => {
      cancelled = true;
    };
  }, [isTransmitting]);

  // WebRTC Mesh + Firebase RTDB Signaling for Online Tables
  useEffect(() => {
    if (!roomId || roomId === 'local' || !userId) {
      setVoiceStatus('Local');
      return undefined;
    }

    const db = getRtdb();
    const cleanRoom = String(roomId).trim().toUpperCase();
    const cleanUser = String(userId).trim();
    const myPresenceRef = ref(db, `voiceRooms/${cleanRoom}/peers/${cleanUser}`);
    const peersListRef = ref(db, `voiceRooms/${cleanRoom}/peers`);

    set(myPresenceRef, { joinedAt: Date.now() }).catch(() => {});
    onDisconnect(myPresenceRef).remove().catch(() => {});

    const unsubscribers = [];

    function attachRemoteAudio(remoteId, remoteStream) {
      let audioEl = audioElsRef.current[remoteId];
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `voice-audio-${remoteId}`;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
        audioElsRef.current[remoteId] = audioEl;
      }
      audioEl.srcObject = remoteStream;
      audioEl.muted = Boolean(mutedRef.current);
      audioEl.volume = 1.0;
      audioEl.play().catch(() => {});
    }

    function cleanupPeer(remoteId) {
      if (peersRef.current[remoteId]) {
        peersRef.current[remoteId].close();
        delete peersRef.current[remoteId];
      }
      if (audioElsRef.current[remoteId]) {
        audioElsRef.current[remoteId].srcObject = null;
        audioElsRef.current[remoteId].remove();
        delete audioElsRef.current[remoteId];
      }
    }

    async function setupPeerConnection(remoteId) {
      if (peersRef.current[remoteId]) return peersRef.current[remoteId];

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current[remoteId] = pc;

      // Ensure bidirectional audio transceiver even before local mic is unmuted
      pc.addTransceiver('audio', { direction: 'sendrecv' });

      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, streamRef.current);
        });
      }

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          attachRemoteAudio(remoteId, remoteStream);
          setVoiceStatus('Live');
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === 'connected' || state === 'completed') {
          setVoiceStatus('Live');
        } else if (state === 'failed' || state === 'disconnected') {
          setVoiceStatus('Reconnecting');
        }
      };

      const pairId = [cleanUser, remoteId].sort().join('__');
      const isOfferer = cleanUser < remoteId;
      const offerRef = ref(db, `voiceRooms/${cleanRoom}/signals/${pairId}/offer`);
      const answerRef = ref(db, `voiceRooms/${cleanRoom}/signals/${pairId}/answer`);
      const myCandidatesRef = ref(
        db,
        `voiceRooms/${cleanRoom}/signals/${pairId}/candidates_${cleanUser}`
      );
      const remoteCandidatesRef = ref(
        db,
        `voiceRooms/${cleanRoom}/signals/${pairId}/candidates_${remoteId}`
      );

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          push(myCandidatesRef, event.candidate.toJSON()).catch(() => {});
        }
      };

      const pendingCandidates = [];

      const unsubCandidates = onChildAdded(remoteCandidatesRef, async (snap) => {
        const cand = snap.val();
        if (!cand) return;
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } else {
            pendingCandidates.push(cand);
          }
        } catch (_e) {}
      });
      unsubscribers.push(unsubCandidates);

      if (isOfferer) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        await set(offerRef, { type: offer.type, sdp: offer.sdp });

        const unsubAnswer = onValue(answerRef, async (snap) => {
          const ans = snap.val();
          if (ans && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(ans));
            while (pendingCandidates.length > 0) {
              const c = pendingCandidates.shift();
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
          }
        });
        unsubscribers.push(unsubAnswer);
      } else {
        const unsubOffer = onValue(offerRef, async (snap) => {
          const off = snap.val();
          if (off && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(off));
            while (pendingCandidates.length > 0) {
              const c = pendingCandidates.shift();
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await set(answerRef, { type: answer.type, sdp: answer.sdp });
          }
        });
        unsubscribers.push(unsubOffer);
      }

      return pc;
    }

    const unsubPeers = onValue(peersListRef, (snap) => {
      const peersData = snap.val() || {};
      const activeIds = Object.keys(peersData).filter((id) => id !== cleanUser);

      activeIds.forEach((remoteId) => {
        setupPeerConnection(remoteId).catch(() => {});
      });

      Object.keys(peersRef.current).forEach((existingId) => {
        if (!activeIds.includes(existingId)) {
          cleanupPeer(existingId);
        }
      });
    });
    unsubscribers.push(unsubPeers);

    return () => {
      unsubscribers.forEach((u) => typeof u === 'function' && u());
      Object.keys(peersRef.current).forEach(cleanupPeer);
      remove(myPresenceRef).catch(() => {});
    };
  }, [roomId, userId]);

  useEffect(() => {
    return () => {
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
        onMouseDown={() => !isHandsFree && setIsHoldingMic(true)}
        onMouseUp={() => !isHandsFree && setIsHoldingMic(false)}
        onMouseLeave={() => !isHandsFree && setIsHoldingMic(false)}
        onTouchStart={(e) => {
          if (!isHandsFree) {
            e.preventDefault();
            setIsHoldingMic(true);
          }
        }}
        onTouchEnd={() => !isHandsFree && setIsHoldingMic(false)}
        style={{
          padding: '5px 11px',
          borderRadius: '8px',
          border: '1px solid rgba(242, 201, 76, 0.45)',
          background: isTransmitting ? '#16a34a' : '#1e293b',
          color: '#f8fafc',
          fontSize: '12px',
          fontWeight: 700,
          cursor: isHandsFree ? 'default' : 'pointer',
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
            unlockAllRemoteAudio();
            setIsHandsFree(e.target.checked);
            if (e.target.checked) setIsHoldingMic(false);
          }}
        />
        <span>Hands-Free</span>
      </label>

      <button
        type="button"
        onClick={() => {
          unlockAllRemoteAudio();
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

      {voiceStatus === 'Live' && (
        <span style={{ color: '#4ade80', fontSize: '11px', fontWeight: 700 }}>● Voice Live</span>
      )}

      {micError && (
        <span style={{ color: '#f87171', fontSize: '11px' }}>{micError}</span>
      )}
    </div>
  );
}
