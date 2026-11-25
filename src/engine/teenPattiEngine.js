export const STARTING_CHIPS = 50000;
export const LOW_CHIPS_THRESHOLD = 500;
export const FREE_TOP_UP_AMOUNT = 5000;
export const AD_REWARD_CHIPS = 2500;
export const PI_TOP_UP_CHIPS = 10000;
export const MAX_STAKE_MULTIPLIER = 64;

export const GAME_MODES = {
  VS_AUTO_BOT: {
    id: 'VS_AUTO_BOT',
    label: 'Play vs Auto Bot',
    subtitle: 'Instant 1v1 solo match',
    isOnline: false
  },
  PUBLIC_LIVE: {
    id: 'PUBLIC_LIVE',
    label: 'Public Live Table',
    subtitle: 'Auto-starts when full',
    isOnline: true
  },
  INVITE_FRIENDS: {
    id: 'INVITE_FRIENDS',
    label: 'Invite Friends (Code)',
    subtitle: '6-digit private code',
    isOnline: true
  }
};

export const PLAYER_STATUS = {
  ACTIVE_BLIND: 'ACTIVE_BLIND',
  ACTIVE_SEEN: 'ACTIVE_SEEN',
  PACKED: 'PACKED'
};

export const TABLE_PHASE = {
  IDLE: 'IDLE',
  BETTING: 'BETTING',
  SIDESHOW_PENDING: 'SIDESHOW_PENDING',
  SHOWDOWN: 'SHOWDOWN'
};

export const SUITS = [
  { name: 'SPADES', symbol: '♠', isRed: false },
  { name: 'HEARTS', symbol: '♥', isRed: true },
  { name: 'DIAMONDS', symbol: '♦', isRed: true },
  { name: 'CLUBS', symbol: '♣', isRed: false }
];

export const RANKS = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
  { value: 11, label: 'J' },
  { value: 12, label: 'Q' },
  { value: 13, label: 'K' },
  { value: 14, label: 'A' }
];

export const HAND_CATEGORIES = {
  HIGH_CARD: { rankOrder: 1, displayName: 'High Card', shortSummary: 'Highest card leads when no combo forms' },
  PAIR: { rankOrder: 2, displayName: 'Pair', shortSummary: 'Two cards of the same rank' },
  COLOR: { rankOrder: 3, displayName: 'Color', shortSummary: 'Three cards of the same suit (Flush)' },
  SEQUENCE: { rankOrder: 4, displayName: 'Sequence', shortSummary: 'Three consecutive cards of mixed suits' },
  PURE_SEQUENCE: { rankOrder: 5, displayName: 'Pure Sequence', shortSummary: 'Three consecutive cards of the same suit' },
  TRIO: { rankOrder: 6, displayName: 'Trio', shortSummary: 'Three cards of the same rank (Trail)' }
};

export function encodeCardCode(card) {
  return `${card.rank.label}_${card.suit.name}`;
}

export function decodeCardCode(code) {
  if (!code || typeof code !== 'string') return null;
  const parts = code.split('_');
  if (parts.length !== 2) return null;
  const rank = RANKS.find((r) => r.label === parts[0]);
  const suit = SUITS.find((s) => s.name === parts[1]);
  if (!rank || !suit) return null;
  return { rank, suit };
}

export function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

function sequenceStrength(high, mid, low) {
  if (high === 14 && mid === 13 && low === 12) return 15; // A-K-Q
  if (high === 14 && mid === 3 && low === 2) return 14; // A-2-3
  if (high - 1 === mid && mid - 1 === low) return high;
  return 0;
}

function formatSeqCards(sortedDesc) {
  const vals = sortedDesc.map((c) => c.rank.value);
  if (vals[0] === 14 && vals[1] === 3 && vals[2] === 2) return 'A-2-3';
  return sortedDesc.map((c) => c.rank.label).join('-');
}

export function evaluateHand(cards) {
  if (!cards || cards.length !== 3) {
    return {
      category: HAND_CATEGORIES.HIGH_CARD,
      tieBreakers: [0],
      description: 'High Card'
    };
  }

  const sortedDesc = [...cards].sort((a, b) => b.rank.value - a.rank.value);
  const r0 = sortedDesc[0].rank.value;
  const r1 = sortedDesc[1].rank.value;
  const r2 = sortedDesc[2].rank.value;

  const sameSuit = cards[0].suit.name === cards[1].suit.name && cards[1].suit.name === cards[2].suit.name;
  const seqScore = sequenceStrength(r0, r1, r2);
  const isSequence = seqScore > 0;

  if (r0 === r1 && r1 === r2) {
    return {
      category: HAND_CATEGORIES.TRIO,
      tieBreakers: [r0],
      description: `Trio • ${sortedDesc[0].rank.label}-${sortedDesc[1].rank.label}-${sortedDesc[2].rank.label}`
    };
  }

  if (sameSuit && isSequence) {
    return {
      category: HAND_CATEGORIES.PURE_SEQUENCE,
      tieBreakers: [seqScore],
      description: `Pure Sequence • ${formatSeqCards(sortedDesc)}`
    };
  }

  if (isSequence) {
    return {
      category: HAND_CATEGORIES.SEQUENCE,
      tieBreakers: [seqScore],
      description: `Sequence • ${formatSeqCards(sortedDesc)}`
    };
  }

  if (sameSuit) {
    return {
      category: HAND_CATEGORIES.COLOR,
      tieBreakers: [r0, r1, r2],
      description: `Color • ${sortedDesc[0].suit.symbol} ${sortedDesc[0].rank.label} High`
    };
  }

  if (r0 === r1 || r1 === r2) {
    const pairRank = r0 === r1 ? r0 : r1;
    const kickerRank = r0 === r1 ? r2 : r0;
    const pairLabel = RANKS.find((r) => r.value === pairRank)?.label || '';
    const kickerLabel = RANKS.find((r) => r.value === kickerRank)?.label || '';
    return {
      category: HAND_CATEGORIES.PAIR,
      tieBreakers: [pairRank, kickerRank],
      description: `Pair of ${pairLabel}s • ${kickerLabel} Kicker`
    };
  }

  return {
    category: HAND_CATEGORIES.HIGH_CARD,
    tieBreakers: [r0, r1, r2],
    description: `High Card • ${sortedDesc[0].rank.label} High`
  };
}

export function compareHandRanks(a, b) {
  if (a.category.rankOrder !== b.category.rankOrder) {
    return a.category.rankOrder - b.category.rankOrder;
  }
  const len = Math.min(a.tieBreakers.length, b.tieBreakers.length);
  for (let i = 0; i < len; i += 1) {
    if (a.tieBreakers[i] !== b.tieBreakers[i]) {
      return a.tieBreakers[i] - b.tieBreakers[i];
    }
  }
  return 0;
}

export function getActivePlayers(state) {
  return (state.players || []).filter((p) => p.status !== PLAYER_STATUS.PACKED);
}

export function getCurrentPlayer(state) {
  return (state.players || [])[state.currentTurnIndex] || null;
}

export function minStakeFor(state, player) {
  if (!player) return 0;
  const isSeen = player.status === PLAYER_STATUS.ACTIVE_SEEN;
  const base = isSeen ? state.currentBlindStake * 2 : state.currentBlindStake;
  return Math.max(0, Math.min(base, player.chips));
}

export function raiseStakeFor(state, player) {
  if (!player) return 0;
  const isSeen = player.status === PLAYER_STATUS.ACTIVE_SEEN;
  const base = isSeen ? state.currentBlindStake * 4 : state.currentBlindStake * 2;
  return Math.max(0, Math.min(base, player.chips));
}

export function canSeeCards(state, player) {
  const current = getCurrentPlayer(state);
  return (
    state.phase === TABLE_PHASE.BETTING &&
    player &&
    current &&
    player.id === current.id &&
    player.status === PLAYER_STATUS.ACTIVE_BLIND
  );
}

export function canSideshow(state, player) {
  const current = getCurrentPlayer(state);
  if (state.phase !== TABLE_PHASE.BETTING || !player || !current || player.id !== current.id) return false;
  const active = getActivePlayers(state);
  if (player.status !== PLAYER_STATUS.ACTIVE_SEEN || active.length <= 2) return false;
  const prev = active.find((p) => p.id === state.previousActiveSeatId);
  return Boolean(
    prev &&
      prev.id !== player.id &&
      prev.status === PLAYER_STATUS.ACTIVE_SEEN &&
      player.chips >= minStakeFor(state, player)
  );
}

export function canShow(state, player) {
  const current = getCurrentPlayer(state);
  if (state.phase !== TABLE_PHASE.BETTING || !player || !current || player.id !== current.id) return false;
  return getActivePlayers(state).length === 2 && player.chips > 0;
}

function nextActiveIndex(players, fromIndex) {
  if (!players.length) return 0;
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = (fromIndex + offset) % players.length;
    if (players[candidate].status !== PLAYER_STATUS.PACKED) return candidate;
  }
  return fromIndex;
}

function awardSingleWinner(state, winner, wonByShow, reason) {
  const paidPlayers = state.players.map((seat) =>
    seat.id === winner.id ? { ...seat, chips: seat.chips + state.pot } : seat
  );
  return {
    ...state,
    phase: TABLE_PHASE.SHOWDOWN,
    players: paidPlayers,
    pendingSideshow: null,
    handResult: {
      winnerIds: [winner.id],
      winnerNames: [winner.name],
      potWon: state.pot,
      winningHandDescription: reason,
      wonByShow,
      revealedHands: {}
    },
    bannerMessage: `${winner.name} wins ${state.pot} chips!`
  };
}

export function createLocalBotTable({ playerName, humanChips, bootAmount = 100, humanIsPiVerified = false }) {
  return {
    mode: GAME_MODES.VS_AUTO_BOT,
    roomCode: `BOT-${Math.floor(1000 + Math.random() * 9000)}`,
    hostId: 'human_1',
    isPublicRoom: false,
    maxPlayers: 2,
    bootAmount,
    pot: 0,
    currentBlindStake: bootAmount,
    dealerIndex: 0,
    currentTurnIndex: 0,
    roundCount: 1,
    handNumber: 0,
    phase: TABLE_PHASE.IDLE,
    players: [
      {
        id: 'human_1',
        seatIndex: 0,
        name: playerName || 'Pioneer_1',
        isBot: false,
        chips: humanChips,
        cards: [],
        status: PLAYER_STATUS.ACTIVE_BLIND,
        totalBetInHand: 0,
        lastActionLabel: null,
        isPiVerified: humanIsPiVerified
      },
      {
        id: 'bot_1',
        seatIndex: 1,
        name: 'Auto Bot',
        isBot: true,
        chips: STARTING_CHIPS,
        cards: [],
        status: PLAYER_STATUS.ACTIVE_BLIND,
        totalBetInHand: 0,
        lastActionLabel: null,
        isPiVerified: false
      }
    ],
    previousActiveSeatId: null,
    pendingSideshow: null,
    lastSideshowResolution: null,
    handResult: null,
    bannerMessage: 'Table ready'
  };
}

export function startNewHand(state) {
  const deck = createShuffledDeck();
  let cursor = 0;
  let totalPot = 0;
  const boot = state.bootAmount;
  const nextDealer = state.handNumber === 0 ? 0 : (state.dealerIndex + 1) % state.players.length;

  const updatedPlayers = state.players.map((seat) => {
    const baseChips = seat.isBot && seat.chips < boot ? seat.chips + FREE_TOP_UP_AMOUNT : seat.chips;
    const antePaid = Math.min(boot, baseChips);
    totalPot += antePaid;
    const dealtCards = deck.slice(cursor, cursor + 3);
    cursor += 3;
    return {
      ...seat,
      chips: baseChips - antePaid,
      cards: dealtCards,
      status: antePaid > 0 ? PLAYER_STATUS.ACTIVE_BLIND : PLAYER_STATUS.PACKED,
      totalBetInHand: antePaid,
      lastActionLabel: antePaid > 0 ? `Boot ${antePaid}` : 'Out'
    };
  });

  const firstTurnIndex = nextActiveIndex(updatedPlayers, nextDealer);
  const firstPlayer = updatedPlayers[firstTurnIndex];

  return {
    ...state,
    pot: totalPot,
    currentBlindStake: boot,
    dealerIndex: nextDealer,
    currentTurnIndex: firstTurnIndex,
    roundCount: 1,
    handNumber: state.handNumber + 1,
    phase: TABLE_PHASE.BETTING,
    players: updatedPlayers,
    previousActiveSeatId: null,
    pendingSideshow: null,
    lastSideshowResolution: null,
    handResult: null,
    bannerMessage: firstPlayer ? `${firstPlayer.name}'s turn (Blind)` : 'Hand dealt'
  };
}

export function seeCards(state, playerId) {
  const current = getCurrentPlayer(state);
  if (state.phase !== TABLE_PHASE.BETTING || !current || current.id !== playerId) return state;
  if (current.status !== PLAYER_STATUS.ACTIVE_BLIND) return state;

  const updatedPlayers = state.players.map((seat) =>
    seat.id === playerId
      ? { ...seat, status: PLAYER_STATUS.ACTIVE_SEEN, lastActionLabel: 'Seen' }
      : seat
  );

  return {
    ...state,
    players: updatedPlayers,
    bannerMessage: `${current.name} is now Seen (2x stake)`
  };
}

export function bet(state, playerId, isRaise) {
  const current = getCurrentPlayer(state);
  if (state.phase !== TABLE_PHASE.BETTING || !current || current.id !== playerId) return state;
  if (current.status === PLAYER_STATUS.PACKED) return state;

  const maxBlind = state.bootAmount * MAX_STAKE_MULTIPLIER;
  const nextBlindStake = isRaise ? Math.min(state.currentBlindStake * 2, maxBlind) : state.currentBlindStake;
  const isSeen = current.status === PLAYER_STATUS.ACTIVE_SEEN;
  const desiredAmount = isSeen ? nextBlindStake * 2 : nextBlindStake;
  const wager = Math.min(desiredAmount, current.chips);

  let actionText;
  if (wager < desiredAmount) actionText = `All-In ${wager}`;
  else if (isSeen && isRaise) actionText = `Chaal 2x (${wager})`;
  else if (isSeen) actionText = `Chaal ${wager}`;
  else if (isRaise) actionText = `Blind 2x (${wager})`;
  else actionText = `Blind ${wager}`;

  const updatedPlayers = state.players.map((seat) =>
    seat.id === playerId
      ? {
          ...seat,
          chips: seat.chips - wager,
          totalBetInHand: seat.totalBetInHand + wager,
          lastActionLabel: actionText
        }
      : seat
  );

  const nextTurn = nextActiveIndex(updatedPlayers, state.currentTurnIndex);
  const wrappedRound = nextTurn <= state.currentTurnIndex;

  return {
    ...state,
    pot: state.pot + wager,
    currentBlindStake: nextBlindStake,
    currentTurnIndex: nextTurn,
    roundCount: wrappedRound ? state.roundCount + 1 : state.roundCount,
    phase: TABLE_PHASE.BETTING,
    players: updatedPlayers,
    previousActiveSeatId: playerId,
    lastSideshowResolution: null,
    bannerMessage: `${current.name}: ${actionText}`
  };
}

export function pack(state, playerId) {
  const current = getCurrentPlayer(state);
  if (state.phase !== TABLE_PHASE.BETTING || !current || current.id !== playerId) return state;

  const updatedPlayers = state.players.map((seat) =>
    seat.id === playerId
      ? { ...seat, status: PLAYER_STATUS.PACKED, lastActionLabel: 'Packed' }
      : seat
  );

  const remaining = updatedPlayers.filter((p) => p.status !== PLAYER_STATUS.PACKED);
  if (remaining.length === 1) {
    return awardSingleWinner(
      { ...state, players: updatedPlayers },
      remaining[0],
      false,
      `${remaining[0].name} wins — all others packed`
    );
  }

  const nextTurn = nextActiveIndex(updatedPlayers, state.currentTurnIndex);
  return {
    ...state,
    currentTurnIndex: nextTurn,
    phase: TABLE_PHASE.BETTING,
    players: updatedPlayers,
    lastSideshowResolution: null,
    bannerMessage: `${current.name} packed`
  };
}

export function callShow(state, callerId) {
  const caller = getCurrentPlayer(state);
  if (!canShow(state, caller) || caller.id !== callerId) return state;

  const cost = minStakeFor(state, caller);
  const updatedPlayers = state.players.map((seat) => {
    if (seat.id === caller.id) {
      return {
        ...seat,
        chips: seat.chips - cost,
        totalBetInHand: seat.totalBetInHand + cost,
        status: PLAYER_STATUS.ACTIVE_SEEN,
        lastActionLabel: `Show (${cost})`
      };
    }
    if (seat.status !== PLAYER_STATUS.PACKED) {
      return { ...seat, status: PLAYER_STATUS.ACTIVE_SEEN };
    }
    return seat;
  });

  const newPot = state.pot + cost;
  const contenders = updatedPlayers.filter((p) => p.status !== PLAYER_STATUS.PACKED);
  const ranksById = {};
  let bestRank = null;

  for (const contender of contenders) {
    const rank = evaluateHand(contender.cards);
    ranksById[contender.id] = rank;
    if (!bestRank || compareHandRanks(rank, bestRank) > 0) {
      bestRank = rank;
    }
  }

  const winners = contenders.filter((c) => compareHandRanks(ranksById[c.id], bestRank) === 0);
  const share = Math.floor(newPot / winners.length);
  const remainder = newPot % winners.length;
  const winnerIds = new Set(winners.map((w) => w.id));

  const paidPlayers = updatedPlayers.map((seat) => {
    if (winnerIds.has(seat.id)) {
      const bonus = seat.id === winners[0].id ? remainder : 0;
      return { ...seat, chips: seat.chips + share + bonus };
    }
    return seat;
  });

  const winnerLabel = winners.map((w) => w.name).join(' & ');
  return {
    ...state,
    pot: newPot,
    phase: TABLE_PHASE.SHOWDOWN,
    players: paidPlayers,
    pendingSideshow: null,
    handResult: {
      winnerIds: winners.map((w) => w.id),
      winnerNames: winners.map((w) => w.name),
      potWon: newPot,
      winningHandDescription: bestRank.description,
      wonByShow: true,
      revealedHands: ranksById
    },
    bannerMessage: `${winnerLabel} wins ${newPot} chips (${bestRank.description})`
  };
}

export function topUpPlayer(state, playerId, amount = FREE_TOP_UP_AMOUNT) {
  const safeAmount = Math.max(0, Number(amount) || 0);
  const updated = (state.players || []).map((seat) =>
    seat.id === playerId ? { ...seat, chips: seat.chips + safeAmount } : seat
  );
  return {
    ...state,
    players: updated,
    bannerMessage: `+${safeAmount.toLocaleString('en-US')} Play Chips added!`
  };
}
