import { Card, Suit, HandType, HandResult, LastPlay } from '@eggbomb/shared';
import { classifyHand, canBeat, getGameValue, isWildcard } from '@eggbomb/shared';

function isBombType(type: HandType): boolean {
  return [HandType.BOMB_QUAD, HandType.BOMB_5, HandType.BOMB_6, HandType.BOMB_7, HandType.BOMB_8, HandType.JOKER_BOMB, HandType.STRAIGHT_FLUSH].includes(type);
}

function getPairsSmallestFirst(wildcards: Card[], normals: Card[], currentLevel: number): Card[][] {
  const pairs: Card[][] = [];
  const seen = new Set<number>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (seen.has(v)) continue;
    seen.add(v);
    const sameVal = normals.filter(c => getGameValue(c, currentLevel) === v);
    if (sameVal.length >= 2) pairs.push(sameVal.slice(0, 2));
    else if (wildcards.length >= 1) pairs.push([sameVal[0], wildcards[0]]);
  }
  // Two wildcards must go to separate combos — never form a wc+wc pair
  return pairs;
}

function getTriplesSmallestFirst(wildcards: Card[], normals: Card[], currentLevel: number): Card[][] {
  const triples: Card[][] = [];
  const seen = new Set<number>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (seen.has(v)) continue;
    seen.add(v);
    const sameVal = normals.filter(c => getGameValue(c, currentLevel) === v);
    let triple: Card[] | null = null;
    if (sameVal.length >= 3) triple = sameVal.slice(0, 3);
    else if (sameVal.length === 2 && wildcards.length >= 1) triple = [...sameVal, wildcards[0]];
    // sameVal=1 needs 2 wildcards — violates "two wildcards must be in separate combos"
    if (triple) triples.push(triple);
  }
  // 3 wildcards as a triple also violates the rule — omitted
  return triples;
}

/** Returns true if every card in hand is part of a bomb group (no loose singles/pairs/etc) */
export function onlyBombsLeft(hand: Card[], currentLevel: number): boolean {
  if (hand.length === 0) return false;
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const nonWild = hand.filter(c => !isWildcard(c, currentLevel));
  const jokers = nonWild.filter(c => c.suit === Suit.JOKER);
  const regular = nonWild.filter(c => c.suit !== Suit.JOKER);

  const groups = new Map<number, number>();
  for (const c of regular) {
    const v = getGameValue(c, currentLevel);
    groups.set(v, (groups.get(v) ?? 0) + 1);
  }
  let wcLeft = wildcards.length;
  for (const [, cnt] of groups) {
    if (cnt < 4) {
      const need = 4 - cnt;
      if (wcLeft < need) return false;
      wcLeft -= need;
    }
  }

  const smallJ = jokers.filter(c => c.rank === 14).length;
  const bigJ = jokers.filter(c => c.rank === 15).length;
  const jBombs = Math.min(Math.floor(smallJ / 2), Math.floor(bigJ / 2));
  if (smallJ !== jBombs * 2 || bigJ !== jBombs * 2) return false;

  return true;
}

/** Find the smallest straight of the required length that beats `required`. */
function findStraightBeating(hand: Card[], required: HandResult, currentLevel: number): string[] | null {
  const len = required.length;
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const normals = hand.filter(c => !isWildcard(c, currentLevel));

  const byValue = new Map<number, Card[]>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (v <= 2 || v >= 15) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(card);
  }

  for (let topVal = required.rank + 1; topVal <= 14; topVal++) {
    const startVal = topVal - len + 1;
    if (startVal < 3) continue;
    let wcUsed = 0;
    const cards: Card[] = [];
    let valid = true;
    for (let v = startVal; v <= topVal; v++) {
      const avail = byValue.get(v);
      if (avail && avail.length > 0) {
        cards.push(avail[0]);
      } else if (wcUsed < wildcards.length) {
        cards.push(wildcards[wcUsed++]);
      } else { valid = false; break; }
    }
    if (!valid) continue;
    const h = classifyHand(cards, currentLevel);
    if (h && h.type === required.type && h.length === len && canBeat(h, required)) return cards.map(c => c.id);
  }
  return null;
}

/** Find the smallest triple+pair (三带二) that beats `required`. */
function findTriplePairBeating(hand: Card[], required: HandResult, currentLevel: number): string[] | null {
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const normals = hand.filter(c => !isWildcard(c, currentLevel));

  const byValue = new Map<number, Card[]>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(card);
  }
  const sortedVals = [...byValue.keys()].sort((a, b) => a - b);

  for (const tv of sortedVals) {
    if (tv <= required.rank) continue;
    const tc = byValue.get(tv)!;
    const wcForT = Math.max(0, 3 - tc.length);
    if (wcForT > wildcards.length) continue;
    const tripleGroup = [...tc.slice(0, Math.min(tc.length, 3)), ...wildcards.slice(0, wcForT)];
    const wcLeft = wildcards.slice(wcForT);

    // Prefer pair values with count<3 (don't break a triple); fall back to count>=3
    const pairCandidates = sortedVals
      .filter(pv => pv !== tv)
      .sort((a, b) => {
        const aBreaks = (byValue.get(a)!.length >= 3) ? 1 : 0;
        const bBreaks = (byValue.get(b)!.length >= 3) ? 1 : 0;
        if (aBreaks !== bBreaks) return aBreaks - bBreaks;
        return a - b;
      });
    for (const pv of pairCandidates) {
      const pc = byValue.get(pv)!;
      const wcForP = Math.max(0, 2 - pc.length);
      if (wcForP > wcLeft.length) continue;
      const pairGroup = [...pc.slice(0, Math.min(pc.length, 2)), ...wcLeft.slice(0, wcForP)];
      const combo = [...tripleGroup, ...pairGroup];
      const h = classifyHand(combo, currentLevel);
      if (h && h.type === HandType.TRIPLE_PAIR && canBeat(h, required)) return combo.map(c => c.id);
    }
    if (wcLeft.length >= 2) {
      const combo = [...tripleGroup, ...wcLeft.slice(0, 2)];
      const h = classifyHand(combo, currentLevel);
      if (h && h.type === HandType.TRIPLE_PAIR && canBeat(h, required)) return combo.map(c => c.id);
    }
  }
  return null;
}

/** Find the smallest consecutive pairs (连对) of the required length that beats `required`. */
function findConsecutivePairsBeating(hand: Card[], required: HandResult, currentLevel: number): string[] | null {
  const pairCount = required.length / 2;
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const normals = hand.filter(c => !isWildcard(c, currentLevel));

  const byValue = new Map<number, Card[]>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (v <= 2 || v >= 15) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(card);
  }

  for (let topVal = required.rank + 1; topVal <= 14; topVal++) {
    const startVal = topVal - pairCount + 1;
    if (startVal < 3) continue;
    let wcUsed = 0;
    const cards: Card[] = [];
    let valid = true;
    for (let v = startVal; v <= topVal; v++) {
      const avail = byValue.get(v) ?? [];
      const have = Math.min(avail.length, 2);
      const need = 2 - have;
      if (wcUsed + need > wildcards.length) { valid = false; break; }
      cards.push(...avail.slice(0, have));
      for (let i = 0; i < need; i++) cards.push(wildcards[wcUsed++]);
    }
    if (!valid) continue;
    const h = classifyHand(cards, currentLevel);
    if (h && h.type === required.type && h.length === required.length && canBeat(h, required)) return cards.map(c => c.id);
  }
  return null;
}

/** Find the smallest consecutive triples (连三) of the required length that beats `required`. */
function findConsecutiveTriplesBeating(hand: Card[], required: HandResult, currentLevel: number): string[] | null {
  const tripleCount = required.length / 3;
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const normals = hand.filter(c => !isWildcard(c, currentLevel));

  const byValue = new Map<number, Card[]>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (v <= 2 || v >= 15) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(card);
  }

  for (let topVal = required.rank + 1; topVal <= 14; topVal++) {
    const startVal = topVal - tripleCount + 1;
    if (startVal < 3) continue;
    let wcUsed = 0;
    const cards: Card[] = [];
    let valid = true;
    for (let v = startVal; v <= topVal; v++) {
      const avail = byValue.get(v) ?? [];
      const have = Math.min(avail.length, 3);
      const need = 3 - have;
      if (wcUsed + need > wildcards.length) { valid = false; break; }
      cards.push(...avail.slice(0, have));
      for (let i = 0; i < need; i++) cards.push(wildcards[wcUsed++]);
    }
    if (!valid) continue;
    const h = classifyHand(cards, currentLevel);
    if (h && h.type === required.type && h.length === required.length && canBeat(h, required)) return cards.map(c => c.id);
  }
  return null;
}

function findSmallestBombBeating(normals: Card[], wildcards: Card[], required: HandResult | null, currentLevel: number): string[] | null {
  const seen = new Set<number>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (seen.has(v)) continue;
    seen.add(v);
    const sameVal = normals.filter(c => getGameValue(c, currentLevel) === v);
    for (let size = 4; size <= Math.min(8, sameVal.length + wildcards.length); size++) {
      const wcNeeded = Math.max(0, size - sameVal.length);
      // Two wildcards must go to separate combos — never use >1 wildcard in one bomb
      if (wcNeeded <= wildcards.length && (wildcards.length < 2 || wcNeeded <= 1)) {
        const bombCards = [...sameVal.slice(0, size - wcNeeded), ...wildcards.slice(0, wcNeeded)];
        const h = classifyHand(bombCards, currentLevel);
        if (h && isBombType(h.type) && (!required || canBeat(h, required))) return bombCards.map(c => c.id);
      }
    }
  }
  return null;
}

// ── Wildcard Strategy ──────────────────────────────────────────────────────
// Wildcards (red heart level cards) are extremely valuable. Reserve them for
// completing bombs before using them for pairs/triples.
// Add more wildcard heuristics here in the future (e.g. wildcard + joker combos).

/**
 * Returns wildcards NOT reserved for bomb completion.
 * Greedy: prioritise groups needing fewest wildcards (highest natural count first).
 */
function getFreeWildcards(wildcards: Card[], normals: Card[], currentLevel: number): Card[] {
  if (wildcards.length === 0) return [];

  const groups = new Map<number, number>();
  for (const c of normals) {
    if (c.suit === Suit.JOKER) continue;
    const v = getGameValue(c, currentLevel);
    groups.set(v, (groups.get(v) ?? 0) + 1);
  }

  // Two wildcards must go to separate combos — when ≥2 wildcards, only reserve for
  // groups that need exactly 1 wildcard (cnt=3). Never put 2 wildcards in one bomb.
  const minCntForReserve = wildcards.length >= 2 ? 3 : 2;
  const candidates = [...groups.entries()]
    .filter(([, cnt]) => cnt >= minCntForReserve && cnt < 4)
    .sort((a, b) => b[1] - a[1]);

  let reserved = 0;
  for (const [, cnt] of candidates) {
    const need = 4 - cnt;
    if (reserved + need <= wildcards.length) reserved += need;
    if (reserved === wildcards.length) break;
  }

  return wildcards.slice(reserved);
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * Sort cards with orphans (no pair partner in the same set) first, then by value.
 * Used when choosing a single to play — avoids breaking up pairs.
 */
function sortByOrphanFirst(cards: Card[], currentLevel: number): Card[] {
  const counts = new Map<number, number>();
  for (const c of cards) {
    const v = getGameValue(c, currentLevel);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const normalValues = new Set(
    cards
      .filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER)
      .map(c => getGameValue(c, currentLevel))
  );
  return [...cards].sort((a, b) => {
    const va = getGameValue(a, currentLevel);
    const vb = getGameValue(b, currentLevel);
    const isOrphanA = (counts.get(va) ?? 1) === 1;
    const isOrphanB = (counts.get(vb) ?? 1) === 1;
    // Priority 0: orphan and NOT part of a natural straight (safest to discard)
    // Priority 1: orphan but part of a natural straight (avoid breaking it)
    // Priority 2: non-orphan (pair/triple — don't break)
    const pA = !isOrphanA ? 2 : isPartOfNaturalStraight(va, normalValues, counts) ? 1 : 0;
    const pB = !isOrphanB ? 2 : isPartOfNaturalStraight(vb, normalValues, counts) ? 1 : 0;
    if (pA !== pB) return pA - pB;
    return va - vb;
  });
}

function buildJokerBomb(sorted: Card[]): string[] | null {
  const smallJ = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 14);
  const bigJ = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 15);
  if (smallJ.length === 2 && bigJ.length === 2) return [...smallJ, ...bigJ].map(c => c.id);
  return null;
}

/** Find smallest natural straight (no wildcards, game values 3–10, length ≥ 5). */
function findNaturalLowStraight(pureNormals: Card[], currentLevel: number): Card[] | null {
  const byVal = new Map<number, Card>();
  for (const c of pureNormals) {
    const v = getGameValue(c, currentLevel);
    if (v >= 3 && v <= 10 && !byVal.has(v)) byVal.set(v, c);
  }
  for (let start = 3; start <= 6; start++) {
    const range = [start, start+1, start+2, start+3, start+4];
    if (range.every(v => byVal.has(v))) return range.map(v => byVal.get(v)!);
  }
  return null;
}

/** Find smallest natural consecutive pairs (exactly 3 consecutive pairs = 6 cards, no wildcards). */
function findNaturalLowConsecPairs(pureNormals: Card[], currentLevel: number): Card[] | null {
  const byVal = new Map<number, Card[]>();
  for (const c of pureNormals) {
    const v = getGameValue(c, currentLevel);
    if (v < 3 || v > 10) continue;
    if (!byVal.has(v)) byVal.set(v, []);
    if (byVal.get(v)!.length < 2) byVal.get(v)!.push(c);
  }
  const pairVals = [...byVal.keys()].filter(v => byVal.get(v)!.length >= 2).sort((a, b) => a - b);
  for (let i = 0; i + 2 < pairVals.length; i++) {
    if (pairVals[i + 1] === pairVals[i] + 1 && pairVals[i + 2] === pairVals[i] + 2) {
      return [
        ...byVal.get(pairVals[i])!,
        ...byVal.get(pairVals[i + 1])!,
        ...byVal.get(pairVals[i + 2])!,
      ];
    }
  }
  return null;
}

/** Find smallest natural triple+pair (triple game value < J, pair from any non-wildcard card). */
function findNaturalLowTriplePair(pureNormals: Card[], currentLevel: number): Card[] | null {
  const byVal = new Map<number, Card[]>();
  for (const c of pureNormals) {
    const v = getGameValue(c, currentLevel);
    if (!byVal.has(v)) byVal.set(v, []);
    byVal.get(v)!.push(c);
  }
  const tripleEntries = [...byVal.entries()]
    .filter(([v, cards]) => v < 11 && cards.length >= 3)
    .sort((a, b) => a[0] - b[0]);
  for (const [, tripleCards] of tripleEntries) {
    const triple = tripleCards.slice(0, 3);
    const tripleIds = new Set(triple.map(c => c.id));
    const pairByVal = new Map<number, Card[]>();
    for (const c of pureNormals) {
      if (tripleIds.has(c.id)) continue;
      const v = getGameValue(c, currentLevel);
      if (!pairByVal.has(v)) pairByVal.set(v, []);
      pairByVal.get(v)!.push(c);
    }
    // Prefer pairs with count=2 (doesn't break a triple); fall back to count=3+ if needed
    const pairEntry = [...pairByVal.entries()]
      .filter(([, cards]) => cards.length >= 2)
      .sort((a, b) => {
        const aBreaks = a[1].length >= 3 ? 1 : 0;
        const bBreaks = b[1].length >= 3 ? 1 : 0;
        if (aBreaks !== bBreaks) return aBreaks - bBreaks;
        return a[0] - b[0];
      })[0];
    if (pairEntry) return [...triple, ...pairEntry[1].slice(0, 2)];
  }
  return null;
}

/** Returns true if value v is part of a 5-card *clean* natural straight in the given value set.
 *  "Clean" means every value in the straight window appears exactly once (valueCounts[v] === 1).
 *  If valueCounts is omitted, no cleanness check is applied.
 *  Values use getGameValue: 2=2, 3-K=3-13, A=14. A2345 is the smallest straight (A wraps). */
function isPartOfNaturalStraight(v: number, valueSet: Set<number>, valueCounts?: Map<number, number>): boolean {
  if (v >= 15) return false; // level card / joker
  // Protect the straight only if ≥3 of the 5 values are singletons (count=1).
  // If ≤2 singletons, the straight is "loose" (many duplicates) and not worth protecting.
  const isClean = (window: number[]) =>
    !valueCounts || window.filter(sv => (valueCounts.get(sv) ?? 0) === 1).length >= 3;
  // A-2-3-4-5 wrap straight: A=14, 2=2, 3=3, 4=4, 5=5
  const a2345 = [14, 2, 3, 4, 5];
  if (a2345.includes(v) && a2345.every(sv => valueSet.has(sv)) && isClean(a2345)) return true;
  // Regular windows: 2-3-4-5-6 up to 10-J-Q-K-A (rank 14)
  for (let start = Math.max(2, v - 4); start <= v && start + 4 <= 14; start++) {
    const window = [start, start+1, start+2, start+3, start+4];
    if (window.every(sv => valueSet.has(sv)) && isClean(window)) return true;
  }
  return false;
}

/**
 * Returns true if `rank` is part of a valid 连对 sequence (exactly 3 consecutive pair-ranks).
 * Handles wrap-around: A(14) is adjacent to 2, so AA2233 (ranks {2,3,14}) is valid.
 */
function isPartOfNaturalConsecPairs(rank: number, pairRankSet: Set<number>): boolean {
  if (!pairRankSet.has(rank)) return false;
  // Normal consecutive run
  let start = rank;
  while (pairRankSet.has(start - 1)) start--;
  let end = rank;
  while (pairRankSet.has(end + 1)) end++;
  if ((end - start + 1) >= 3) return true;
  // Wrap-around: A(14) adjacent to 2 — e.g. AA2233 = ranks {2,3,14}
  if (pairRankSet.has(14) && pairRankSet.has(2)) {
    // Treat A as rank 1, build the wrapped sequence around rank 1-2-3
    const wrapSet = new Set([...pairRankSet].map(r => r === 14 ? 1 : r));
    const wrapRank = rank === 14 ? 1 : rank;
    let ws = wrapRank;
    while (wrapSet.has(ws - 1)) ws--;
    let we = wrapRank;
    while (wrapSet.has(we + 1)) we++;
    if ((we - ws + 1) >= 3) return true;
  }
  return false;
}

function isTeammatesBigPlay(lastPlay: LastPlay, teammateId: string | undefined, _currentLevel: number): boolean {
  if (!teammateId || lastPlay.playerId !== teammateId) return false;
  if (isBombType(lastPlay.hand.type)) return true;
  // hand.rank uses game values: J=11, Q=12, K=13, A=14, level card=16, jokers=17/18
  // For TRIPLE_PAIR, hand.rank is the rank of the triple part
  return lastPlay.hand.rank >= 11;
}

/**
 * Choose the best play when leading a new round.
 * Priority:
 *   1. Can finish in one play → play everything
 *   2. Only bombs left → smallest bomb
 *
 *   [Opponent ≤2 cards — special path]
 *   3a. Two-turn finish with safe-size combo (opp=1: pair+; opp=2: triple+)
 *   3b. Natural combo (≥5 cards, always safe) — prefer two-turn finish, else smallest
 *   3c. opp=1 only: smallest low pair
 *   3d. Biggest non-wildcard single (hardest to beat)
 *
 *   [Normal path — opponent >2 cards]
 *   3. Two-turn finish: low combo (pair/triple/single) leaving rest as one valid play
 *   4. Natural low combo (straight/连对/三带二) — clear 5+ cards at once
 *   5. Smallest low junk single (true orphan: no pair partner, not in clean straight/连对)
 *   6. Smallest low pair (non-wildcard, < J)
 *   7. Smallest low single (non-wildcard, < J)
 *   8. Orphan-first among big cards (avoid breaking pairs/straights)
 *   9. Last resort: wildcard / joker
 */
function chooseLead(hand: Card[], currentLevel: number, minOpponentCount = 27): string[] {
  const sorted = [...hand].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel));
  const wildcards = sorted.filter(c => isWildcard(c, currentLevel));
  const pureNormals = sorted.filter(c => !isWildcard(c, currentLevel) && c.suit !== Suit.JOKER);

  // 1. Can finish in one play
  if (classifyHand(hand, currentLevel)) return hand.map(c => c.id);

  // 2. Only bombs left
  if (onlyBombsLeft(hand, currentLevel)) {
    const normals = sorted.filter(c => !isWildcard(c, currentLevel));
    const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
    if (bomb) return bomb;
    const jb = buildJokerBomb(sorted);
    if (jb) return jb;
  }

  // Pre-compute low card helpers (used by both paths below)
  const lowPureNormals = pureNormals.filter(c => getGameValue(c, currentLevel) < 11);
  const lowPairs = getPairsSmallestFirst([], lowPureNormals, currentLevel);
  const lowTriples = getTriplesSmallestFirst([], lowPureNormals, currentLevel);

  const naturalCombos: Card[][] = [
    findNaturalLowStraight(pureNormals, currentLevel),
    findNaturalLowConsecPairs(pureNormals, currentLevel),
    findNaturalLowTriplePair(pureNormals, currentLevel),
  ].filter((c): c is Card[] => c !== null);

  // ── Opponent nearly out: special path ──────────────────────────────────────
  // opponent=1: can't follow ≥2-card combos — safe to play pair/triple/straight
  //             single is risky (they can beat it and go out)
  // opponent=2: can't follow ≥3-card combos — safe to play triple/straight
  //             pair is risky (they may have a pair)
  if (minOpponentCount <= 2) {
    const safeMinSize = minOpponentCount === 1 ? 2 : 3;

    // Two-turn finish with a safe-size combo
    for (const combo of [...lowPairs, ...lowTriples].filter(c => c.length >= safeMinSize)) {
      const remaining = hand.filter(c => !combo.some(p => p.id === c.id));
      if (remaining.length > 0 && classifyHand(remaining, currentLevel)) return combo.map(c => c.id);
    }

    // Natural combos (≥5 cards — always safe, prefer two-turn finish)
    for (const combo of naturalCombos) {
      const remaining = hand.filter(c => !combo.some(p => p.id === c.id));
      if (remaining.length > 0 && classifyHand(remaining, currentLevel)) return combo.map(c => c.id);
    }
    if (naturalCombos.length > 0) {
      naturalCombos.sort((a, b) =>
        Math.max(...a.map(c => getGameValue(c, currentLevel))) -
        Math.max(...b.map(c => getGameValue(c, currentLevel)))
      );
      return naturalCombos[0].map(c => c.id);
    }

    // opponent=1: pair is safe
    if (minOpponentCount === 1 && lowPairs.length > 0) return lowPairs[0].map(c => c.id);

    // Play biggest non-wildcard card (hardest to beat)
    const bigFirst = [...pureNormals].sort((a, b) => getGameValue(b, currentLevel) - getGameValue(a, currentLevel));
    if (bigFirst.length > 0) return [bigFirst[0].id];
    return [sorted[sorted.length - 1].id];
  }

  // ── Normal path ────────────────────────────────────────────────────────────

  // 3. Two-turn finish
  for (const combo of lowPairs) {
    const remaining = hand.filter(c => !combo.some(p => p.id === c.id));
    if (remaining.length > 0 && classifyHand(remaining, currentLevel)) return combo.map(c => c.id);
  }
  for (const combo of lowTriples) {
    const remaining = hand.filter(c => !combo.some(p => p.id === c.id));
    if (remaining.length > 0 && classifyHand(remaining, currentLevel)) return combo.map(c => c.id);
  }
  for (const card of lowPureNormals) {
    const remaining = hand.filter(c => c.id !== card.id);
    if (remaining.length > 0 && classifyHand(remaining, currentLevel)) return [card.id];
  }

  // 4. Natural low combos — prefer two-turn finish, otherwise smallest
  for (const combo of naturalCombos) {
    const remaining = hand.filter(c => !combo.some(p => p.id === c.id));
    if (remaining.length > 0 && classifyHand(remaining, currentLevel)) return combo.map(c => c.id);
  }
  if (naturalCombos.length > 0) {
    naturalCombos.sort((a, b) =>
      Math.max(...a.map(c => getGameValue(c, currentLevel))) -
      Math.max(...b.map(c => getGameValue(c, currentLevel)))
    );
    return naturalCombos[0].map(c => c.id);
  }

  // 5. Smallest low junk single (true orphan: no pair partner, not in a clean straight,
  //    not part of a valid 连对 sequence) — clear dead cards before spending pairs
  {
    const lowValCounts = new Map<number, number>();
    for (const c of lowPureNormals) {
      const v = getGameValue(c, currentLevel);
      lowValCounts.set(v, (lowValCounts.get(v) ?? 0) + 1);
    }
    const lowNormalValues = new Set(lowPureNormals.map(c => getGameValue(c, currentLevel)));
    const lowPairRanks = new Set<number>(
      [...lowValCounts.entries()].filter(([, cnt]) => cnt >= 2).map(([v]) => v)
    );
    for (const card of lowPureNormals) {
      const v = getGameValue(card, currentLevel);
      if ((lowValCounts.get(v) ?? 0) >= 2) continue;             // has pair partner
      if (isPartOfNaturalStraight(v, lowNormalValues, lowValCounts)) continue; // in clean straight
      if (isPartOfNaturalConsecPairs(v, lowPairRanks)) continue;  // in valid 连对
      return [card.id]; // true junk single
    }
  }

  // 6. Smallest low pair
  if (lowPairs.length > 0) return lowPairs[0].map(c => c.id);

  // 7. Smallest low single
  if (lowPureNormals.length > 0) return [lowPureNormals[0].id];

  // 8. Orphan-first among big cards
  const orphanSorted = sortByOrphanFirst(pureNormals, currentLevel);
  if (orphanSorted.length > 0) return [orphanSorted[0].id];

  // 9. Last resort: wildcard / joker
  return [sorted[0].id];
}

export function getBotMove(
  hand: Card[],
  lastPlay: LastPlay | null,
  currentLevel: number,
  teammateId?: string,
  teammateHandCount?: number,
  opponentHandCounts?: number[],
  lastPlayHandCount?: number   // hand count of whoever made lastPlay (undefined = unknown)
): { cardIds: string[]; intendedType?: HandType } | null {
  if (hand.length === 0) return null;
  const sorted = [...hand].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel));
  const wildcards = sorted.filter(c => isWildcard(c, currentLevel));
  const normals = sorted.filter(c => !isWildcard(c, currentLevel));

  const minOpponentCount = opponentHandCounts && opponentHandCounts.length > 0
    ? Math.min(...opponentHandCounts) : 27;
  const opponentAboutToFinish = minOpponentCount <= 6;
  const teammateNearlyDone = (teammateHandCount ?? 27) <= 6;

  // Teammate is about to finish (≤6 cards): pass and let them close out,
  // unless an opponent is also about to finish (emergency — must stay aggressive).
  if (lastPlay && teammateNearlyDone && !opponentAboutToFinish) return null;

  // Teammate played a big hand: always pass — teammate already has control, no need to bomb over them
  if (lastPlay && isTeammatesBigPlay(lastPlay, teammateId, currentLevel)) return null;

  // Leading a new round
  if (!lastPlay) {
    return { cardIds: chooseLead(hand, currentLevel, minOpponentCount) };
  }

  const required = lastPlay.hand;

  // Opponent about to finish and their play is currently winning: bomb to seize control
  if (opponentAboutToFinish && lastPlay.playerId !== teammateId && !isBombType(required.type)) {
    const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
    if (bomb) return { cardIds: bomb };
    const jb = buildJokerBomb(sorted);
    if (jb) return { cardIds: jb };
  }

  const freeWildcards = getFreeWildcards(wildcards, normals, currentLevel);

  // Try to beat with same type
  if (required.type === HandType.SINGLE) {
    // Count occurrences of each game value to detect pair partners
    const valCounts = new Map<number, number>();
    for (const c of sorted) {
      const v = getGameValue(c, currentLevel);
      valCounts.set(v, (valCounts.get(v) ?? 0) + 1);
    }
    // Value set for straight detection (non-joker, non-wildcard cards)
    const normalValues = new Set(
      sorted.filter(c => c.suit !== Suit.JOKER && !isWildcard(c, currentLevel))
            .map(c => getGameValue(c, currentLevel))
    );
    // Only play true orphan singles: no pair partner AND not part of a natural straight/straight flush.
    // ISMCTS will evaluate whether breaking a combo is worthwhile via findSmallestBeat.
    for (const card of sortByOrphanFirst(sorted, currentLevel)) {
      const v = getGameValue(card, currentLevel);
      if ((valCounts.get(v) ?? 0) >= 2) break; // has pair partner — stop
      if (isPartOfNaturalStraight(v, normalValues, valCounts)) break; // part of a clean straight — stop
      const h = classifyHand([card], currentLevel);
      if (h && canBeat(h, required)) return { cardIds: [card.id] };
    }
  } else if (required.type === HandType.PAIR) {
    // Build set of ranks that have ≥2 natural cards (for 连对 detection)
    const pureNormals = normals.filter(c => c.suit !== Suit.JOKER);
    const rankCounts = new Map<number, number>();
    for (const c of pureNormals) {
      const v = getGameValue(c, currentLevel);
      rankCounts.set(v, (rankCounts.get(v) ?? 0) + 1);
    }
    const naturalPairRanks = new Set<number>(
      [...rankCounts.entries()].filter(([, cnt]) => cnt >= 2).map(([v]) => v)
    );
    // Try orphan pairs first (rank not part of a valid 连对 of ≥3 consecutive pair-ranks).
    // ISMCTS will evaluate breaking a 连对 if no orphan pair is available.
    const allPairs = getPairsSmallestFirst([], pureNormals, currentLevel);
    for (const pair of allPairs) {
      const rank = getGameValue(pair[0], currentLevel);
      if (isPartOfNaturalConsecPairs(rank, naturalPairRanks)) continue;
      const h = classifyHand(pair, currentLevel);
      if (h && canBeat(h, required)) return { cardIds: pair.map(c => c.id) };
    }
  } else if (required.type === HandType.TRIPLE) {
    for (const triple of getTriplesSmallestFirst(freeWildcards, normals, currentLevel)) {
      const h = classifyHand(triple, currentLevel);
      if (h && canBeat(h, required)) return { cardIds: triple.map(c => c.id) };
    }
  } else if (isBombType(required.type)) {
    const bigger = findSmallestBombBeating(normals, wildcards, required, currentLevel);
    if (bigger) return { cardIds: bigger };
    const jb = buildJokerBomb(sorted);
    if (jb) {
      const h = classifyHand(jb.map(id => hand.find(c => c.id === id)!), currentLevel);
      if (h && canBeat(h, required)) return { cardIds: jb };
    }
    return null;
  }

  if (required.type === HandType.STRAIGHT || required.type === HandType.STRAIGHT_FLUSH) {
    const beat = findStraightBeating(hand, required, currentLevel);
    if (beat) return { cardIds: beat };
  } else if (required.type === HandType.TRIPLE_PAIR) {
    const beat = findTriplePairBeating(hand, required, currentLevel);
    if (beat) return { cardIds: beat };
  } else if (required.type === HandType.CONSECUTIVE_PAIRS) {
    const beat = findConsecutivePairsBeating(hand, required, currentLevel);
    if (beat) return { cardIds: beat };
  } else if (required.type === HandType.CONSECUTIVE_TRIPLES) {
    const beat = findConsecutiveTriplesBeating(hand, required, currentLevel);
    if (beat) return { cardIds: beat };
  }

  // Short-hand rules: adjust bomb strategy based on remaining card count (opponent's play only)
  const opponentPlayed = lastPlay.playerId !== teammateId;
  const lastPlayerCount = lastPlayHandCount ?? 27; // 刚出牌那个人的剩余牌数
  if (opponentPlayed && !isBombType(required.type)) {
    if (lastPlayerCount === 4) {
      // 对手剩4张：接不上就过，不出炸弹（避免激化炸弹对抗）
      return null;
    }
    if (lastPlayerCount <= 6) {
      // 对手剩≤6张（不含4张）：接不上就出最小炸弹
      const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
      if (bomb) return { cardIds: bomb };
      const jb = buildJokerBomb(sorted);
      if (jb) return { cardIds: jb };
    }
  }

  // Counter opponent's big joker (大王) with smallest bomb
  if (!isBombType(required.type) && lastPlay.cards.some(c => c.suit === Suit.JOKER && c.rank === 15)) {
    const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
    if (bomb) return { cardIds: bomb };
  }

  // Only bomb to override a non-bomb play when no non-bomb cards remain
  if (!isBombType(required.type) && onlyBombsLeft(hand, currentLevel)) {
    const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
    if (bomb) return { cardIds: bomb };
    const jb = buildJokerBomb(sorted);
    if (jb) return { cardIds: jb };
  }

  return null; // pass
}
