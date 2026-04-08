// ============================================================
// 掼蛋 (Guan Dan) - Shared Types
// ============================================================

// --------------- Card Types ---------------

export enum Suit {
  SPADE = 'SPADE',
  HEART = 'HEART',
  CLUB = 'CLUB',
  DIAMOND = 'DIAMOND',
  JOKER = 'JOKER',
}

export interface Card {
  /** Suit of the card */
  suit: Suit;
  /**
   * Numeric rank 1-13 (Ace=1, Jack=11, Queen=12, King=13).
   * For jokers: 14 = small joker, 15 = big joker.
   */
  rank: number;
  /** Unique card id, e.g. "SPADE_1_0" for first deck ace of spades */
  id: string;
}

// --------------- Player / Seat Types ---------------

/** Seat positions around the table: 0 (South), 1 (West), 2 (North), 3 (East) */
export type PlayerSeat = 0 | 1 | 2 | 3;

/** Teams: 0 = seats 0 & 2 (South & North), 1 = seats 1 & 3 (West & East) */
export type Team = 0 | 1;

export interface Player {
  id: string;
  name: string;
  seat: PlayerSeat | null;
  teamId: Team | null;
  isReady: boolean;
  isBot: boolean;
  botDifficulty?: 'easy' | 'medium';
}

// --------------- Room / Game Types ---------------

export enum GamePhase {
  WAITING = 'WAITING',
  DEALING = 'DEALING',
  DICE_ROLLING = 'DICE_ROLLING',
  PLAYING = 'PLAYING',
  ROUND_END = 'ROUND_END',
  GAME_END = 'GAME_END',
  TRIBUTE_RETURN = 'TRIBUTE_RETURN', // receivers select return cards
}

export interface TributeEntry {
  fromPlayerId: string;   // tributer (giver)
  toPlayerId: string;     // receiver
  tributeCard: Card | null; // the tribute card (chosen by giver)
  tributeGiven: boolean;  // giver has chosen and sent their tribute card
  returnCard: Card | null; // the return card (selected by receiver)
  done: boolean;          // return card has been selected
}

export interface TributeState {
  entries: TributeEntry[];
  skipTribute: boolean;       // 3rd+4th hold 2 big jokers → skip tribute
  firstPlayerId: string;      // who starts next game
  isEqualTribute: boolean;    // 大跑 equal value tribute → triggers 抢贡
  grabPhase: boolean;         // receivers selected return cards, tributers now grab
  pendingReturns: { receiverId: string; card: Card }[]; // return cards waiting to be grabbed
  grabLog: string[];          // tributer IDs who grabbed in order (last starts)
  bigJokerHolders?: { playerId: string; name: string; count: number }[]; // who triggered 抗贡
}

export interface GameResult {
  winningTeam: Team;
  levelAdvance: number;    // 1, 2, or 3
  newLevels: [number, number]; // levels after advancement
  finishPositions: { playerId: string; position: number; name: string }[];
  matchWon: boolean;       // ace team won with 大跑 or 升2
  aceTeam: Team | null;    // which team was playing A this game (null = normal game)
  aceTeamFailed: boolean;  // ace team failed this round (升1 or other team won)
  aceFailures: [number, number]; // failure counts per team after this game
}

export interface Room {
  /** Unique room identifier */
  id: string;
  /** Human-readable 6-character room code */
  code: string;
  /** Player ID of the room creator (host) */
  hostId: string;
  players: Player[];
  phase: GamePhase;
  /** Current level (2-Ace) for each team, indexed by Team (0 or 1) */
  currentLevel: [number, number];
  /** The level currently being played (winning team's level) */
  currentGameLevel: number;
  /** Seat index of the player whose turn it is */
  currentTurn: PlayerSeat | null;
  lastPlay: LastPlay | null;
  consecutivePasses: number;
  finishOrder: string[];  // playerIds who ran out of cards, in order
  handCount: Record<string, number>; // playerId -> cards remaining
  // Each seat's latest play in the current round (cleared when round resets)
  currentRoundPlays: Partial<Record<PlayerSeat, { cards: Card[]; hand: HandResult }>>;
  // Order in which seats played this round (for display ordering)
  currentRoundPlayOrder: PlayerSeat[];
  gameResult: GameResult | null;
  tributeState: TributeState | null;
  diceRolls: Record<string, number>;
  /** Which team is playing A this game (null = normal game) */
  playingAceTeam: Team | null;
  /** How many times each team has failed while playing A (resets to 0 on 3rd failure) */
  aceFailures: [number, number];
  /** Starting level for both teams (set by host before first game, default 2) */
  startLevel: number;
  /** Player IDs currently in 托管 (autopilot) mode */
  managedPlayerIds: string[];
  /** Player IDs who are currently disconnected (still in room, awaiting rejoin) */
  disconnectedPlayerIds: string[];
  /** Player IDs who tied in the last dice roll and must re-roll (cleared after re-roll) */
  diceTiedIds: string[];
  /** True when we're in the second (re-roll) round after a tie */
  isRerollRound: boolean;
}

// --------------- Hand Types ---------------

export enum HandType {
  SINGLE = 'SINGLE',
  PAIR = 'PAIR',
  TRIPLE = 'TRIPLE',
  STRAIGHT = 'STRAIGHT',               // 5+ consecutive, no 2s
  CONSECUTIVE_PAIRS = 'CONSECUTIVE_PAIRS', // 3+ consecutive pairs e.g. 334455
  CONSECUTIVE_TRIPLES = 'CONSECUTIVE_TRIPLES', // 2+ consecutive triples e.g. 444555
  TRIPLE_PAIR = 'TRIPLE_PAIR',         // triple + pair (三带对)
  BOMB_QUAD = 'BOMB_QUAD',             // 4 of same rank
  BOMB_5 = 'BOMB_5',                   // 5 same rank (with wildcard)
  BOMB_6 = 'BOMB_6',                   // 6 same rank (with wildcard)
  BOMB_7 = 'BOMB_7',                   // 7 same rank (with wildcard)
  BOMB_8 = 'BOMB_8',                   // 8 same rank (with wildcard)
  STRAIGHT_FLUSH = 'STRAIGHT_FLUSH',   // 5+ consecutive same suit (同花顺)
  JOKER_BOMB = 'JOKER_BOMB',           // both small+big joker
}

export interface HandResult {
  type: HandType;
  rank: number;   // for comparison, higher = stronger
  length: number; // number of cards in hand
}

export interface LastPlay {
  playerId: string;
  seat: PlayerSeat;
  cards: Card[];
  hand: HandResult;
}

// --------------- Socket Event Names ---------------

export const SOCKET_EVENTS = {
  // Client -> Server
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  CHOOSE_SEAT: 'choose_seat',
  PLAYER_READY: 'player_ready',
  START_GAME: 'start_game',
  PLAY_CARDS: 'play_cards',
  PASS_TURN: 'pass_turn',
  ADD_BOT: 'add_bot',
  REMOVE_BOT: 'remove_bot',
  ROLL_DICE: 'roll_dice',
  LEAVE_ROOM: 'leave_room',
  TRIBUTE_CARD: 'tribute_card',
  TRIBUTE_RETURN_CARD: 'tribute_return_card',
  GRAB_TRIBUTE: 'grab_tribute',
  SET_START_LEVEL: 'set_start_level',
  RESET_ROOM: 'reset_room',
  TOGGLE_MANAGE: 'toggle_manage',
  REJOIN: 'rejoin',
  GET_HINT: 'get_hint',
  AUTO_PLAY: 'auto_play',

  // Server -> Client
  DICE_ROLL: 'dice_roll',
  ROOM_UPDATE: 'room_update',
  GAME_STARTED: 'game_started',
  DEAL_CARDS: 'deal_cards',
  TURN_CHANGE: 'turn_change',
  CARDS_PLAYED: 'cards_played',
  ROUND_ENDED: 'round_ended',
  GAME_ENDED: 'game_ended',
  PLAYER_FINISHED: 'player_finished',
  TRIBUTE_STATE: 'tribute_state',
  NEW_GAME_STARTING: 'new_game_starting',
  REJOIN_SUCCESS: 'rejoin_success',
  HINT: 'hint',
  TRIBUTE_REVEAL: 'tribute_reveal',
  ERROR: 'error',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// --------------- Socket Payload Types ---------------

export interface CreateRoomPayload {
  playerName: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  playerName: string;
}

export interface ChooseSeatPayload {
  seat: PlayerSeat;
}

export interface PlayCardsPayload {
  cardIds: string[];
  intendedType?: HandType; // player's chosen type when ambiguous
}

export interface RoomUpdatePayload {
  room: Room;
}

export interface DealCardsPayload {
  cards: Card[];
}

export interface ErrorPayload {
  message: string;
}

export interface CardsPlayedPayload {
  playerId: string;
  seat: PlayerSeat;
  cards: Card[];
  hand: HandResult;
  nextTurn: PlayerSeat;
}

export interface PassTurnPayload {
  playerId: string;
  seat: PlayerSeat;
  nextTurn: PlayerSeat;
}

export interface PlayerFinishedPayload {
  playerId: string;
  seat: PlayerSeat;
  finishPosition: number; // 1st, 2nd, 3rd, 4th to finish
}

export interface GameEndedPayload {
  finishOrder: string[]; // playerIds in finish order
  winningTeam: Team;
}

export interface TributeReturnPayload {
  cardId: string;
}

export interface DiceRollPayload {
  rolls: { playerId: string; seat: PlayerSeat; name: string; roll: number }[];
  winningSeat: PlayerSeat;
}
