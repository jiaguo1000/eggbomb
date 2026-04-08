/**
 * Determinized Monte Carlo (flat ISMCTS) for 掼蛋.
 *
 * Algorithm:
 *   1. Generate a small set of candidate moves (rule bot + alternatives).
 *   2. For each determinization (random sample of opponents' cards):
 *      - Apply each candidate, then simulate the rest of the game with the rule bot
 *        acting for all players.
 *   3. Return the candidate with the highest win rate.
 *
 * This handles hidden information (unknown opponent cards) without needing a
 * neural network. Next step: upgrade to proper ISMCTS tree (UCB, progressive
 * widening) or add an NN value function as a rollout shortcut.
 */

import { Card, HandResult, HandType, LastPlay, PlayerSeat, Suit } from '@eggbomb/shared';
import { classifyHand, canBeat, getGameValue, isWildcard } from '@eggbomb/shared';
import { getBotMove, onlyBombsLeft } from './botLogic';
import { createDeck } from './cardUtils';

// ── Public context type ────────────────────────────────────────────────────────

export interface ISMCTSContext {
  mySeat: number;                 // 0-3
  myHand: Card[];
  handCounts: number[];           // cards held by each seat (index = seat)
  teams: number[];                // team (0 or 1) for each seat
  lastPlay: LastPlay | null;
  consecutivePasses: number;
  currentLevel: number;
  playedCardIds: Set<string>;     // all card IDs removed from all hands (publicly played)
  finishOrder: number[];          // seats that finished, in order
}

// ── Internal simulation state ─────────────────────────────────────────────────

interface SimState {
  hands: Card[][];                // indexed by seat
  turn: number;
  lastPlay: LastPlay | null;
  consecutivePasses: number;
  finishOrder: number[];          // seats in finish order
  teams: number[];
  currentLevel: number;
}

// ── Reward ───────────────────────────────────────────────────────────────────
//
// Maps game outcomes to a continuous reward in [-1, +1].
// Win/loss has the largest gap; level advancement is secondary.
//
//   My team wins  +3 (大跑): +1.00
//   My team wins  +2:        +0.70
//   My team wins  +1:        +0.50
//   Opp  wins     +1:        -0.50
//   Opp  wins     +2:        -0.70
//   Opp  wins     +3 (大跑): -1.00

const REWARDS: Record<string, number> = {
  win_3: 1.00, win_2: 0.70, win_1: 0.50,
  lose_1: -0.50, lose_2: -0.70, lose_3: -1.00,
};

function calculateReward(finishOrder: number[], teams: number[], myTeam: number): number {
  // Determine winning team (same logic as winnerTeam but also returns advance)
  let winTeam: number | null = null;
  if (finishOrder.length >= 2 && teams[finishOrder[0]] === teams[finishOrder[1]]) {
    winTeam = teams[finishOrder[0]]; // 大跑 — also covers the case where game ended at length 2
  } else if (finishOrder.length >= 3) {
    winTeam = teams[finishOrder[0]];
  }
  if (winTeam === null) return 0.0; // incomplete — neutral

  // Find where the winning team's second player finished
  let secondPos = 4; // default: 末游 (4th)
  for (let i = 1; i < finishOrder.length; i++) {
    if (teams[finishOrder[i]] === winTeam) { secondPos = i + 1; break; }
  }
  const advance = secondPos === 2 ? 3 : secondPos === 3 ? 2 : 1;

  return winTeam === myTeam
    ? REWARDS[`win_${advance}`]
    : REWARDS[`lose_${advance}`];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Next active (non-finished) seat after `current`, cycling through 0-3. */
function nextActiveSeat(finishOrder: number[], current: number): number {
  for (let i = 1; i <= 4; i++) {
    const s = (current + i) % 4;
    if (!finishOrder.includes(s)) return s;
  }
  return current;
}

/** Returns the winning team if game is over, or null if still going. */
function winnerTeam(finishOrder: number[], teams: number[]): number | null {
  // 大跑: first two finishers are same team
  if (finishOrder.length >= 2 && teams[finishOrder[0]] === teams[finishOrder[1]]) {
    return teams[finishOrder[0]];
  }
  if (finishOrder.length >= 3) {
    return teams[finishOrder[0]]; // 1st-place team wins
  }
  return null;
}

// ── Determinization ───────────────────────────────────────────────────────────

/**
 * Sample one possible world: distribute unknown cards to opponents.
 * Returns null if the state is internally inconsistent (shouldn't happen).
 */
function determinize(ctx: ISMCTSContext): Card[][] | null {
  const fullDeck = createDeck();
  const myIds = new Set(ctx.myHand.map(c => c.id));

  // Unknown = in deck, not in our hand, not played publicly
  const unknown: Card[] = [];
  for (const c of fullDeck) {
    if (!myIds.has(c.id) && !ctx.playedCardIds.has(c.id)) unknown.push(c);
  }
  shuffleInPlace(unknown);

  const otherTotal = ctx.handCounts.reduce((s, n, seat) => seat !== ctx.mySeat ? s + n : s, 0);
  if (unknown.length < otherTotal) return null;

  const hands: Card[][] = [[], [], [], []];
  hands[ctx.mySeat] = [...ctx.myHand];
  let idx = 0;
  for (let seat = 0; seat < 4; seat++) {
    if (seat === ctx.mySeat) continue;
    hands[seat] = unknown.slice(idx, idx + ctx.handCounts[seat]);
    idx += ctx.handCounts[seat];
  }
  return hands;
}

// ── Simulation ────────────────────────────────────────────────────────────────

/**
 * Apply one action (play or pass) to a simulation state, mutating it.
 * Returns 'game_over' if the game has ended after this action.
 */
function applyToSim(
  state: SimState,
  seat: number,
  cardIds: string[] | null  // null = pass
): 'game_over' | 'continue' {
  // ── Pass ──
  if (cardIds === null || cardIds.length === 0) {
    if (!state.lastPlay) {
      // Can't pass when leading — safety: force smallest card
      const sorted = [...state.hands[seat]].sort((a, b) => getGameValue(a, state.currentLevel) - getGameValue(b, state.currentLevel));
      const firstCard = sorted[0];
      if (!firstCard) return 'continue';
      cardIds = [firstCard.id];
      // fall through to play
    } else {
      state.consecutivePasses++;
      state.turn = nextActiveSeat(state.finishOrder, seat);

      // Check if round is over
      const active = [0, 1, 2, 3].filter(s => !state.finishOrder.includes(s));
      const lastSeat = state.lastPlay.seat as number;
      const lastFinished = state.finishOrder.includes(lastSeat);
      const passesNeeded = lastFinished ? active.length : active.length - 1;

      if (state.consecutivePasses >= passesNeeded) {
        // Round over: determine who leads next
        let freshSeat = state.turn;
        if (lastFinished) {
          // Give lead to finished player's active teammate
          const lastTeam = state.teams[lastSeat];
          const teammate = [0, 1, 2, 3].find(
            s => s !== lastSeat && state.teams[s] === lastTeam && !state.finishOrder.includes(s)
          );
          if (teammate !== undefined) freshSeat = teammate;
        } else {
          freshSeat = lastSeat; // last player to play leads again
        }
        state.lastPlay = null;
        state.consecutivePasses = 0;
        state.turn = freshSeat;
      }
      return 'continue';
    }
  }

  // ── Play cards ──
  const toPlay = state.hands[seat].filter(c => cardIds!.includes(c.id));
  if (toPlay.length === 0 || toPlay.length !== cardIds!.length) return 'continue'; // invalid

  const hr = classifyHand(toPlay, state.currentLevel);
  if (!hr) return 'continue'; // unclassifiable — skip (shouldn't happen with rule bot)

  state.hands[seat] = state.hands[seat].filter(c => !cardIds!.includes(c.id));
  state.lastPlay = {
    playerId: String(seat),
    seat: seat as PlayerSeat,
    cards: toPlay,
    hand: hr,
  };
  state.consecutivePasses = 0;

  // Check if player finished
  if (state.hands[seat].length === 0) {
    state.finishOrder.push(seat);
    const w = winnerTeam(state.finishOrder, state.teams);
    if (w !== null) return 'game_over';
  }

  state.turn = nextActiveSeat(state.finishOrder, seat);
  return 'continue';
}

const MAX_SIM_STEPS = 600;

/**
 * Simulate the game to completion using the rule bot for all players.
 * Returns a reward in [0, 1] accounting for outcome and level advancement.
 */
function simulateToEnd(state: SimState, myTeam: number): number {
  for (let step = 0; step < MAX_SIM_STEPS; step++) {
    const seat = state.turn;
    const hand = state.hands[seat];

    // Finished player somehow holding the turn — resolve and continue
    if (hand.length === 0) {
      if (!state.finishOrder.includes(seat)) {
        state.finishOrder.push(seat);
        if (winnerTeam(state.finishOrder, state.teams) !== null) {
          return calculateReward(state.finishOrder, state.teams, myTeam);
        }
      }
      state.turn = nextActiveSeat(state.finishOrder, seat);
      continue;
    }

    // Build context for getBotMove
    const teamSeat = state.teams[seat];
    const teammateSeat = [0, 1, 2, 3].find(s => s !== seat && state.teams[s] === teamSeat);
    const teammateId = teammateSeat !== undefined ? String(teammateSeat) : undefined;
    const teammateHandCount = teammateSeat !== undefined ? state.hands[teammateSeat].length : 27;
    const oppHandCounts = [0, 1, 2, 3]
      .filter(s => state.teams[s] !== teamSeat)
      .map(s => state.hands[s].length);

    const lastPlayHandCount = state.lastPlay
      ? state.hands[state.lastPlay.seat as number]?.length
      : undefined;
    const move = getBotMove(hand, state.lastPlay, state.currentLevel, teammateId, teammateHandCount, oppHandCounts, lastPlayHandCount);
    const cardIds = move?.cardIds ?? null;

    const res = applyToSim(state, seat, cardIds);
    if (res === 'game_over') {
      return calculateReward(state.finishOrder, state.teams, myTeam);
    }
  }

  // Timed out: heuristic — fewer cards = more likely winning
  const myCards = [0, 1, 2, 3]
    .filter(s => state.teams[s] === myTeam)
    .reduce((sum, s) => sum + state.hands[s].length, 0);
  const oppCards = [0, 1, 2, 3]
    .filter(s => state.teams[s] !== myTeam)
    .reduce((sum, s) => sum + state.hands[s].length, 0);
  return myCards < oppCards ? 0.50 : -0.50;
}

// ── Candidate generation helpers ─────────────────────────────────────────────

function dedup(candidates: string[][]): string[][] {
  const seen = new Set<string>();
  return candidates.filter(c => {
    const key = [...c].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Smallest bomb (quad or larger) in hand, or null.
 * Prefers natural quads; fills with wildcards if needed.
 */
function findSmallestBombIds(hand: Card[], currentLevel: number): string[] | null {
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const jokers = hand.filter(c => c.suit === Suit.JOKER);

  // Quad bombs, smallest game value first
  const groups = new Map<number, Card[]>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(c);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, cards] of sorted) {
    const wcNeeded = Math.max(0, 4 - cards.length);
    if (wcNeeded <= wildcards.length) {
      const natural = cards.slice(0, Math.min(cards.length, 4 - wcNeeded));
      return [...natural, ...wildcards.slice(0, wcNeeded)].map(c => c.id);
    }
  }

  // Joker bomb (天王炸) as last resort
  const smallJ = jokers.filter(c => c.rank === 14);
  const bigJ = jokers.filter(c => c.rank === 15);
  if (smallJ.length === 2 && bigJ.length === 2) {
    return [...smallJ, ...bigJ].map(c => c.id);
  }

  return null;
}

/**
 * Smallest low single (< J, orphan preferred) from non-wildcard, non-joker cards.
 */
function findSmallestLowSingleId(hand: Card[], currentLevel: number): string | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const sorted = [...normals].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel));
  const counts = new Map<number, number>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  // Orphan low singles first
  const orphanLow = sorted.find(c => getGameValue(c, currentLevel) < 11 && (counts.get(getGameValue(c, currentLevel)) ?? 1) === 1);
  if (orphanLow) return orphanLow.id;
  // Any low single
  const anyLow = sorted.find(c => getGameValue(c, currentLevel) < 11);
  return anyLow?.id ?? null;
}

/**
 * Smallest low natural pair (< J) from non-wildcard, non-joker cards.
 */
function findSmallestLowPairIds(hand: Card[], currentLevel: number): string[] | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const sorted = [...normals].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel));
  const seen = new Set<number>();
  for (const c of sorted) {
    const v = getGameValue(c, currentLevel);
    if (v >= 11 || seen.has(v)) continue;
    seen.add(v);
    const same = sorted.filter(x => getGameValue(x, currentLevel) === v);
    if (same.length >= 2) return same.slice(0, 2).map(x => x.id);
  }
  return null;
}

/** Smallest natural triple (value < J) from non-wildcard, non-joker cards. */
function findSmallestNaturalTripleIds(hand: Card[], currentLevel: number): string[] | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const groups = new Map<number, Card[]>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(c);
  }
  const entry = [...groups.entries()]
    .filter(([v, cards]) => v < 11 && cards.length >= 3)
    .sort((a, b) => a[0] - b[0])[0];
  return entry ? entry[1].slice(0, 3).map(c => c.id) : null;
}

/** Smallest natural straight (values 3-10, 5 consecutive, no wildcards). */
function findSmallestNaturalStraightIds(hand: Card[], currentLevel: number): string[] | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const byVal = new Map<number, Card>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    if (v >= 3 && v <= 10 && !byVal.has(v)) byVal.set(v, c);
  }
  for (let start = 3; start <= 6; start++) {
    const range = [start, start+1, start+2, start+3, start+4];
    if (range.every(v => byVal.has(v))) return range.map(v => byVal.get(v)!.id);
  }
  return null;
}

/** Smallest natural consecutive pairs (exactly 3 consecutive pairs = 6 cards, no wildcards). */
function findSmallestNaturalConsecPairsIds(hand: Card[], currentLevel: number): string[] | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const byVal = new Map<number, Card[]>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    if (v < 3 || v > 10) continue;
    if (!byVal.has(v)) byVal.set(v, []);
    if (byVal.get(v)!.length < 2) byVal.get(v)!.push(c);
  }
  const pairVals = [...byVal.keys()].filter(v => byVal.get(v)!.length >= 2).sort((a, b) => a - b);
  for (let i = 0; i + 2 < pairVals.length; i++) {
    if (pairVals[i + 1] === pairVals[i] + 1 && pairVals[i + 2] === pairVals[i] + 2) {
      // Take exactly 3 consecutive pair-ranks (6 cards)
      return [
        ...byVal.get(pairVals[i])!.map(c => c.id),
        ...byVal.get(pairVals[i + 1])!.map(c => c.id),
        ...byVal.get(pairVals[i + 2])!.map(c => c.id),
      ];
    }
  }
  return null;
}

/** Smallest natural triple+pair (triple value < J, pair from any remaining non-wildcard card). */
function findSmallestNaturalTriplePairIds(hand: Card[], currentLevel: number): string[] | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const byVal = new Map<number, Card[]>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    if (!byVal.has(v)) byVal.set(v, []);
    byVal.get(v)!.push(c);
  }
  const triples = [...byVal.entries()]
    .filter(([v, cards]) => v < 11 && cards.length >= 3)
    .sort((a, b) => a[0] - b[0]);
  for (const [, tripleCards] of triples) {
    const triple = tripleCards.slice(0, 3);
    const tripleIdSet = new Set(triple.map(c => c.id));
    const pairEntry = [...byVal.entries()]
      .filter(([, cards]) => cards.filter(c => !tripleIdSet.has(c.id)).length >= 2)
      .sort((a, b) => a[0] - b[0])[0];
    if (pairEntry) {
      const pairCards = pairEntry[1].filter(c => !tripleIdSet.has(c.id)).slice(0, 2);
      return [...triple, ...pairCards].map(c => c.id);
    }
  }
  return null;
}

/** Smallest natural consecutive triples (exactly 2 consecutive ranks × 3 = 6 cards, no wildcards). */
function findSmallestNaturalConsecTriplesIds(hand: Card[], currentLevel: number): string[] | null {
  const normals = hand.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);
  const byVal = new Map<number, Card[]>();
  for (const c of normals) {
    const v = getGameValue(c, currentLevel);
    if (v < 3 || v > 10) continue;
    if (!byVal.has(v)) byVal.set(v, []);
    byVal.get(v)!.push(c);
  }
  const tripleVals = [...byVal.keys()].filter(v => byVal.get(v)!.length >= 3).sort((a, b) => a - b);
  for (let i = 0; i + 1 < tripleVals.length; i++) {
    if (tripleVals[i + 1] === tripleVals[i] + 1) {
      // Take exactly 2 consecutive ranks (6 cards total)
      return [
        ...byVal.get(tripleVals[i])!.slice(0, 3).map(c => c.id),
        ...byVal.get(tripleVals[i + 1])!.slice(0, 3).map(c => c.id),
      ];
    }
  }
  return null;
}

/**
 * Smallest valid beat for SINGLE or PAIR types (used when rule bot passes).
 */
function findSmallestBeat(hand: Card[], req: HandResult, currentLevel: number): string[] | null {
  const sorted = [...hand].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel));

  if (req.type === HandType.SINGLE) {
    for (const c of sorted) {
      const h = classifyHand([c], currentLevel);
      if (h && canBeat(h, req)) return [c.id];
    }
  } else if (req.type === HandType.PAIR) {
    const normals = sorted.filter(c => !isWildcard(c, currentLevel));
    const seen = new Set<number>();
    for (const c of normals) {
      const v = getGameValue(c, currentLevel);
      if (seen.has(v)) continue;
      seen.add(v);
      const same = normals.filter(x => getGameValue(x, currentLevel) === v);
      if (same.length >= 2) {
        const h = classifyHand(same.slice(0, 2), currentLevel);
        if (h && canBeat(h, req)) return same.slice(0, 2).map(x => x.id);
      }
    }
  }
  return null;
}

/**
 * Generate candidate moves for ISMCTS evaluation.
 *
 * When leading (up to 3):
 *   1. Rule bot's choice
 *   2. Smallest low single (< J, if rule bot isn't playing a single)
 *   3. Smallest low pair (< J, if rule bot isn't playing a pair)
 *
 * When following (up to 3):
 *   1. Rule bot's choice (play or pass)
 *   2. Pass (always, as alternative)
 *   3. Smallest valid bomb (if available)
 *   + Smallest valid beat for SINGLE/PAIR (if rule bot passes)
 */
function generateCandidates(ctx: ISMCTSContext): string[][] {
  const myTeam = ctx.teams[ctx.mySeat];
  const lastPlaySeat = ctx.lastPlay?.seat as number | undefined;
  const lastPlayHandCount = lastPlaySeat !== undefined ? ctx.handCounts[lastPlaySeat] : undefined;
  const lastPlayIsOpponent = lastPlaySeat !== undefined && ctx.teams[lastPlaySeat] !== myTeam;

  // Minimum hand count among opponent seats
  const minOpponentCount = [0, 1, 2, 3]
    .filter(s => ctx.teams[s] !== myTeam)
    .reduce((min, s) => Math.min(min, ctx.handCounts[s]), 27);

  // Teammate context — needed so rule bot knows not to play over nearly-done teammate
  const teammateSeat = [0, 1, 2, 3].find(s => s !== ctx.mySeat && ctx.teams[s] === myTeam);
  const teammateId = teammateSeat !== undefined ? String(teammateSeat) : undefined;
  const teammateHandCount = teammateSeat !== undefined ? ctx.handCounts[teammateSeat] : undefined;
  const opponentHandCounts = [0, 1, 2, 3]
    .filter(s => ctx.teams[s] !== myTeam)
    .map(s => ctx.handCounts[s]);

  const ruleMove = getBotMove(ctx.myHand, ctx.lastPlay, ctx.currentLevel, teammateId, teammateHandCount, opponentHandCounts, lastPlayHandCount);
  const ruleIds = ruleMove?.cardIds ?? null;
  const candidates: string[][] = [];

  // ── Leading ──
  if (!ctx.lastPlay || ctx.lastPlay.seat === ctx.mySeat) {
    if (ruleIds && ruleIds.length > 0) candidates.push(ruleIds);

    // Smallest low single — skip when opponent has ≤1 card (they could beat it and go out)
    if (minOpponentCount > 1) {
      const sId = findSmallestLowSingleId(ctx.myHand, ctx.currentLevel);
      if (sId) candidates.push([sId]);
    }

    // Smallest low pair — skip when opponent has ≤2 cards (they may have a pair)
    if (minOpponentCount > 2) {
      const pIds = findSmallestLowPairIds(ctx.myHand, ctx.currentLevel);
      if (pIds) candidates.push(pIds);
    }

    // Natural combo candidates (dedup removes any that match rule bot's pick)
    const combos = [
      findSmallestNaturalTripleIds(ctx.myHand, ctx.currentLevel),
      findSmallestNaturalStraightIds(ctx.myHand, ctx.currentLevel),
      findSmallestNaturalConsecPairsIds(ctx.myHand, ctx.currentLevel),
      findSmallestNaturalTriplePairIds(ctx.myHand, ctx.currentLevel),
      findSmallestNaturalConsecTriplesIds(ctx.myHand, ctx.currentLevel),
    ];
    for (const c of combos) if (c) candidates.push(c);

    return dedup(candidates);
  }

  // ── Following ──
  // 1. Rule bot's choice
  if (ruleIds && ruleIds.length > 0) {
    candidates.push(ruleIds);
  } else {
    candidates.push([]); // rule bot passes

    // Smallest valid beat (lets ISMCTS decide: is playing better than passing?)
    const beat = findSmallestBeat(ctx.myHand, ctx.lastPlay.hand, ctx.currentLevel);
    if (beat) candidates.push(beat);
  }

  // 2. Pass as alternative to rule bot's play
  candidates.push([]);

  // 3. Smallest bomb that can beat the current last play.
  //
  //    Priority override: if the opponent who just played has ≤6 cards (not 4),
  //    they're nearly out — the rule bot already bombs (candidate 0), and we do NOT
  //    suppress the extra bomb candidate either (ISMCTS should strongly prefer bombing).
  const opponentNearlyOut = lastPlayIsOpponent
    && lastPlayHandCount !== undefined
    && lastPlayHandCount <= 6
    && lastPlayHandCount !== 4;

  // Whether last play is a "small" single or pair: not a wildcard (no jokers, no level cards).
  // Against these, bombing is wasteful — regular card beats work fine.
  const lastPlayType = ctx.lastPlay.hand.type;
  const isSmallSingleOrPair = (lastPlayType === HandType.SINGLE || lastPlayType === HandType.PAIR)
    && ctx.lastPlay.cards.every(c => !isWildcard(c, ctx.currentLevel));

  const allBombs = onlyBombsLeft(ctx.myHand, ctx.currentLevel);

  const suppressBomb =
    !lastPlayIsOpponent                                               // teammate played → never bomb
    || (lastPlayHandCount === 4 && !allBombs)                        // opponent has 4 cards
    || (!opponentNearlyOut && isSmallSingleOrPair)                   // small single/pair, not nearly out
    || (!opponentNearlyOut && ctx.myHand.length <= 10 && !allBombs); // conserve bomb when ≤10 cards

  if (!suppressBomb) {
    const bomb = findSmallestBombIds(ctx.myHand, ctx.currentLevel);
    if (bomb) {
      // Only add if this bomb can actually beat the current last play
      const bombCards = ctx.myHand.filter(c => bomb.includes(c.id));
      const bombHand = classifyHand(bombCards, ctx.currentLevel);
      if (bombHand && canBeat(bombHand, ctx.lastPlay.hand)) {
        candidates.push(bomb);
      }
    }
  }

  return dedup(candidates);
}

// ── Main exported function ────────────────────────────────────────────────────

export interface ISMCTSResult {
  cardIds: string[] | null;
  log: string;
}

/**
 * Evaluate candidate moves via determinized Monte Carlo simulation.
 *
 * @param ctx     Full game context from the server.
 * @param budgetMs Time budget in milliseconds (typically 1500-3000).
 * @returns ISMCTSResult with chosen card IDs (null = pass) and a log string.
 *          Caller is responsible for printing the log (appended with the final action).
 */
export function ismctsEvaluate(ctx: ISMCTSContext, budgetMs: number): ISMCTSResult {
  const candidates = generateCandidates(ctx);

  if (candidates.length === 0) {
    return { cardIds: null, log: `[ISMCTS] seat=${ctx.mySeat} no candidates` };
  }
  if (candidates.length === 1) {
    const c = candidates[0];
    return { cardIds: c.length > 0 ? c : null, log: `[ISMCTS] seat=${ctx.mySeat} 1 candidate (forced)` };
  }

  const wins = new Array(candidates.length).fill(0);
  const sims = new Array(candidates.length).fill(0);
  const myTeam = ctx.teams[ctx.mySeat];
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const worldHands = determinize(ctx);
    if (!worldHands) break;

    for (let i = 0; i < candidates.length; i++) {
      // Fresh state for each candidate
      const state: SimState = {
        hands: worldHands.map(h => [...h]),
        turn: ctx.mySeat,
        lastPlay: ctx.lastPlay,
        consecutivePasses: ctx.consecutivePasses,
        finishOrder: [...ctx.finishOrder],
        teams: [...ctx.teams],
        currentLevel: ctx.currentLevel,
      };

      const candidate = candidates[i];
      const res = applyToSim(state, ctx.mySeat, candidate.length > 0 ? candidate : null);

      const reward = res === 'game_over'
        ? calculateReward(state.finishOrder, state.teams, myTeam)
        : simulateToEnd(state, myTeam);

      wins[i] += reward;
      sims[i]++;
    }
  }

  // Pick candidate with highest win rate (rule bot's move breaks ties at index 0)
  let bestIdx = 0;
  let bestRate = -1;
  for (let i = 0; i < candidates.length; i++) {
    if (sims[i] === 0) continue;
    const rate = wins[i] / sims[i];
    if (rate > bestRate) {
      bestRate = rate;
      bestIdx = i;
    }
  }

  const totalSims = sims.reduce((a, b) => a + b, 0);
  const rateStr = candidates.map((_, i) =>
    sims[i] > 0 ? `${(wins[i] / sims[i] * 100).toFixed(1)}%` : '-'
  ).join(', ');
  const log = `[ISMCTS] seat=${ctx.mySeat} ${totalSims} sims | rates: [${rateStr}] → candidate ${bestIdx}`;

  const best = candidates[bestIdx];
  return { cardIds: best.length > 0 ? best : null, log };
}
