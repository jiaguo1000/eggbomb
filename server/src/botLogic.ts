import { Card, Suit, HandType, HandResult, LastPlay } from '@eggbomb/shared';
import { classifyHand, canBeat, getGameValue, isWildcard } from '@eggbomb/shared';

function isBombType(type: HandType): boolean {
  return [HandType.BOMB_QUAD, HandType.BOMB_5, HandType.BOMB_6, HandType.BOMB_7, HandType.BOMB_8, HandType.JOKER_BOMB].includes(type);
}

function getPairsSmallestFirst(sorted: Card[], wildcards: Card[], normals: Card[], currentLevel: number): Card[][] {
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
  if (wildcards.length >= 2) pairs.push(wildcards.slice(0, 2));
  return pairs;
}

function getTriplesSmallestFirst(sorted: Card[], wildcards: Card[], normals: Card[], currentLevel: number): Card[][] {
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
    else if (sameVal.length === 1 && wildcards.length >= 2) triple = [sameVal[0], ...wildcards.slice(0, 2)];
    if (triple) triples.push(triple);
  }
  if (wildcards.length >= 3) triples.push(wildcards.slice(0, 3));
  return triples;
}

/** Returns true if every card in hand is part of a bomb group (no loose singles/pairs/etc) */
function onlyBombsLeft(hand: Card[], currentLevel: number): boolean {
  if (hand.length === 0) return false;
  const wildcards = hand.filter(c => isWildcard(c, currentLevel));
  const nonWild = hand.filter(c => !isWildcard(c, currentLevel));
  const jokers = nonWild.filter(c => c.suit === Suit.JOKER);
  const regular = nonWild.filter(c => c.suit !== Suit.JOKER);

  // Each regular value group must have 4+ cards (wildcards can fill in)
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

  // Jokers must form complete joker bombs (2 small + 2 big each)
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
    if (v <= 2 || v >= 15) continue; // straights: no 2s, no jokers
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

    // Try each value as the pair
    for (const pv of sortedVals) {
      if (pv === tv) continue;
      const pc = byValue.get(pv)!;
      const wcForP = Math.max(0, 2 - pc.length);
      if (wcForP > wcLeft.length) continue;
      const pairGroup = [...pc.slice(0, Math.min(pc.length, 2)), ...wcLeft.slice(0, wcForP)];
      const combo = [...tripleGroup, ...pairGroup];
      const h = classifyHand(combo, currentLevel);
      if (h && h.type === HandType.TRIPLE_PAIR && canBeat(h, required)) return combo.map(c => c.id);
    }
    // Use two wildcards as pair
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

function findSmallestBombBeating(normals: Card[], wildcards: Card[], required: import('@eggbomb/shared').HandResult | null, currentLevel: number): string[] | null {
  const seen = new Set<number>();
  for (const card of normals) {
    const v = getGameValue(card, currentLevel);
    if (seen.has(v)) continue;
    seen.add(v);
    const sameVal = normals.filter(c => getGameValue(c, currentLevel) === v);
    for (let size = 4; size <= Math.min(8, sameVal.length + wildcards.length); size++) {
      const wcNeeded = Math.max(0, size - sameVal.length);
      if (wcNeeded <= wildcards.length) {
        const bombCards = [...sameVal.slice(0, size - wcNeeded), ...wildcards.slice(0, wcNeeded)];
        const h = classifyHand(bombCards, currentLevel);
        if (h && isBombType(h.type) && (!required || canBeat(h, required))) return bombCards.map(c => c.id);
      }
    }
  }
  return null;
}

function isTeammatesBigPlay(lastPlay: LastPlay, teammateId: string | undefined, currentLevel: number): boolean {
  if (!teammateId || lastPlay.playerId !== teammateId) return false;
  const cards = lastPlay.cards;
  // Any bomb
  if (isBombType(lastPlay.hand.type)) return true;
  // Contains a joker (大王 or 小王)
  if (cards.some(c => c.suit === Suit.JOKER)) return true;
  // Contains a level card (level 14 = A maps to card rank 1)
  const levelRank = currentLevel === 14 ? 1 : currentLevel;
  if (cards.some(c => c.rank === levelRank && c.suit !== Suit.JOKER)) return true;
  return false;
}

export function getBotMove(
  hand: Card[],
  lastPlay: LastPlay | null,
  currentLevel: number,
  teammateId?: string
): { cardIds: string[]; intendedType?: HandType } | null {
  if (hand.length === 0) return null;
  const sorted = [...hand].sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel));
  const wildcards = sorted.filter(c => isWildcard(c, currentLevel));
  const normals = sorted.filter(c => !isWildcard(c, currentLevel));

  // If teammate played a big hand, just pass
  if (lastPlay && isTeammatesBigPlay(lastPlay, teammateId, currentLevel)) return null;

  if (!lastPlay) {
    // New round: play smallest single card.
    // Only play a bomb if every card in hand is part of a bomb group.
    if (onlyBombsLeft(hand, currentLevel)) {
      const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
      if (bomb) return { cardIds: bomb };
      const smallJ = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 14);
      const bigJ = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 15);
      if (smallJ.length >= 2 && bigJ.length >= 2) return { cardIds: [...smallJ.slice(0, 2), ...bigJ.slice(0, 2)].map(c => c.id) };
    }
    const smallest = normals.length > 0 ? normals[0] : wildcards[0];
    return { cardIds: [smallest.id] };
  }

  const required = lastPlay.hand;

  // Try same type
  if (required.type === HandType.SINGLE) {
    for (const card of sorted) {
      const h = classifyHand([card], currentLevel);
      if (h && canBeat(h, required)) return { cardIds: [card.id] };
    }
  } else if (required.type === HandType.PAIR) {
    for (const pair of getPairsSmallestFirst(sorted, wildcards, normals, currentLevel)) {
      const h = classifyHand(pair, currentLevel);
      if (h && canBeat(h, required)) return { cardIds: pair.map(c => c.id) };
    }
  } else if (required.type === HandType.TRIPLE) {
    for (const triple of getTriplesSmallestFirst(sorted, wildcards, normals, currentLevel)) {
      const h = classifyHand(triple, currentLevel);
      if (h && canBeat(h, required)) return { cardIds: triple.map(c => c.id) };
    }
  } else if (isBombType(required.type)) {
    // Try to beat bomb with bigger bomb
    const bigger = findSmallestBombBeating(normals, wildcards, required, currentLevel);
    if (bigger) return { cardIds: bigger };
    // Try joker bomb
    const small = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 14);
    const big = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 15);
    if (small.length >= 2 && big.length >= 2) {
      const jokerBomb = [...small.slice(0, 2), ...big.slice(0, 2)];
      const h = classifyHand(jokerBomb, currentLevel);
      if (h && canBeat(h, required)) return { cardIds: jokerBomb.map(c => c.id) };
    }
    return null;
  }
  // Handle complex types: straight, triple-pair, consecutive pairs/triples
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

  // Counter opponent's big joker (大王) play with smallest bomb
  if (!isBombType(required.type) && lastPlay.cards.some(c => c.suit === Suit.JOKER && c.rank === 15)) {
    const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
    if (bomb) return { cardIds: bomb };
  }

  // Only play a bomb to override a non-bomb play when no non-bomb cards remain
  if (!isBombType(required.type) && onlyBombsLeft(hand, currentLevel)) {
    const bomb = findSmallestBombBeating(normals, wildcards, null, currentLevel);
    if (bomb) return { cardIds: bomb };
    const small = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 14);
    const big = sorted.filter(c => c.suit === Suit.JOKER && c.rank === 15);
    if (small.length >= 2 && big.length >= 2) return { cardIds: [...small.slice(0, 2), ...big.slice(0, 2)].map(c => c.id) };
  }

  return null; // pass
}
