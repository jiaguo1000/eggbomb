import { Server } from 'socket.io';
import { Player, Room, Card, PlayerSeat } from '@eggbomb/shared';
import { v4 as uuidv4 } from 'uuid';

// --------------- Bot Manager (Placeholder) ---------------
// Future: implement AI logic for bot players in 掼蛋.

export interface BotState {
  bot: Player;
  hand: Card[];
}

/** In-memory store of bot states keyed by bot player id */
const botStates = new Map<string, BotState>();

/**
 * Creates a bot player and adds it to the given room.
 * Returns the created Player object.
 */
export function addBot(room: Room, seat: PlayerSeat): Player {
  const botNames = ['机器人小李', '机器人小张', '机器人小王', '机器人小赵'];
  const existingBots = room.players.filter((p) => p.isBot).length;

  const bot: Player = {
    id: uuidv4(),
    name: botNames[existingBots % botNames.length],
    seat,
    teamId: seat % 2 === 0 ? 0 : 1,
    isReady: true,
    isBot: true,
  };

  botStates.set(bot.id, { bot, hand: [] });
  return bot;
}

/**
 * Assigns a hand to a bot player.
 */
export function setBotHand(botId: string, hand: Card[]): void {
  const state = botStates.get(botId);
  if (state) {
    state.hand = hand;
  }
}

/**
 * Placeholder: determine which cards the bot will play.
 * Currently just passes every turn.
 */
export function getBotMove(
  _io: Server,
  _room: Room,
  botId: string,
  _currentPlay: Card[]
): Card[] | null {
  const state = botStates.get(botId);
  if (!state || state.hand.length === 0) return null;

  // TODO: implement game logic (hand evaluation, strategy, etc.)
  // For now, bot always passes
  return null;
}

/**
 * Clean up bot state when a game ends.
 */
export function clearBots(room: Room): void {
  room.players
    .filter((p) => p.isBot)
    .forEach((p) => botStates.delete(p.id));
}
