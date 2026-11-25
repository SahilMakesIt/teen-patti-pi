import {
  HAND_CATEGORIES,
  PLAYER_STATUS,
  canShow,
  evaluateHand,
  minStakeFor,
  raiseStakeFor
} from './teenPattiEngine';

function handStrengthScore(category, highValue) {
  switch (category.rankOrder) {
    case HAND_CATEGORIES.TRIO.rankOrder:
      return 0.96;
    case HAND_CATEGORIES.PURE_SEQUENCE.rankOrder:
      return 0.90;
    case HAND_CATEGORIES.SEQUENCE.rankOrder:
      return 0.78;
    case HAND_CATEGORIES.COLOR.rankOrder:
      return 0.65;
    case HAND_CATEGORIES.PAIR.rankOrder:
      return 0.38 + (highValue / 14) * 0.18;
    default:
      return 0.08 + (highValue / 14) * 0.20;
  }
}

export function chooseBotAction(state, bot) {
  const minCost = minStakeFor(state, bot);
  if (bot.chips <= 0) return { type: 'PACK' };

  const rank = evaluateHand(bot.cards);
  const strength = handStrengthScore(rank.category, rank.tieBreakers[0] || 2);
  const isSeen = bot.status === PLAYER_STATUS.ACTIVE_SEEN;

  if (!isSeen) {
    const shouldSee =
      state.roundCount >= 2 ||
      state.currentBlindStake >= state.bootAmount * 4 ||
      Math.random() < 0.45;
    if (shouldSee) return { type: 'SEE' };
    if (canShow(state, bot) && state.roundCount >= 3 && Math.random() < 0.35) {
      return { type: 'SHOW' };
    }
    const shouldRaiseBlind = state.currentBlindStake < state.bootAmount * 4 && Math.random() < 0.22;
    return { type: 'BET', isRaise: shouldRaiseBlind && bot.chips >= raiseStakeFor(state, bot) };
  }

  const stakeRatio = state.currentBlindStake / Math.max(1, state.bootAmount);

  if (canShow(state, bot)) {
    if (strength >= 0.62 && (state.roundCount >= 2 || Math.random() < 0.4)) {
      return { type: 'SHOW' };
    }
    if (strength < 0.28 && stakeRatio >= 2 && Math.random() < 0.7) {
      return { type: 'PACK' };
    }
    if (state.roundCount >= 4 && Math.random() < 0.55) {
      return { type: 'SHOW' };
    }
  }

  const bluff = Math.random() < 0.14;
  if (strength < 0.24 && stakeRatio >= 2 && !bluff) return { type: 'PACK' };
  if (strength < 0.16 && minCost > bot.chips / 3 && !bluff) return { type: 'PACK' };

  const canRaise = bot.chips >= raiseStakeFor(state, bot) && state.currentBlindStake < state.bootAmount * 8;
  if (canRaise && (strength >= 0.72 || (strength >= 0.52 && Math.random() < 0.3))) {
    return { type: 'BET', isRaise: true };
  }

  return { type: 'BET', isRaise: false };
}
