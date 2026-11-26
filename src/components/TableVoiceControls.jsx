import React, { useState, useRef, useEffect } from 'react';

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
  const streamRef = useRef(null);

  const isTransmitting = isHandsFree || isHoldingMic;

  async function enableMicStream() {
    if (streamRef.current) return true;
    try {
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
      return true;
    } catch (_err) {
      setMicError('Mic blocked');
      setIsHoldingMic(false);
      setIsHandsFree(false);
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function syncTransmission() {
      if (isTransmitting) {
        const ok = await enableMicStream();
        if (!ok || cancelled) return;
        streamRef.current.getTracks().forEach((track) => {
          track.enabled = true;
        });
        onSpeakingChange?.(true);
      } else {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => {
            track.enabled = false;
          });
        }
        onSpeakingChange?.(false);
      }
    }

    syncTransmission();
    return () => {
      cancelled = true;
    };
  }, [isTransmitting, roomId, userId]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
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
            setIsHandsFree(e.target.checked);
            if (e.target.checked) setIsHoldingMic(false);
          }}
        />
        <span>Hands-Free</span>
      </label>

      <button
        type="button"
        onClick={onToggleListenerMute}
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

      {micError && (
        <span style={{ color: '#f87171', fontSize: '11px' }}>{micError}</span>
      )}
    </div>
  );
}
