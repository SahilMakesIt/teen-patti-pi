import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  HelpCircle,
  PlusCircle,
  Share2,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  GAME_MODES,
  LOW_CHIPS_THRESHOLD,
  PLAYER_STATUS,
  TABLE_PHASE,
  canShow,
  canSeeCards,
  getCurrentPlayer,
  minStakeFor,
  raiseStakeFor,
} from '../engine/teenPattiEngine';
import TableVoiceControls from './TableVoiceControls';

function getOpponentPositionClass(totalOpponents, idx) {
  if (totalOpponents === 1) return 'seat-top-center';
  if (totalOpponents === 2) return idx === 0 ? 'seat-top-left' : 'seat-top-right';
  if (totalOpponents === 3) {
    if (idx === 0) return 'seat-mid-left';
    if (idx === 1) return 'seat-top-center';
    return 'seat-mid-right';
  }
  if (idx === 0) return 'seat-mid-left';
  if (idx === 1) return 'seat-top-left';
  if (idx === 2) return 'seat-top-right';
  return 'seat-mid-right';
}

function SeatBadge({
  seat,
  positionClass,
  isHero,
  heroHideBalance,
  isSpeaking,
  isTurn,
  isDealer,
  isWinner,
  showFaceUp,
  dealtStage,
  turnTimerProgress,
}) {
  const isPacked = seat.status === PLAYER_STATUS.PACKED;
  const isMasked = !isHero && Boolean(seat.hideBalance);
  const secondsLeft = Math.max(0, Math.ceil((turnTimerProgress || 0) * 30));

  return (
    <div
      className={`seat-badge ${positionClass} ${isTurn ? 'turn' : ''} ${isWinner ? 'winner' : ''} ${
        isPacked ? 'packed' : ''
      }`}
      style={isSpeaking ? { boxShadow: '0 0 0 2px #22c55e' } : undefined}
    >
      <div className="seat-name-row">
        <span className="seat-name">
          {seat.name} {isSpeaking ? '🎙️' : ''}
        </span>
        {isDealer && <span className="dealer-chip">D</span>}
      </div>
      <div className="seat-chips">
        {isMasked
          ? 'Hidden'
          : `${seat.chips.toLocaleString('en-US')}${isHero && heroHideBalance ? ' (Hidden)' : ''}`}
      </div>
      {seat.cards && seat.cards.length > 0 && (
        <div className="seat-cards-row">
          {seat.cards.slice(0, dealtStage).map((card, i) =>
            showFaceUp && !isPacked ? (
              <div key={i} className={`playing-card face-up ${card.suit.isRed ? 'red' : ''}`}>
                <span>{card.rank.label}</span>
                <span>{card.suit.symbol}</span>
              </div>
            ) : (
              <div key={i} className="playing-card face-down">
                ★
              </div>
            )
          )}
        </div>
      )}
      {seat.lastActionLabel && <span className="seat-action-tag">{seat.lastActionLabel}</span>}
      {isTurn && (
        <>
          <div style={{ fontSize: '10px', fontWeight: 700, color: secondsLeft <= 7 ? '#f87171' : '#f2c94c', marginTop: 2 }}>
            {secondsLeft}s
          </div>
          <div className="turn-progress-track">
            <div
              className="turn-progress-fill"
              style={{ width: `${Math.max(0, Math.min(100, turnTimerProgress * 100))}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function TableView({
  tableState,
  currentUserId,
  soundEnabled,
  hideBalance = false,
  onToggleHideBalance,
  dealtStage,
  turnTimerProgress,
  onLeaveTable,
  onToggleSound,
  onOpenRules,
  onOpenRefillDialog,
  onSeeCards,
  onBet,
  onPack,
  onShow,
  onDealNextHand,
}) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [isVoiceMutedByListener, setIsVoiceMutedByListener] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);

  const players = tableState.players || [];
  const currentTurnPlayer = getCurrentPlayer(tableState);
  const isOnline = tableState.mode?.isOnline;
  const isHost = tableState.hostId === currentUserId;
  const perspectiveIdx = isOnline ? Math.max(0, players.findIndex((p) => p.id === currentUserId)) : 0;
  const orderedSeats = players.map((_, offset) => players[(perspectiveIdx + offset) % players.length]);
  const heroSeat = orderedSeats[0] || null;
  const opponents = orderedSeats.slice(1);

  let centerPill = 'VS AUTO BOT • Play Chips Only';
  if (tableState.mode?.id === GAME_MODES.PUBLIC_LIVE.id) {
    centerPill = `PUBLIC LIVE (${players.length}/${tableState.maxPlayers}) • Play Chips`;
  } else if (tableState.mode?.id === GAME_MODES.INVITE_FRIENDS.id && tableState.roomCode) {
    centerPill = `CODE: ${tableState.roomCode} • ${players.length}/${tableState.maxPlayers}`;
  }

  const isShowdownReveal = tableState.phase === TABLE_PHASE.SHOWDOWN && tableState.handResult?.wonByShow;
  const winnerIds = new Set(tableState.handResult?.winnerIds || []);
  const winnerNames = new Set(tableState.handResult?.winnerNames || []);
  const lowChipHuman = players.find(
    (p) => (!isOnline || p.id === currentUserId) && !p.isBot && p.chips < LOW_CHIPS_THRESHOLD
  );
  const activeLocalHuman = players.find((p) => (!isOnline || p.id === currentUserId) && !p.isBot);

  const handleCopyShareCode = async () => {
    const code = tableState.roomCode;
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch (_err) {
      setCopiedCode(true);
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my Teen Patti Table',
          text: `Join my Teen Patti table! Enter 6-digit invite code: ${code}`,
        });
      } catch (_err) {
        // Ignore user share cancellation
      }
    }
  };

  return (
    <div className="table-screen">
      <div className="table-top-bar">
        <button className="icon-btn" onClick={onLeaveTable} aria-label="Back to Lobby">
          <ArrowLeft size={21} />
        </button>
        <div className="table-status-pill">{centerPill}</div>
        <div className="icon-actions">
          {onToggleHideBalance && (
            <button
              className="icon-btn"
              style={{ color: hideBalance ? 'var(--gold)' : 'var(--text-secondary)' }}
              onClick={onToggleHideBalance}
              title={hideBalance ? 'Balance Hidden from Table (Click to Show)' : 'Hide Balance from Table'}
              aria-label="Toggle Balance Visibility"
            >
              {hideBalance ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          )}
          <button
            className="icon-btn"
            style={{ color: 'var(--gold)' }}
            onClick={() => onOpenRefillDialog(null)}
            aria-label="Open Chip Store"
          >
            <PlusCircle size={20} />
          </button>
          <button className="icon-btn" onClick={onOpenRules} aria-label="Rules">
            <HelpCircle size={20} />
          </button>
          <button
            className="icon-btn"
            style={{ color: soundEnabled ? 'var(--gold)' : 'var(--text-secondary)' }}
            onClick={onToggleSound}
            aria-label="Toggle Sound"
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </div>
      </div>

      <TableVoiceControls
        roomId={tableState.roomCode || 'local'}
        userId={currentUserId}
        isVoiceMutedByListener={isVoiceMutedByListener}
        onToggleListenerMute={() => setIsVoiceMutedByListener((prev) => !prev)}
        onSpeakingChange={setIsLocalSpeaking}
      />

      <div className="felt-arena">
        <div className="felt-oval" />
        <div className="pot-center">
          <div className="pot-badge">
            <div className="pot-label">TOTAL POT • HAND #{tableState.handNumber}</div>
            <div className="pot-amount">{(tableState.pot || 0).toLocaleString('en-US')}</div>
          </div>
          <div className="stake-meta">
            Blind Stake: {(tableState.currentBlindStake || 0).toLocaleString('en-US')} • Boot: {tableState.bootAmount}
          </div>
          {tableState.bannerMessage && <div className="table-banner-msg">{tableState.bannerMessage}</div>}
        </div>

        {opponents.map((seat, idx) => (
          <SeatBadge
            key={seat.id}
            seat={seat}
            positionClass={getOpponentPositionClass(opponents.length, idx)}
            isHero={false}
            heroHideBalance={false}
            isSpeaking={false}
            isTurn={currentTurnPlayer?.id === seat.id && tableState.phase === TABLE_PHASE.BETTING}
            isDealer={tableState.dealerIndex === seat.seatIndex}
            isWinner={winnerIds.has(seat.id) || winnerNames.has(seat.name)}
            showFaceUp={Boolean(isShowdownReveal)}
            dealtStage={dealtStage}
            turnTimerProgress={turnTimerProgress}
          />
        ))}

        {heroSeat && (
          <SeatBadge
            seat={heroSeat}
            positionClass="seat-hero"
            isHero
            heroHideBalance={hideBalance}
            isSpeaking={isLocalSpeaking}
            isTurn={currentTurnPlayer?.id === heroSeat.id && tableState.phase === TABLE_PHASE.BETTING}
            isDealer={tableState.dealerIndex === heroSeat.seatIndex}
            isWinner={winnerIds.has(heroSeat.id) || winnerNames.has(heroSeat.name)}
            showFaceUp={
              (!heroSeat.isBot && heroSeat.status === PLAYER_STATUS.ACTIVE_SEEN) || Boolean(isShowdownReveal)
            }
            dealtStage={dealtStage}
            turnTimerProgress={turnTimerProgress}
          />
        )}
      </div>

      <div className="action-dock">
        {lowChipHuman ? (
          <button
            type="button"
            className="dock-btn call"
            onClick={() => onOpenRefillDialog(lowChipHuman.id)}
          >
            <PlusCircle size={17} /> {lowChipHuman.name}: + Get Chips
          </button>
        ) : tableState.phase === TABLE_PHASE.SHOWDOWN && activeLocalHuman ? (
          <button
            type="button"
            className="dock-btn outline"
            onClick={() => onOpenRefillDialog(activeLocalHuman.id)}
          >
            <PlusCircle size={16} /> + Get Chips
          </button>
        ) : null}

        {tableState.phase === TABLE_PHASE.IDLE && isOnline && (
          <>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13.5, color: 'var(--gold)' }}>
              Waiting for real players: {players.length}/{tableState.maxPlayers} joined...
            </div>
            {!tableState.isPublicRoom && tableState.roomCode ? (
              <div className="invite-code-box">
                <div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: copiedCode ? 'var(--emerald)' : 'var(--text-secondary)',
                    }}
                  >
                    {copiedCode ? 'Invite Code Copied!' : '6-Digit Invite Code'}
                  </div>
                  <div className="invite-code-digits">{tableState.roomCode}</div>
                </div>
                <button
                  type="button"
                  className="join-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={handleCopyShareCode}
                >
                  {copiedCode ? <Check size={16} /> : <Share2 size={16} />} Copy / Share Invite Code
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                Game automatically starts when {tableState.maxPlayers}/{tableState.maxPlayers} players join.
              </div>
            )}

            {isHost ? (
              <button
                type="button"
                className="dock-btn raise"
                disabled={players.length < 2}
                onClick={onDealNextHand}
              >
                {players.length >= 2
                  ? `Start Now (${players.length}/${tableState.maxPlayers} Players)`
                  : 'Waiting for players to join...'}
              </button>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                Auto-starts once all {tableState.maxPlayers} seats fill (or host starts).
              </div>
            )}
          </>
        )}

        {tableState.phase === TABLE_PHASE.SHOWDOWN && (
          <>
            {tableState.handResult && (
              <div className="showdown-card">
                <Trophy size={22} color="#F2C94C" />
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--gold)', fontSize: 13.5 }}>
                    {tableState.handResult.winnerNames.join(' & ')} won{' '}
                    {(tableState.handResult.potWon || 0).toLocaleString('en-US')}!
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    {tableState.handResult.winningHandDescription}
                  </div>
                </div>
              </div>
            )}
            <div className="dock-row">
              <button type="button" className="dock-btn outline" style={{ flex: 1 }} onClick={onLeaveTable}>
                Lobby
              </button>
              <button
                type="button"
                className="dock-btn raise"
                style={{ flex: 2 }}
                disabled={
                  players.some((p) => !p.isBot && p.chips < tableState.bootAmount) ||
                  (isOnline && !isHost)
                }
                onClick={onDealNextHand}
              >
                {isOnline && !isHost ? 'Waiting for Host' : 'Deal Next Hand'}
              </button>
            </div>
          </>
        )}

        {tableState.phase === TABLE_PHASE.BETTING && (
          <>
            {!currentTurnPlayer ||
            currentTurnPlayer.isBot ||
            (isOnline && currentTurnPlayer.id !== currentUserId) ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '10px 0',
                  color: 'var(--gold)',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {currentTurnPlayer?.isBot
                  ? `${currentTurnPlayer.name} is thinking...`
                  : `Waiting for ${currentTurnPlayer?.name || 'player'}'s move...`}
              </div>
            ) : (
              (() => {
                const active = currentTurnPlayer;
                const minCost = minStakeFor(tableState, active);
                const raiseCost = raiseStakeFor(tableState, active);
                const allowSee = canSeeCards(tableState, active);
                const allowShow = canShow(tableState, active);
                const allowRaise = active.chips >= raiseCost && raiseCost > minCost;
                const betLabel = active.status === PLAYER_STATUS.ACTIVE_SEEN ? 'Chaal' : 'Blind';

                return (
                  <>
                    <div className="dock-row">
                      <button type="button" className="dock-btn pack" onClick={onPack}>
                        Pack
                      </button>
                      <button type="button" className="dock-btn call" onClick={() => onBet(false)}>
                        {betLabel} {minCost.toLocaleString('en-US')}
                      </button>
                      <button
                        type="button"
                        className="dock-btn raise"
                        disabled={!allowRaise}
                        onClick={() => onBet(true)}
                      >
                        2x {raiseCost.toLocaleString('en-US')}
                      </button>
                    </div>
                    {(allowSee || allowShow) && (
                      <div className="dock-row">
                        {allowSee && (
                          <button type="button" className="dock-btn outline" onClick={onSeeCards}>
                            <Eye size={16} /> See Cards
                          </button>
                        )}
                        {allowShow && (
                          <button type="button" className="dock-btn raise" onClick={onShow}>
                            Show ({minCost.toLocaleString('en-US')})
                          </button>
                        )}
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </>
        )}
      </div>
    </div>
  );
}
