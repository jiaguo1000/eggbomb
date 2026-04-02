import { Card, Suit } from '@eggbomb/shared';

// --------------- Deck creation ---------------

/**
 * Creates a full 掼蛋 deck: 2 standard decks = 108 cards.
 * Each deck has 52 standard cards + 2 jokers = 54 cards.
 */
export function createDeck(): Card[] {
  const suits: Suit[] = [Suit.SPADE, Suit.HEART, Suit.CLUB, Suit.DIAMOND];
  const cards: Card[] = [];

  for (let deckIndex = 0; deckIndex < 2; deckIndex++) {
    // Standard suits: rank 1 (Ace) through 13 (King)
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank++) {
        const id = `${suit}_${rank}_${deckIndex}`;
        cards.push({ suit, rank, id });
      }
    }
    // Jokers: small joker (rank 14), big joker (rank 15)
    cards.push({ suit: Suit.JOKER, rank: 14, id: `JOKER_SMALL_${deckIndex}` });
    cards.push({ suit: Suit.JOKER, rank: 15, id: `JOKER_BIG_${deckIndex}` });
  }

  return cards; // 108 cards total
}

/**
 * Shuffles a deck in-place using Fisher-Yates algorithm.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deals cards to 4 players.
 * 108 cards / 4 players = 27 cards each.
 * Returns an array of 4 hands, each containing 27 cards.
 */
export function dealCards(): [Card[], Card[], Card[], Card[]] {
  const deck = shuffleDeck(createDeck());

  const hands: [Card[], Card[], Card[], Card[]] = [[], [], [], []];
  deck.forEach((card, index) => {
    hands[index % 4].push(card);
  });

  return hands;
}

/**
 * Returns the display label for a card rank.
 */
export function getRankLabel(rank: number): string {
  const labels: Record<number, string> = {
    1: 'A',
    11: 'J',
    12: 'Q',
    13: 'K',
    14: '小王',
    15: '大王',
  };
  return labels[rank] ?? String(rank);
}

/**
 * Returns the display symbol for a suit.
 */
export function getSuitSymbol(suit: Suit): string {
  const symbols: Record<Suit, string> = {
    [Suit.SPADE]: '♠',
    [Suit.HEART]: '♥',
    [Suit.CLUB]: '♣',
    [Suit.DIAMOND]: '♦',
    [Suit.JOKER]: '🃏',
  };
  return symbols[suit] ?? suit;
}
