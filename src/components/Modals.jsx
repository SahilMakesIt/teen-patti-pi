import React, { useState } from 'react';
import { PlayCircle, Send, Wallet, X } from 'lucide-react';
import { HAND_CATEGORIES, LOW_CHIPS_THRESHOLD } from '../engine/teenPattiEngine';

const PI_PACKS = [
  { quantity: 1, label: '1x', chips: 10000, piLabel: '0.25 Pi' },
  { quantity: 2, label: '2x', chips: 20000, piLabel: '0.50 Pi' },
  { quantity: 5, label: '5x', chips: 50000, piLabel: '1.25 Pi' },
];

const GIFT_PRESETS = [1000, 5000, 25000, 100000];

export function RefillChipsModal({
  playerName,
  currentChips,
  isAdPreviewRunning,
  adPreviewSecondsLeft,
  isPiPaymentBusy,
  isGiftBusy = false,
  statusMessage,
  onWatchVideoAd,
  onBuyPiChipsPack,
  onGiftChips,
  onDismiss,
}) {
  const [selectedQty, setSelectedQty] = useState(1);
  const [giftRecipient, setGiftRecipient] = useState('');
  const [giftAmount, setGiftAmount] = useState('5000');

  const selectedPack = PI_PACKS.find((p) => p.quantity === selectedQty) || PI_PACKS[0];
  const busy = isAdPreviewRunning || isPiPaymentBusy || isGiftBusy;

  const adButtonLabel = isAdPreviewRunning
    ? 'Loading Ad...'
    : 'Watch Video (+2,000 Free Chips)';
  
  const parsedGiftAmount = Math.max(0, Math.floor(Number(giftAmount) || 0));
  const canSendGift =
    Boolean(onGiftChips) &&
    !busy &&
    giftRecipient.trim().length >= 2 &&
    parsedGiftAmount >= 100 &&
    parsedGiftAmount <= currentChips;

  const handleGiftSubmit = (e) => {
    e.preventDefault();
    if (!canSendGift) return;
    onGiftChips(giftRecipient.trim().replace(/^@/, ''), parsedGiftAmount);
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onDismiss()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Chip Store & Gift Chips</h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {playerName} • {currentChips.toLocaleString('en-US')} Chips
            </div>
          </div>
          <button className="icon-btn" onClick={onDismiss} disabled={busy} aria-label="Close Chip Store">
            <X size={20} />
          </button>
        </div>

        {currentChips < LOW_CHIPS_THRESHOLD && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.14)',
              color: 'var(--amber)',
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            Balance below 500 — grab a chip pack or watch a short ad to keep playing.
          </div>
        )}

        {statusMessage && (
          <div
            style={{
              background: 'var(--emerald-soft)',
              color: 'var(--emerald)',
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            {statusMessage}
          </div>
        )}

        <div hidden className="store-box pi-border">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
            <span style={{ color: 'var(--pi-purple)' }}>Pi Wallet Chip Packs</span>
            <span style={{ color: 'var(--gold)' }}>Unlimited Purchases</span>
          </div>

          <div className="pack-grid">
            {PI_PACKS.map((pack) => {
              const active = pack.quantity === selectedPack.quantity;
              return (
                <button
                  key={pack.label}
                  type="button"
                  disabled={busy}
                  className={`pack-option ${active ? 'selected' : ''}`}
                  onClick={() => setSelectedQty(pack.quantity)}
                >
                  <div style={{ fontWeight: 800, color: active ? 'var(--gold)' : 'var(--text-primary)' }}>
                    {pack.label}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700 }}>{pack.chips.toLocaleString('en-US')}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--pi-purple)' }}>{pack.piLabel}</div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={busy}
            className="dock-btn pi"
            onClick={() => onBuyPiChipsPack(selectedPack.quantity)}
          >
            <Wallet size={17} />
            {isPiPaymentBusy
              ? 'Processing Pi Payment...'
              : `Buy ${selectedPack.chips.toLocaleString('en-US')} Play Chips — ${selectedPack.piLabel}`}
          </button>
        </div>

        <div className="store-box emerald-border">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
            <span style={{ color: 'var(--emerald)' }}>Free Ad Reward (+2,000 Chips)</span>
            <span style={{ color: 'var(--text-secondary)' }}>Unlimited</span>
          </div>
          <button
            type="button"
            disabled={busy}
            className="dock-btn call"
            onClick={onWatchVideoAd}
          >
            <PlayCircle size={18} />
            {adButtonLabel}
          </button>
        </div>

        {onGiftChips && (
          <form onSubmit={handleGiftSubmit} className="store-box" style={{ border: '1px solid rgba(242, 201, 76, 0.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: 'var(--gold)' }}>Send Play Chips to a Friend</span>
              <span style={{ color: 'var(--text-secondary)' }}>Min 100 Chips</span>
            </div>

            <input
              type="text"
              className="code-input"
              style={{ letterSpacing: 'normal', width: '100%' }}
              placeholder="Friend's Pi Username"
              value={giftRecipient}
              disabled={busy}
              onChange={(e) => setGiftRecipient(e.target.value)}
            />

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {GIFT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={busy || currentChips < preset}
                  className={`pill-btn ${Number(giftAmount) === preset ? 'active-gold' : ''}`}
                  style={{ flex: 1, padding: '5px 6px', fontSize: 11 }}
                  onClick={() => setGiftAmount(String(preset))}
                >
                  +{preset >= 1000 ? `${preset / 1000}K` : preset}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={100}
                max={currentChips}
                className="code-input"
                style={{ letterSpacing: 'normal', flex: 1 }}
                placeholder="Amount"
                value={giftAmount}
                disabled={busy}
                onChange={(e) => setGiftAmount(e.target.value)}
              />
              <button
                type="submit"
                disabled={!canSendGift}
                className="dock-btn raise"
                style={{ flex: 1.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Send size={15} />
                {isGiftBusy ? 'Sending...' : 'Send Chips'}
              </button>
            </div>
          </form>
        )}

        <div className="notice-box">
          One-way entertainment purchase only. Play Chips have zero monetary value and cannot be redeemed or exchanged for Pi.
        </div>
      </div>
    </div>
  );
}

export function RulesModal({ onDismiss }) {
  const rankings = Object.values(HAND_CATEGORIES).sort((a, b) => b.rankOrder - a.rankOrder);
  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Rules & Hand Rankings</h2>
          <button className="icon-btn" onClick={onDismiss} aria-label="Close Rules">
            <X size={20} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Each player puts in the Boot stake and receives 3 face-down cards. Play Blind (1x stake) or tap See Cards to become Seen (2x stake). Tap Show when 2 players remain to reveal hands.
        </div>

        {rankings.map((cat) => (
          <div className="rule-row" key={cat.displayName}>
            <strong style={{ color: 'var(--gold)' }}>{cat.displayName}</strong>
            <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{cat.shortSummary}</span>
          </div>
        ))}

        <div className="notice-box">
          Play Chips have zero monetary value. Entertainment only.
        </div>
      </div>
    </div>
  );
}

export function PiProfileModal({
  currentName,
  piStatusMessage,
  isConnecting,
  onConnectWithPi,
  onDismiss,
}) {
  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Pioneer Profile & Pi Wallet</h2>
          <button className="icon-btn" onClick={onDismiss} aria-label="Close Profile">
            <X size={20} />
          </button>
        </div>

        <div className="notice-box" style={{ color: 'var(--emerald)' }}>
          {piStatusMessage}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
            Permanent Pi Username (First 5 Characters Shown)
          </label>
          <div
            className="code-input"
            style={{ letterSpacing: 'normal', opacity: 0.85, userSelect: 'none' }}
          >
            @{currentName || 'PiUser'}
          </div>
        </div>

        <button type="button" className="dock-btn pi" disabled={isConnecting} onClick={onConnectWithPi}>
          <Wallet size={17} />
          {isConnecting ? 'Verifying Pi Account...' : 'Refresh Pi Verification'}
        </button>
      </div>
    </div>
  );
}
