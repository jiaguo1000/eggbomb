import { Card, Suit, HandType, HandResult } from './types';

/**
 * Returns the game value of a card for comparison purposes.
 * Order: 2<3<4<5<6<7<8<9<10<J<Q<K<A<[level card]<小王<大王
 */
export function getGameValue(card: Card, currentLevel: number): number {
  if (card.suit === Suit.JOKER) {
    return card.rank === 14 ? 17 : 18; // small joker=17, big joker=18
  }
  if (card.rank === currentLevel) return 16; // level card beats A
  if (card.rank === 1) return 14;   // Ace
  return card.rank;  // 3-13 natural; 2→2 (lowest), A→14
}

/**
 * Returns true if this card is the wildcard (red heart level card).
 */
export function isWildcard(card: Card, currentLevel: number): boolean {
  const levelRank = currentLevel === 14 ? 1 : currentLevel;
  return card.suit === Suit.HEART && card.rank === levelRank;
}

/**
 * Attempt to classify a set of cards as a valid 掼蛋 hand.
 * Returns HandResult or null if not a valid hand.
 * currentLevel: the numeric rank of the current level (e.g. 2 for level 2).
 */
export function classifyHand(cards: Card[], currentLevel: number): HandResult | null {
  if (!cards || cards.length === 0) return null;

  const wildcards = cards.filter((c) => isWildcard(c, currentLevel));
  const normals = cards.filter((c) => !isWildcard(c, currentLevel));
  const wc = wildcards.length;
  const total = cards.length;

  // Helper: get game values of normal cards
  const vals = normals.map((c) => getGameValue(c, currentLevel));

  // Wildcards cannot substitute for jokers: if any normal card is a joker, no wildcards allowed
  const hasJokerInNormals = normals.some((c) => c.suit === Suit.JOKER);
  if (hasJokerInNormals && wc > 0) return null;

  // ── JOKER_BOMB: exactly 2 small jokers + 2 big jokers (4 total) ──
  if (total === 4 && wc === 0) {
    const smallCount = normals.filter((c) => c.suit === Suit.JOKER && c.rank === 14).length;
    const bigCount = normals.filter((c) => c.suit === Suit.JOKER && c.rank === 15).length;
    if (smallCount === 2 && bigCount === 2) {
      return { type: HandType.JOKER_BOMB, rank: 100, length: 4 };
    }
  }

  // ── SINGLE ──
  if (total === 1) {
    const val = wc > 0 ? 16 : vals[0];
    return { type: HandType.SINGLE, rank: val, length: 1 };
  }

  // ── PAIR ──
  if (total === 2) {
    if (wc === 2) return { type: HandType.PAIR, rank: 16, length: 2 };
    // Wildcard cannot pair with a joker
    if (wc === 1 && !hasJokerInNormals) return { type: HandType.PAIR, rank: vals[0], length: 2 };
    if (wc === 0 && vals[0] === vals[1]) return { type: HandType.PAIR, rank: vals[0], length: 2 };
    return null;
  }

  // ── TRIPLE ──
  if (total === 3) {
    if (wc === 3) return { type: HandType.TRIPLE, rank: 16, length: 3 };
    if (wc === 2) return { type: HandType.TRIPLE, rank: vals[0], length: 3 };
    if (wc === 1 && vals[0] === vals[1]) return { type: HandType.TRIPLE, rank: vals[0], length: 3 };
    if (wc === 0 && vals[0] === vals[1] && vals[1] === vals[2]) return { type: HandType.TRIPLE, rank: vals[0], length: 3 };
    return null;
  }

  // ── BOMB_QUAD (4 same) ──
  if (total === 4) {
    if (wc === 4) return { type: HandType.BOMB_QUAD, rank: 16, length: 4 };
    if (wc === 3) return { type: HandType.BOMB_QUAD, rank: vals[0], length: 4 };
    if (wc === 2 && vals[0] === vals[1]) return { type: HandType.BOMB_QUAD, rank: vals[0], length: 4 };
    if (wc === 1 && vals[0] === vals[1] && vals[1] === vals[2]) return { type: HandType.BOMB_QUAD, rank: vals[0], length: 4 };
    if (wc === 0 && vals.every((v) => v === vals[0])) return { type: HandType.BOMB_QUAD, rank: vals[0], length: 4 };
    return null;
  }

  // ── BOMB_5 (5 same) — checked before TRIPLE_PAIR: bombs take priority ──
  // e.g. [3, 3, 3, wc, wc] is BOMB_5 not TRIPLE_PAIR
  if (total === 5) {
    const bombResult = tryNOfAKind(normals, wildcards, 5, HandType.BOMB_5, currentLevel);
    if (bombResult) return bombResult;
  }

  // ── TRIPLE_PAIR (5 cards: triple + pair) ──
  if (total === 5) {
    const result = tryTriplePair(normals, wildcards, currentLevel);
    if (result) return result;
  }

  // ── BOMB_6 (6 same) ──
  if (total === 6) {
    const bombResult = tryNOfAKind(normals, wildcards, 6, HandType.BOMB_6, currentLevel);
    if (bombResult) return bombResult;
  }

  // ── BOMB_7 (7 same) ──
  if (total === 7) {
    const bombResult = tryNOfAKind(normals, wildcards, 7, HandType.BOMB_7, currentLevel);
    if (bombResult) return bombResult;
  }

  // ── BOMB_8 (8 same) ──
  if (total === 8) {
    const bombResult = tryNOfAKind(normals, wildcards, 8, HandType.BOMB_8, currentLevel);
    if (bombResult) return bombResult;
  }

  // ── STRAIGHT (5+ consecutive, no 2s, level card allowed at its rank position) ──
  if (total >= 5) {
    const straightResult = tryStraight(normals, wildcards, currentLevel);
    if (straightResult) return straightResult;

    // ── STRAIGHT_FLUSH (5+ consecutive same suit) ──
    const sfResult = tryStraightFlush(normals, wildcards, currentLevel);
    if (sfResult) return sfResult;

    // ── CONSECUTIVE_PAIRS (exactly 3 consecutive pairs = 6 cards) ──
    if (total === 6) {
      const cpResult = tryConsecutivePairs(normals, wildcards, currentLevel);
      if (cpResult) return cpResult;
    }

    // ── CONSECUTIVE_TRIPLES (exactly 2 consecutive triples = 6 cards) ──
    if (total === 6) {
      const ctResult = tryConsecutiveTriples(normals, wildcards, currentLevel);
      if (ctResult) return ctResult;
    }
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tryNOfAKind(
  normals: Card[],
  wildcards: Card[],
  n: number,
  type: HandType,
  currentLevel: number
): HandResult | null {
  const wc = wildcards.length;
  if (normals.length + wc !== n) return null;
  if (normals.length === 0) return { type, rank: 16, length: n };
  const vals = normals.map((c) => getGameValue(c, currentLevel));
  const allSame = vals.every((v) => v === vals[0]);
  if (!allSame) return null;
  const needed = n - normals.length;
  if (wc >= needed) return { type, rank: vals[0], length: n };
  return null;
}

function tryTriplePair(normals: Card[], wildcards: Card[], currentLevel: number): HandResult | null {
  if (normals.length + wildcards.length !== 5) return null;
  const wc = wildcards.length;
  const vals = normals.map((c) => getGameValue(c, currentLevel)).sort((a, b) => a - b);

  // Try each possible split: which 3 form the triple, which 2 form the pair
  // With wildcards, try all arrangements
  const groups = groupByValue(vals);
  const entries = Object.entries(groups).map(([v, cnt]) => ({ v: Number(v), cnt }));

  if (wc === 0) {
    // Must have exactly groups of 3 and 2
    if (entries.length === 2) {
      const triple = entries.find((e) => e.cnt === 3);
      const pair = entries.find((e) => e.cnt === 2);
      if (triple && pair) return { type: HandType.TRIPLE_PAIR, rank: triple.v, length: 5 };
    }
    return null;
  }

  // With wildcards: find triple rank
  // Possible: 3+wc>=3 for triple, 2+remaining>=2 for pair
  for (const e1 of entries) {
    for (const e2 of entries) {
      if (e1.v === e2.v) continue;
      const tripleNeeded = Math.max(0, 3 - e1.cnt);
      const pairNeeded = Math.max(0, 2 - e2.cnt);
      if (tripleNeeded + pairNeeded <= wc && e1.cnt <= 3 && e2.cnt <= 2) {
        return { type: HandType.TRIPLE_PAIR, rank: e1.v > e2.v ? e1.v : e2.v, length: 5 };
      }
    }
  }
  // One group with wildcards filling both roles
  if (entries.length === 1) {
    const e = entries[0];
    if (e.cnt === 2 && wc === 3) return { type: HandType.TRIPLE_PAIR, rank: 16, length: 5 };
    if (e.cnt === 3 && wc === 2) return { type: HandType.TRIPLE_PAIR, rank: e.v, length: 5 };
    if (e.cnt === 4 && wc === 1) {
      // 4 same + wildcard: triple = 3 of them, pair = remaining 1 + wildcard
      return { type: HandType.TRIPLE_PAIR, rank: e.v, length: 5 };
    }
  }
  if (entries.length === 0 && wc === 5) return { type: HandType.TRIPLE_PAIR, rank: 16, length: 5 };

  return null;
}

/** Natural rank value for use in straights: 2=2, 3-K=3-13, A=14. Returns null for jokers (can't be in straights). Wildcards are handled separately. */
function getStraightValue(card: Card): number | null {
  if (card.suit === Suit.JOKER) return null;
  if (card.rank === 1) return 14;
  return card.rank; // 2-13 natural
}

function tryStraight(normals: Card[], wildcards: Card[], currentLevel: number): HandResult | null {
  const total = normals.length + wildcards.length;
  if (total < 5) return null;

  const vals: number[] = [];
  for (const c of normals) {
    const v = getStraightValue(c);
    if (v === null) return null; // joker can't be in straight
    vals.push(v);
  }

  const wc = wildcards.length;
  const groups = groupByValue(vals);

  // Duplicates not allowed in straights
  if (Object.values(groups).some((cnt) => cnt > 1)) return null;

  const uniqueVals = Object.keys(groups).map(Number).sort((a, b) => a - b);

  if (uniqueVals.length === 0) {
    return { type: HandType.STRAIGHT, rank: 14, length: total };
  }

  // Special case: A-2-3-4-5 wrap straight (rank 5, weaker than 2-3-4-5-6)
  // Represented as vals containing both 14 (A) and low cards 2-5
  if (uniqueVals.includes(14)) {
    const lowVals = uniqueVals.filter((v) => v !== 14);
    if (lowVals.length > 0 && lowVals[lowVals.length - 1] <= 5) {
      // Treat A as rank 1 for this straight: sequence is 1,2,3,4,5
      const wrapVals = [1, ...lowVals];
      const wrapSpan = wrapVals[wrapVals.length - 1] - wrapVals[0] + 1;
      const wrapGaps = wrapSpan - wrapVals.length;
      if (wrapGaps <= wc && wrapVals[0] === 1) {
        const extraWc = wc - wrapGaps;
        const finalMax = Math.min(wrapVals[wrapVals.length - 1] + extraWc, 5);
        if (finalMax >= wrapVals[wrapVals.length - 1] && total === wrapVals.length + wrapGaps + (wc - wrapGaps)) {
          // rank uses a special low value: -1 signals "A-low straight" topping at finalMax
          // We encode rank as finalMax but subtract 13 to place below 2-3-4-5-6 (rank 6)
          return { type: HandType.STRAIGHT, rank: finalMax - 13, length: total };
        }
      }
    }
  }

  const minVal = uniqueVals[0];
  const maxVal = uniqueVals[uniqueVals.length - 1];
  const span = maxVal - minVal + 1;
  const gaps = span - uniqueVals.length;
  if (gaps > wc) return null;

  const extraWc = wc - gaps;
  const finalMax = Math.min(maxVal + extraWc, 14);
  if (finalMax < maxVal) return null;

  return { type: HandType.STRAIGHT, rank: finalMax, length: total };
}

function tryStraightFlush(normals: Card[], wildcards: Card[], currentLevel: number): HandResult | null {
  const total = normals.length + wildcards.length;
  if (total < 5) return null;

  // All normal cards must be same suit (jokers excluded from straight flush)
  if (normals.some((c) => c.suit === Suit.JOKER)) return null;
  if (normals.length > 0) {
    const suit = normals[0].suit;
    if (!normals.every((c) => c.suit === suit)) return null;
  }

  // Now check if it forms a straight
  const straightResult = tryStraight(normals, wildcards, currentLevel);
  if (!straightResult) return null;

  return { type: HandType.STRAIGHT_FLUSH, rank: straightResult.rank, length: total };
}

function tryConsecutivePairs(normals: Card[], wildcards: Card[], currentLevel: number): HandResult | null {
  const total = normals.length + wildcards.length;
  if (total !== 6) return null;
  const pairs = 3;

  // Use natural rank values; exclude jokers from consecutive pairs
  const vals: number[] = [];
  for (const c of normals) {
    const v = getStraightValue(c);
    if (v === null) return null; // jokers can't be in consecutive pairs
    vals.push(v);
  }

  const wc = wildcards.length;
  const groups = groupByValue(vals);
  const entries = Object.entries(groups)
    .map(([v, cnt]) => ({ v: Number(v), cnt }))
    .sort((a, b) => a.v - b.v);

  if (entries.length === 0) {
    return { type: HandType.CONSECUTIVE_PAIRS, rank: 14, length: total };
  }

  // Count wildcards needed: for each group, if cnt > 2, need (cnt-2) wildcards to "fix"
  // Actually for consecutive pairs we need exactly 2 of each rank in a sequence
  const minV = entries[0].v;
  const maxV = entries[entries.length - 1].v;
  const span = maxV - minV + 1;

  if (span < 3) return null; // need at least 3 consecutive ranks

  let wcNeeded = 0;
  for (let v = minV; v <= maxV; v++) {
    const cnt = groups[v] ?? 0;
    if (cnt > 2) wcNeeded += (cnt - 2); // extra copies beyond pair
    else wcNeeded += (2 - cnt);         // need to fill up to pair
  }

  if (wcNeeded <= wc && span === pairs) {
    return { type: HandType.CONSECUTIVE_PAIRS, rank: maxV, length: total };
  }

  // Wrap-around: A(14) adjacent to 2 — e.g. AA2233 (smallest consecutive pairs, rank=3)
  if (vals.includes(14) && vals.includes(2)) {
    const wrapGroups: Record<number, number> = {};
    for (const v of vals) {
      const wv = v === 14 ? 1 : v;
      wrapGroups[wv] = (wrapGroups[wv] ?? 0) + 1;
    }
    const wrapEntries = Object.entries(wrapGroups)
      .map(([v, cnt]) => ({ v: Number(v), cnt }))
      .sort((a, b) => a.v - b.v);
    const wrapMinV = wrapEntries[0].v;
    const wrapMaxV = wrapEntries[wrapEntries.length - 1].v;
    const wrapSpan = wrapMaxV - wrapMinV + 1;
    let wrapWcNeeded = 0;
    for (let v = wrapMinV; v <= wrapMaxV; v++) {
      const cnt = wrapGroups[v] ?? 0;
      if (cnt > 2) wrapWcNeeded += (cnt - 2);
      else wrapWcNeeded += (2 - cnt);
    }
    if (wrapWcNeeded <= wc && wrapSpan === pairs) {
      return { type: HandType.CONSECUTIVE_PAIRS, rank: wrapMaxV, length: total };
    }
  }

  return null;
}

function tryConsecutiveTriples(normals: Card[], wildcards: Card[], currentLevel: number): HandResult | null {
  const total = normals.length + wildcards.length;
  if (total !== 6) return null; // exactly 2 consecutive triples (6 cards) — 777888 or 888999 etc.
  const triples = 2;

  // Use natural rank values; exclude jokers
  const vals: number[] = [];
  for (const c of normals) {
    const v = getStraightValue(c);
    if (v === null) return null; // jokers can't be in consecutive triples
    vals.push(v);
  }

  const wc = wildcards.length;
  const groups = groupByValue(vals);
  const entries = Object.entries(groups)
    .map(([v, cnt]) => ({ v: Number(v), cnt }))
    .sort((a, b) => a.v - b.v);

  if (entries.length === 0) {
    return { type: HandType.CONSECUTIVE_TRIPLES, rank: 14, length: total };
  }

  const minV = entries[0].v;
  const maxV = entries[entries.length - 1].v;
  const span = maxV - minV + 1;

  if (span < 2) return null; // need at least 2 consecutive ranks

  // Calculate wildcards needed: each rank needs exactly 3 cards
  let wcNeeded = 0;
  for (let v = minV; v <= maxV; v++) {
    const cnt = groups[v] ?? 0;
    if (cnt > 3) wcNeeded += (cnt - 3);
    else wcNeeded += (3 - cnt);
  }

  if (wcNeeded <= wc && span === triples) {
    return { type: HandType.CONSECUTIVE_TRIPLES, rank: maxV, length: total };
  }

  // Wrap-around: A(14) adjacent to 2 — e.g. AAA222 (smallest consecutive triples, rank=2)
  if (vals.includes(14) && vals.includes(2)) {
    const wrapGroups: Record<number, number> = {};
    for (const v of vals) {
      const wv = v === 14 ? 1 : v;
      wrapGroups[wv] = (wrapGroups[wv] ?? 0) + 1;
    }
    const wrapEntries = Object.entries(wrapGroups)
      .map(([v, cnt]) => ({ v: Number(v), cnt }))
      .sort((a, b) => a.v - b.v);
    const wrapMinV = wrapEntries[0].v;
    const wrapMaxV = wrapEntries[wrapEntries.length - 1].v;
    const wrapSpan = wrapMaxV - wrapMinV + 1;
    let wrapWcNeeded = 0;
    for (let v = wrapMinV; v <= wrapMaxV; v++) {
      const cnt = wrapGroups[v] ?? 0;
      if (cnt > 3) wrapWcNeeded += (cnt - 3);
      else wrapWcNeeded += (3 - cnt);
    }
    if (wrapWcNeeded <= wc && wrapSpan === triples) {
      return { type: HandType.CONSECUTIVE_TRIPLES, rank: wrapMaxV, length: total };
    }
  }

  return null;
}

function groupByValue(vals: number[]): Record<number, number> {
  const groups: Record<number, number> = {};
  for (const v of vals) {
    groups[v] = (groups[v] ?? 0) + 1;
  }
  return groups;
}

// ── Bomb check ────────────────────────────────────────────────────────────────

export function isBomb(hand: HandResult): boolean {
  return [
    HandType.BOMB_QUAD,
    HandType.BOMB_5,
    HandType.BOMB_6,
    HandType.BOMB_7,
    HandType.BOMB_8,
    HandType.STRAIGHT_FLUSH,
    HandType.JOKER_BOMB,
  ].includes(hand.type);
}

/**
 * Returns numeric bomb power for comparing two bombs.
 * Higher = stronger.
 */
function bombPower(hand: HandResult): number {
  // Hierarchy: JOKER_BOMB > BOMB_8 > BOMB_7 > BOMB_6 > STRAIGHT_FLUSH > BOMB_5 > BOMB_QUAD
  if (hand.type === HandType.JOKER_BOMB) return 10000;
  if (hand.type === HandType.BOMB_8) return 5000 + hand.rank;
  if (hand.type === HandType.BOMB_7) return 3000 + hand.rank;
  if (hand.type === HandType.BOMB_6) return 1000 + hand.rank;
  if (hand.type === HandType.STRAIGHT_FLUSH) return 500 + hand.rank;
  if (hand.type === HandType.BOMB_5) return 200 + hand.rank;
  if (hand.type === HandType.BOMB_QUAD) return 100 + hand.rank;
  return 0;
}

/**
 * Returns true if `newHand` can beat `lastHand`.
 */
export function canBeat(newHand: HandResult, lastHand: HandResult): boolean {
  const newIsBomb = isBomb(newHand);
  const lastIsBomb = isBomb(lastHand);

  if (newIsBomb && !lastIsBomb) return true;
  if (!newIsBomb && lastIsBomb) return false;

  if (newIsBomb && lastIsBomb) {
    return bombPower(newHand) > bombPower(lastHand);
  }

  // Both non-bombs: must be same type and same length
  if (newHand.type !== lastHand.type) return false;
  if (newHand.length !== lastHand.length) return false;
  return newHand.rank > lastHand.rank;
}

/**
 * Returns ALL valid hand classifications for a set of cards.
 * Used to detect ambiguity when wildcards allow multiple interpretations.
 */
export function classifyAllPossible(cards: Card[], currentLevel: number): HandResult[] {
  if (!cards || cards.length === 0) return [];

  const wildcards = cards.filter((c) => isWildcard(c, currentLevel));
  const normals = cards.filter((c) => !isWildcard(c, currentLevel));
  const wc = wildcards.length;
  const total = cards.length;
  const vals = normals.map((c) => getGameValue(c, currentLevel));
  const hasJokerInNormals = normals.some((c) => c.suit === Suit.JOKER);

  const results: HandResult[] = [];

  // JOKER_BOMB
  if (total === 4 && wc === 0) {
    const smallCount = normals.filter((c) => c.suit === Suit.JOKER && c.rank === 14).length;
    const bigCount = normals.filter((c) => c.suit === Suit.JOKER && c.rank === 15).length;
    if (smallCount === 2 && bigCount === 2) {
      results.push({ type: HandType.JOKER_BOMB, rank: 100, length: 4 });
      return results; // joker bomb is unambiguous
    }
  }

  if (total === 1) return [classifyHand(cards, currentLevel)].filter(Boolean) as HandResult[];

  // For 2-card hands, no ambiguity
  if (total === 2) {
    const r = classifyHand(cards, currentLevel);
    return r ? [r] : [];
  }

  // For 3-card hands, no ambiguity
  if (total === 3) {
    const r = classifyHand(cards, currentLevel);
    return r ? [r] : [];
  }

  // 4 cards: could be BOMB_QUAD only (no 三带一 in 掼蛋)
  if (total === 4) {
    const r = classifyHand(cards, currentLevel);
    return r ? [r] : [];
  }

  // 5 cards: could be TRIPLE_PAIR, BOMB_5, STRAIGHT, STRAIGHT_FLUSH
  if (total === 5) {
    const types = [HandType.TRIPLE_PAIR, HandType.BOMB_5, HandType.STRAIGHT, HandType.STRAIGHT_FLUSH];
    for (const type of types) {
      const r = trySpecificType(cards, normals, wildcards, type, currentLevel, vals, hasJokerInNormals);
      if (r) results.push(r);
    }
    return results;
  }

  // 6+ cards: BOMB_6, CONSECUTIVE_PAIRS, CONSECUTIVE_TRIPLES, STRAIGHT, STRAIGHT_FLUSH
  if (total === 6) {
    const types = [HandType.BOMB_6, HandType.CONSECUTIVE_PAIRS, HandType.CONSECUTIVE_TRIPLES, HandType.STRAIGHT, HandType.STRAIGHT_FLUSH];
    for (const type of types) {
      const r = trySpecificType(cards, normals, wildcards, type, currentLevel, vals, hasJokerInNormals);
      if (r) results.push(r);
    }
    return results;
  }

  // 7 cards
  if (total === 7) {
    const types = [HandType.BOMB_7, HandType.STRAIGHT, HandType.STRAIGHT_FLUSH];
    for (const type of types) {
      const r = trySpecificType(cards, normals, wildcards, type, currentLevel, vals, hasJokerInNormals);
      if (r) results.push(r);
    }
    return results;
  }

  // 8 cards
  if (total === 8) {
    const types = [HandType.BOMB_8, HandType.STRAIGHT, HandType.STRAIGHT_FLUSH];
    for (const type of types) {
      const r = trySpecificType(cards, normals, wildcards, type, currentLevel, vals, hasJokerInNormals);
      if (r) results.push(r);
    }
    return results;
  }

  // 9+ cards
  if (total >= 9) {
    const types = [HandType.STRAIGHT, HandType.STRAIGHT_FLUSH];
    for (const type of types) {
      const r = trySpecificType(cards, normals, wildcards, type, currentLevel, vals, hasJokerInNormals);
      if (r) results.push(r);
    }
    return results;
  }

  const r = classifyHand(cards, currentLevel);
  return r ? [r] : [];
}

function trySpecificType(
  cards: Card[],
  normals: Card[],
  wildcards: Card[],
  type: HandType,
  currentLevel: number,
  vals: number[],
  hasJokerInNormals: boolean
): HandResult | null {
  const total = cards.length;
  const wc = wildcards.length;

  if (hasJokerInNormals && wc > 0) return null;

  switch (type) {
    case HandType.TRIPLE_PAIR:
      if (total !== 5) return null;
      return tryTriplePair(normals, wildcards, currentLevel);
    case HandType.BOMB_5:
      if (total !== 5) return null;
      return tryNOfAKind(normals, wildcards, 5, HandType.BOMB_5, currentLevel);
    case HandType.BOMB_6:
      if (total !== 6) return null;
      return tryNOfAKind(normals, wildcards, 6, HandType.BOMB_6, currentLevel);
    case HandType.BOMB_7:
      if (total !== 7) return null;
      return tryNOfAKind(normals, wildcards, 7, HandType.BOMB_7, currentLevel);
    case HandType.BOMB_8:
      if (total !== 8) return null;
      return tryNOfAKind(normals, wildcards, 8, HandType.BOMB_8, currentLevel);
    case HandType.STRAIGHT:
      if (total < 5) return null;
      return tryStraight(normals, wildcards, currentLevel);
    case HandType.STRAIGHT_FLUSH:
      if (total < 5) return null;
      return tryStraightFlush(normals, wildcards, currentLevel);
    case HandType.CONSECUTIVE_PAIRS:
      if (total !== 6) return null;
      return tryConsecutivePairs(normals, wildcards, currentLevel);
    case HandType.CONSECUTIVE_TRIPLES:
      if (total !== 6) return null;
      return tryConsecutiveTriples(normals, wildcards, currentLevel);
    default:
      return null;
  }
}
