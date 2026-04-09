import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  SOCKET_EVENTS,
  GamePhase,
  Player,
  PlayerSeat,
  Room,
  Card,
  Suit,
  Team,
  CreateRoomPayload,
  JoinRoomPayload,
  ChooseSeatPayload,
  GameResult,
  TributeState,
  TributeEntry,
  DiceRollPayload,
} from '@eggbomb/shared';
import {
  createRoom,
  createEmptyRoom,
  generateRoomCode,
  getRoomByCode,
  getAllRooms,
  updateRoom,
  deleteRoom,
  registerSocket,
  unregisterSocket,
  getPlayerIdBySocket,
  isRoomReady,
} from './gameManager';
import { MAX_ROOMS } from './index';
import { dealCards, createDeck } from './cardUtils';
import { classifyHand, classifyAllPossible, canBeat, HandResult, getGameValue, isWildcard } from '@eggbomb/shared';
import { getBotMove } from './botLogic';
import { ISMCTSContext } from './ismcts';
import { Worker } from 'worker_threads';
import path from 'path';
import { pickBotName } from './botNames';

// Run ISMCTS in a worker thread so it doesn't block the event loop.
function runISMCTS(ctx: ISMCTSContext, budgetMs: number): Promise<import('./ismcts').ISMCTSResult> {
  const fallback = (log: string): import('./ismcts').ISMCTSResult => ({ cardIds: null, log });
  return new Promise((resolve) => {
    // Support both ts-node (dev) and compiled JS (prod).
    const isTs = __filename.endsWith('.ts');
    const workerFile = isTs
      ? path.join(__dirname, 'ismcts.worker.ts')
      : path.join(__dirname, 'ismcts.worker.js');
    const execArgv = isTs
      ? ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register']
      : [];

    const ctxSerialized = { ...ctx, playedCardIds: [...ctx.playedCardIds] };
    const worker = new Worker(workerFile, {
      workerData: { ctx: ctxSerialized, budgetMs },
      execArgv,
    });
    worker.on('message', resolve);
    worker.on('error', (err) => {
      console.error('[ISMCTS worker error]', err);
      resolve(fallback(`[ISMCTS] seat=${ctx.mySeat} worker error`));
    });
    worker.on('exit', (code) => {
      if (code !== 0) resolve(fallback(`[ISMCTS] seat=${ctx.mySeat} worker exit ${code}`));
    });
  });
}

// --------------- Helpers ---------------

function getBotMoveContext(room: Room & { hands?: Record<string, import('@eggbomb/shared').Card[]> }, playerId: string) {
  const player = room.players.find(p => p.id === playerId);
  const teammate = room.players.find(p => p.teamId === player?.teamId && p.id !== playerId);
  const opponents = room.players.filter(p => p.teamId !== player?.teamId);
  const teammateHandCount = teammate ? (room.hands?.[teammate.id]?.length ?? 27) : 27;
  const opponentHandCounts = opponents.map(p => room.hands?.[p.id]?.length ?? 27);
  const lastPlayHandCount = room.lastPlay
    ? (room.hands?.[room.lastPlay.playerId]?.length ?? undefined)
    : undefined;
  return { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount };
}

function buildISMCTSContext(room: ServerRoom, currentPlayer: Player): ISMCTSContext {
  const mySeat = currentPlayer.seat!;

  // hand counts indexed by seat
  const handCounts: number[] = [0, 0, 0, 0];
  for (const p of room.players) {
    if (p.seat !== null) handCounts[p.seat] = room.hands?.[p.id]?.length ?? 0;
  }

  // teams indexed by seat
  const teams: number[] = [0, 0, 0, 0];
  for (const p of room.players) {
    if (p.seat !== null && p.teamId !== null) teams[p.seat] = p.teamId;
  }

  // played card IDs = full deck minus all cards still in hands
  const fullDeck = createDeck();
  const inHandIds = new Set<string>();
  for (const cards of Object.values(room.hands ?? {})) {
    for (const c of cards) inHandIds.add(c.id);
  }
  const playedCardIds = new Set<string>(
    fullDeck.filter(c => !inHandIds.has(c.id)).map(c => c.id)
  );

  // finish order as seat numbers
  const finishOrder = room.finishOrder
    .map(pid => room.players.find(p => p.id === pid)?.seat ?? -1)
    .filter(s => s >= 0);

  return {
    mySeat,
    myHand: room.hands?.[currentPlayer.id] ?? [],
    handCounts,
    teams,
    lastPlay: room.lastPlay,
    consecutivePasses: room.consecutivePasses,
    currentLevel: room.currentGameLevel ?? 2,
    playedCardIds,
    finishOrder,
  };
}

function broadcastRoomUpdate(io: Server, room: Room): void {
  io.to(room.code).emit(SOCKET_EVENTS.ROOM_UPDATE, { room });
}

function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.ERROR, { message });
}

/** Returns the room this socket is currently in (not its own socket room). */
function getSocketRoom(socket: Socket): Room | null {
  const roomCodes = Array.from(socket.rooms).filter((r) => r !== socket.id);
  if (roomCodes.length === 0) return null;
  return getRoomByCode(roomCodes[0]) ?? null;
}

/** Returns the Player object for this socket within the given room. */
function getSocketPlayer(socket: Socket, room: Room): Player | null {
  const playerId = getPlayerIdBySocket(socket.id);
  if (!playerId) return null;
  return room.players.find((p) => p.id === playerId) ?? null;
}

// --------------- Handler registration ---------------

// roomCode → set of playerIds who must re-roll (tie-breaking)
const diceRerollSets = new Map<string, Set<string>>();
// playerId key `${roomCode}:${playerId}` -> reconnect grace-period timer
const disconnectTimers = new Map<string, NodeJS.Timeout>();
// roomCode -> cleanup timer (delete room when all humans disconnected for 30min)
const roomCleanupTimers = new Map<string, NodeJS.Timeout>();

export function registerRoomHandlers(io: Server, socket: Socket): void {
  // ── create_room ──────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.CREATE_ROOM, (payload: CreateRoomPayload) => {
    const { playerName } = payload ?? {};
    if (!playerName?.trim()) {
      return emitError(socket, '请输入你的名字');
    }

    if (getAllRooms().length >= MAX_ROOMS) {
      return emitError(socket, `服务器已满（最多 ${MAX_ROOMS} 个房间），请稍后再试`);
    }

    const roomCode = generateRoomCode();
    const roomId = uuidv4();
    const playerId = uuidv4();

    const player: Player = {
      id: playerId,
      name: playerName.trim(),
      seat: null,
      teamId: null,
      isReady: false,
      isBot: false,
    };

    const room = createEmptyRoom(roomId, roomCode, playerId);
    room.players.push(player);
    createRoom(room);

    socket.join(roomCode);
    registerSocket(socket.id, roomCode, playerId);

    console.log(`[${roomCode}] [Room] Created room ${roomCode} by "${playerName}" (socket: ${socket.id})`);
    socket.emit('room_created', { roomCode, playerId });
    broadcastRoomUpdate(io, room);
  });

  // ── join_room ─────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.JOIN_ROOM, (payload: JoinRoomPayload) => {
    const { roomCode, playerName } = payload ?? {};
    if (!playerName?.trim()) {
      return emitError(socket, '请输入你的名字');
    }
    if (!roomCode?.trim()) {
      return emitError(socket, '请输入房间号');
    }

    const room = getRoomByCode(roomCode.trim().toUpperCase());
    if (!room) {
      return emitError(socket, `找不到房间 "${roomCode.toUpperCase()}"`);
    }
    if (room.players.length >= 4) {
      return emitError(socket, '房间已满 (4/4)');
    }

    const playerId = uuidv4();
    const player: Player = {
      id: playerId,
      name: playerName.trim(),
      seat: null,
      teamId: null,
      isReady: false,
      isBot: false,
    };

    room.players.push(player);
    updateRoom(room);

    socket.join(room.code);
    registerSocket(socket.id, room.code, playerId);

    console.log(`[${room.code}] [Room] "${playerName}" joined room ${room.code} (socket: ${socket.id})`);
    socket.emit('room_joined', { roomCode: room.code, playerId });
    broadcastRoomUpdate(io, room);
  });

  // ── choose_seat ───────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.CHOOSE_SEAT, (payload: ChooseSeatPayload) => {
    const { seat } = payload ?? {};
    const validSeats: PlayerSeat[] = [0, 1, 2, 3];
    if (!validSeats.includes(seat)) {
      return emitError(socket, '无效的座位编号');
    }

    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');

    const seatTaken = room.players.some((p) => p.seat === seat);
    if (seatTaken) {
      return emitError(socket, '该座位已被占用');
    }

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');

    player.seat = seat;
    player.teamId = seat % 2 === 0 ? 0 : 1;
    player.isReady = false; // reset ready on seat change
    updateRoom(room);

    console.log(`[${room.code}] [Room] "${player.name}" chose seat ${seat} in room ${room.code}`);
    broadcastRoomUpdate(io, room);
  });

  // ── player_ready ──────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.PLAYER_READY, () => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.WAITING && room.phase !== GamePhase.GAME_END) return;

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');
    if (player.seat === null) return emitError(socket, '请先选择座位');

    player.isReady = !player.isReady;
    updateRoom(room);

    console.log(`[${room.code}] [Room] "${player.name}" ready=${player.isReady} in room ${room.code}`);
    broadcastRoomUpdate(io, room);

    if (isRoomReady(room)) {
      if (room.phase === GamePhase.GAME_END) {
        startTribute(io, room);
      } else {
        startGame(io, room);
      }
    }
  });

  // ── add_bot ───────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ADD_BOT, (payload: { seat: PlayerSeat; difficulty?: 'easy' | 'medium' }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.WAITING) return emitError(socket, '只能在等待阶段添加机器人');

    const player = getSocketPlayer(socket, room);
    if (!player || player.id !== room.hostId) return emitError(socket, '只有房主可以添加机器人');

    const { seat, difficulty = 'easy' } = payload ?? {};
    const validSeats: PlayerSeat[] = [0, 1, 2, 3];
    if (!validSeats.includes(seat)) return emitError(socket, '无效座位');
    if (room.players.some((p) => p.seat === seat)) return emitError(socket, '座位已有玩家');
    if (room.players.length >= 4) return emitError(socket, '房间已满');

    const usedNames = room.players.map((p) => p.name);
    const botPlayer: import('@eggbomb/shared').Player = {
      id: uuidv4(),
      name: pickBotName(usedNames),
      seat,
      teamId: seat % 2 === 0 ? 0 : 1,
      isReady: true,
      isBot: true,
      botDifficulty: difficulty,
    };
    room.players.push(botPlayer);
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    console.log(`[${room.code}] [Room] 添加机器人 ${botPlayer.name} (座位 ${seat}, 难度: ${difficulty})`);

    if (isRoomReady(room)) {
      startGame(io, room);
    }
  });

  // ── remove_bot ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.REMOVE_BOT, (payload: { seat: PlayerSeat }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.WAITING) return emitError(socket, '只能在等待阶段移除机器人');

    const player = getSocketPlayer(socket, room);
    if (!player || player.id !== room.hostId) return emitError(socket, '只有房主可以移除机器人');

    const { seat } = payload ?? {};
    const bot = room.players.find((p) => p.seat === seat && p.isBot);
    if (!bot) return emitError(socket, '该座位没有机器人');

    room.players = room.players.filter((p) => p.id !== bot.id);
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    console.log(`[${room.code}] [Room] 移除机器人 ${bot.name} (座位 ${seat})`);
  });

  // ── toggle_manage ─────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.TOGGLE_MANAGE, () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const player = getSocketPlayer(socket, room);
    if (!player || player.isBot) return;

    const ids = room.managedPlayerIds ?? [];
    if (ids.includes(player.id)) {
      room.managedPlayerIds = ids.filter((id) => id !== player.id);
    } else {
      room.managedPlayerIds = [...ids, player.id];
    }
    updateRoom(room);
    broadcastRoomUpdate(io, room);

    const nowManaged = (room.managedPlayerIds ?? []).includes(player.id);
    if (nowManaged) {
      if (room.phase === GamePhase.DICE_ROLLING && room.diceRolls[player.id] === undefined) {
        scheduleBotDiceRoll(io, room);
      }
      if (room.phase === GamePhase.PLAYING) {
        scheduleBotTurn(io, room);
      }
      if (room.phase === GamePhase.PLAYING && room.tributeState) {
        scheduleBotTribute(io, room);
      }
    }
  });

  // ── set_start_level ───────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.SET_START_LEVEL, (payload: { level: number }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.WAITING) return emitError(socket, '只能在等待阶段设置起始级数');

    const player = getSocketPlayer(socket, room);
    if (!player || player.id !== room.hostId) return emitError(socket, '只有房主可以设置起始级数');

    const { level } = payload ?? {};
    if (!Number.isInteger(level) || level < 2 || level > 14) return emitError(socket, '无效级数');

    room.startLevel = level;
    room.currentLevel = [level, level];
    updateRoom(room);
    broadcastRoomUpdate(io, room);
  });

  // ── rejoin ────────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.REJOIN, ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
    const room = getRoomByCode(roomCode);
    if (!room) { socket.emit(SOCKET_EVENTS.REJOIN_FAIL); return; }
    // Reject if player actively left — they cannot rejoin
    if (activelyLeftPlayers.get(roomCode)?.has(playerId)) {
      socket.emit(SOCKET_EVENTS.REJOIN_FAIL);
      return;
    }
    const player = room.players.find((p) => p.id === playerId && !p.isBot);
    if (!player) { socket.emit(SOCKET_EVENTS.REJOIN_FAIL); return; }

    // Cancel pending disconnect/托管 timer
    const key = `${roomCode}:${playerId}`;
    const timer = disconnectTimers.get(key);
    if (timer) { clearTimeout(timer); disconnectTimers.delete(key); }

    // Clear disconnected + managed state
    room.disconnectedPlayerIds = (room.disconnectedPlayerIds ?? []).filter((id) => id !== playerId);
    room.managedPlayerIds = (room.managedPlayerIds ?? []).filter((id) => id !== playerId);
    // Cancel room cleanup if someone came back
    const cleanupTimer = roomCleanupTimers.get(roomCode);
    if (cleanupTimer) { clearTimeout(cleanupTimer); roomCleanupTimers.delete(roomCode); }

    registerSocket(socket.id, roomCode, playerId);
    socket.join(roomCode);

    const serverRoom = room as ServerRoom;
    const hand = serverRoom.hands?.[playerId] ?? [];
    updateRoom(room);
    socket.emit(SOCKET_EVENTS.REJOIN_SUCCESS, { room, hand, playerId });
    broadcastRoomUpdate(io, room);
    console.log(`[${room.code}] [Room] "${player.name}" rejoined room ${room.code}`);
  });

  // ── get_hint ──────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GET_HINT, () => {
    const room = getSocketRoom(socket);
    if (!room || room.phase !== GamePhase.PLAYING) return;
    const player = getSocketPlayer(socket, room);
    if (!player) return;
    const serverRoom = room as ServerRoom;
    const hand = serverRoom.hands?.[player.id] ?? [];
    const currentLevel = room.currentGameLevel ?? 2;
    const { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount } = getBotMoveContext(serverRoom, player.id);
    const move = getBotMove(hand, room.lastPlay, currentLevel, teammate?.id, teammateHandCount, opponentHandCounts, lastPlayHandCount);
    socket.emit(SOCKET_EVENTS.HINT, { cardIds: move?.cardIds ?? [] });
  });

  // ── auto_play (timeout: play bot move for this player) ────────────────────
  socket.on(SOCKET_EVENTS.AUTO_PLAY, () => {
    const room = getSocketRoom(socket);
    if (!room || room.phase !== GamePhase.PLAYING) return;
    const player = getSocketPlayer(socket, room);
    if (!player) return;
    if (room.currentTurn !== player.seat) return; // only if it's their turn
    const serverRoom = room as ServerRoom;
    const hand = serverRoom.hands?.[player.id] ?? [];
    const currentLevel = room.currentGameLevel ?? 2;
    const { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount } = getBotMoveContext(serverRoom, player.id);
    const move = getBotMove(hand, room.lastPlay, currentLevel, teammate?.id, teammateHandCount, opponentHandCounts, lastPlayHandCount);
    if (!move || move.cardIds.length === 0) {
      // pass
      if (room.lastPlay && room.lastPlay.playerId !== player.id) {
        doPassTurn(io, room, player);
      }
    } else {
      doPlayCards(io, room, player, move.cardIds, move.intendedType);
    }
  });

  // ── reset_room ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.RESET_ROOM, () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    if (room.phase !== GamePhase.GAME_END) return;
    if (!room.gameResult?.matchWon) return;

    const sl = room.startLevel ?? 2;
    room.phase = GamePhase.WAITING;
    room.currentLevel = [sl, sl];
    room.currentGameLevel = sl;
    room.playingAceTeam = null;
    room.aceFailures = [0, 0];
    room.gameResult = null;
    room.tributeState = null;
    room.currentTurn = null;
    room.lastPlay = null;
    room.finishOrder = [];
    room.handCount = {};
    room.currentRoundPlays = {};
    room.currentRoundPlayOrder = [];
    room.diceRolls = {};
    room.consecutivePasses = 0;
    const serverRoom = room as Room & { hands: Record<string, Card[]> };
    if (serverRoom.hands) serverRoom.hands = {};
    room.players.forEach((p) => { if (!p.isBot) p.isReady = false; });
    room.managedPlayerIds = [];
    room.disconnectedPlayerIds = [];
    room.diceTiedIds = [];
    room.isRerollRound = false;
    updateRoom(room);
    broadcastRoomUpdate(io, room);
  });

  // ── roll_dice ─────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.ROLL_DICE, () => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.DICE_ROLLING) return emitError(socket, '不在掷骰子阶段');

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');
    if (room.diceRolls[player.id] !== undefined) return emitError(socket, '你已经掷过了');

    // In a re-roll round only the tied players may roll
    const rerollSet = diceRerollSets.get(room.code);
    if (rerollSet && !rerollSet.has(player.id)) return emitError(socket, '不需要你再投了');

    room.diceRolls[player.id] = Math.ceil(Math.random() * 6);
    updateRoom(room);

    // Check if all players have rolled
    const allRolled = room.players.every((p) => room.diceRolls[p.id] !== undefined);
    if (allRolled) {
      // Don't broadcast before finalizeDiceRoll — avoids a flash where client
      // briefly sees all dice rolled with isRerollRound=true before DICE_ROLL arrives
      finalizeDiceRoll(io, room);
    } else {
      broadcastRoomUpdate(io, room);
    }
  });

  // ── play_cards ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.PLAY_CARDS, (payload: { cardIds: string[]; intendedType?: string }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.PLAYING) return emitError(socket, '游戏未在进行中');

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');
    if (player.seat !== room.currentTurn) return emitError(socket, '还没轮到你');

    const { cardIds, intendedType } = payload ?? {};
    if (!cardIds || cardIds.length === 0) return emitError(socket, '请选择要出的牌');

    // Get player's hand from room
    const serverRoom = room as Room & { hands: Record<string, Card[]> };
    const playerHand = serverRoom.hands?.[player.id] ?? [];
    const playedCards = cardIds.map((id: string) => playerHand.find((c) => c.id === id)).filter(Boolean) as Card[];
    if (playedCards.length !== cardIds.length) return emitError(socket, '牌不在你手中');

    // Classify the played hand
    const currentLevel = room.currentGameLevel ?? 2;

    let handResult: HandResult | null;
    if (intendedType) {
      // Validate that the cards can actually form the intended type
      const allPossible = classifyAllPossible(playedCards, currentLevel);
      handResult = allPossible.find((r) => r.type === intendedType) ?? null;
      if (!handResult) return emitError(socket, '选择的牌型无效');
    } else {
      handResult = classifyHand(playedCards, currentLevel);
    }
    if (!handResult) return emitError(socket, '不是有效的牌型');

    // Check if it beats the last play
    if (room.lastPlay && room.lastPlay.playerId !== player.id) {
      if (!canBeat(handResult, room.lastPlay.hand)) {
        return emitError(socket, '打不过上家的牌');
      }
    }

    // Remove played cards from hand
    const remainingCards = playerHand.filter((c) => !cardIds.includes(c.id));
    serverRoom.hands[player.id] = remainingCards;
    room.handCount[player.id] = remainingCards.length;

    // Update last play and current round plays
    room.lastPlay = { playerId: player.id, seat: player.seat!, cards: playedCards, hand: handResult };
    room.currentRoundPlays[player.seat!] = { cards: playedCards, hand: handResult };
    // Track order: replace existing entry if same seat played again this round
    room.currentRoundPlayOrder = room.currentRoundPlayOrder.filter((s) => s !== player.seat!);
    room.currentRoundPlayOrder.push(player.seat!);
    room.consecutivePasses = 0;

    // Determine next turn (skip finished players)
    const nextSeat = getNextActiveSeat(room, player.seat!);
    room.currentTurn = nextSeat;
    updateRoom(room);

    io.to(room.code).emit(SOCKET_EVENTS.CARDS_PLAYED, {
      playerId: player.id,
      seat: player.seat,
      cards: playedCards,
      hand: handResult,
      nextTurn: nextSeat,
    });

    // Check if player finished
    if (remainingCards.length === 0) {
      room.finishOrder.push(player.id);
      io.to(room.code).emit(SOCKET_EVENTS.PLAYER_FINISHED, {
        playerId: player.id,
        seat: player.seat,
        finishPosition: room.finishOrder.length,
      });

      // Check game end: 3+ finished, OR first two are teammates (大跑)
      const first = room.players.find((p) => p.id === room.finishOrder[0]);
      const second = room.players.find((p) => p.id === room.finishOrder[1]);
      const isLiangPao = room.finishOrder.length === 2 && first && second && first.teamId === second.teamId;
      if (room.finishOrder.length >= 3 || isLiangPao) {
        endGame(io, room);
        return;
      }
    }

    broadcastRoomUpdate(io, room);
    scheduleBotTurn(io, room);
  });

  // ── pass_turn ─────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.PASS_TURN, () => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.PLAYING) return emitError(socket, '游戏未在进行中');

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');
    if (player.seat !== room.currentTurn) return emitError(socket, '还没轮到你');
    if (!room.lastPlay) return emitError(socket, '没有上家出牌，不能过');

    room.consecutivePasses += 1;
    // Remove the passing player's cards from the round display
    delete room.currentRoundPlays[player.seat!];
    room.currentRoundPlayOrder = room.currentRoundPlayOrder.filter((s) => s !== player.seat!);
    const nextSeat = getNextActiveSeat(room, player.seat!);
    room.currentTurn = nextSeat;
    updateRoom(room);

    io.to(room.code).emit(SOCKET_EVENTS.PASS_TURN, {
      playerId: player.id,
      seat: player.seat,
      nextTurn: nextSeat,
    });

    const lastPlayerId = room.lastPlay?.playerId;
    const lastPlayPlayer = room.players.find((p) => p.id === lastPlayerId);
    const lastPlayerFinished = lastPlayerId !== undefined && room.finishOrder.includes(lastPlayerId);

    // Active players (not finished)
    const activePlayers = room.players.filter(
      (p) => p.seat !== null && !room.finishOrder.includes(p.id)
    );
    // Passes needed to end the round:
    // - If lastPlay player is still active: everyone else must pass (activeCount - 1)
    // - If lastPlay player finished: all active players must pass (activeCount)
    const passesNeeded = lastPlayerFinished ? activePlayers.length : activePlayers.length - 1;
    const roundOver = room.consecutivePasses >= passesNeeded;

    if (roundOver) {
      let freshSeat = nextSeat;

      if (lastPlayerFinished && lastPlayPlayer) {
        // Give turn to the finished player's teammate instead
        const teammate = room.players.find(
          (p) => p.teamId === lastPlayPlayer.teamId &&
                 p.id !== lastPlayPlayer.id &&
                 !room.finishOrder.includes(p.id) &&
                 p.seat !== null
        );
        if (teammate) freshSeat = teammate.seat!;
      }

      room.lastPlay = null;
      room.consecutivePasses = 0;
      room.currentRoundPlays = {};
      room.currentRoundPlayOrder = [];
      room.currentTurn = freshSeat;
      updateRoom(room);
      broadcastRoomUpdate(io, room);
    } else {
      broadcastRoomUpdate(io, room);
    }
    scheduleBotTurn(io, room);
  });

  // ── tribute_card (giver selects which card to tribute) ───────────────────
  socket.on(SOCKET_EVENTS.TRIBUTE_CARD, (payload: { cardId: string }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.TRIBUTE_RETURN) return emitError(socket, '不在进贡阶段');
    if (!room.tributeState || room.tributeState.skipTribute) return emitError(socket, '不需要进贡');

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');

    const entry = room.tributeState.entries.find((e) => e.fromPlayerId === player.id && !e.tributeGiven);
    if (!entry) return emitError(socket, '你不需要进贡');

    const serverRoom = room as Room & { hands: Record<string, Card[]> };
    const playerHand = serverRoom.hands[player.id] ?? [];
    const tributeCard = playerHand.find((c) => c.id === payload.cardId);
    if (!tributeCard) return emitError(socket, '这张牌不在你手中');

    const currentLevel = room.currentGameLevel ?? 2;

    if (isWildcard(tributeCard, currentLevel)) return emitError(socket, '不能贡万能牌（红心级牌）');

    // Must be the highest eligible value
    const eligible = playerHand.filter((c) => !isWildcard(c, currentLevel));
    const maxVal = eligible.length > 0 ? Math.max(...eligible.map((c) => getGameValue(c, currentLevel))) : -1;
    if (getGameValue(tributeCard, currentLevel) < maxVal) return emitError(socket, '必须贡最大的牌');

    // Move tribute card from giver to receiver
    serverRoom.hands[player.id] = playerHand.filter((c) => c.id !== payload.cardId);
    serverRoom.hands[entry.toPlayerId] = [...(serverRoom.hands[entry.toPlayerId] ?? []), tributeCard];
    room.handCount[player.id] = serverRoom.hands[player.id].length;
    room.handCount[entry.toPlayerId] = serverRoom.hands[entry.toPlayerId].length;

    entry.tributeCard = tributeCard;
    entry.tributeGiven = true;
    updateRoom(room);

    const sorted = [...room.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
    sendNewHands(io, room, sorted);
    io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
    broadcastRoomUpdate(io, room);
    scheduleBotTribute(io, room);
  });

  // ── tribute_return_card ───────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.TRIBUTE_RETURN_CARD, (payload: { cardId: string }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (room.phase !== GamePhase.TRIBUTE_RETURN) return emitError(socket, '不在还贡阶段');
    if (!room.tributeState || room.tributeState.skipTribute) return emitError(socket, '不需要还贡');

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');

    // Find the tribute entry where this player is the RECEIVER, tribute was given, and hasn't returned yet
    const entry = room.tributeState.entries.find((e) => e.toPlayerId === player.id && e.tributeGiven && !e.done);
    if (!entry) return emitError(socket, '你不需要还贡或对方还未进贡');

    const serverRoom = room as Room & { hands: Record<string, Card[]> };
    const playerHand = serverRoom.hands[player.id] ?? [];
    const returnCard = playerHand.find((c) => c.id === payload.cardId);
    if (!returnCard) return emitError(socket, '这张牌不在你手中');

    // Validate: card must have game value ≤ 10 (ranks 3-10 only)
    const currentLevel = room.currentGameLevel ?? 2;
    const cardVal = getGameValue(returnCard, currentLevel);
    if (cardVal > 10) return emitError(socket, '还贡的牌必须是10或以下');

    // Remove return card from receiver's hand
    serverRoom.hands[player.id] = playerHand.filter((c) => c.id !== payload.cardId);
    room.handCount[player.id] = serverRoom.hands[player.id].length;
    entry.returnCard = returnCard;

    const sorted = [...room.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));

    if (room.tributeState.isEqualTribute) {
      // Equal tribute (大跑 equal case): store in pendingReturns, wait for grab
      room.tributeState.pendingReturns.push({ receiverId: player.id, card: returnCard });

      const allReturnsIn = room.tributeState.pendingReturns.length >= room.tributeState.entries.length;
      if (allReturnsIn) {
        room.tributeState.grabPhase = true;
      }

      updateRoom(room);
      sendNewHands(io, room, sorted);
      io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
      broadcastRoomUpdate(io, room);
      scheduleBotTribute(io, room);
    } else {
      // Normal case: move card immediately to tributer
      serverRoom.hands[entry.fromPlayerId] = [...(serverRoom.hands[entry.fromPlayerId] ?? []), returnCard];
      room.handCount[entry.fromPlayerId] = serverRoom.hands[entry.fromPlayerId].length;
      entry.done = true;

      updateRoom(room);
      sendNewHands(io, room, sorted);
      io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
      broadcastRoomUpdate(io, room);
      scheduleBotTribute(io, room);

      const allDone = room.tributeState.entries.every((e) => e.done);
      if (allDone) {
        revealThenStart(io, room);
      }
    }
  });

  // ── grab_tribute (抢贡: tributer grabs a pending return card) ────────────
  socket.on(SOCKET_EVENTS.GRAB_TRIBUTE, (payload: { cardId: string }) => {
    const room = getSocketRoom(socket);
    if (!room) return emitError(socket, '你不在任何房间中');
    if (!room.tributeState?.grabPhase) return emitError(socket, '不在抢贡阶段');

    const player = getSocketPlayer(socket, room);
    if (!player) return emitError(socket, '找不到你的玩家信息');

    // Player must be a tributer who hasn't grabbed yet
    const myEntry = room.tributeState.entries.find((e) => e.fromPlayerId === player.id && !e.done);
    if (!myEntry) return emitError(socket, '你不需要抢贡');
    if (room.tributeState.grabLog.includes(player.id)) return emitError(socket, '你已经抢过了');

    // Find the pending return card
    const pendingIdx = room.tributeState.pendingReturns.findIndex((pr) => pr.card.id === payload.cardId);
    if (pendingIdx === -1) return emitError(socket, '这张牌已被抢走或不存在');

    const grabbed = room.tributeState.pendingReturns[pendingIdx];
    room.tributeState.pendingReturns.splice(pendingIdx, 1);
    room.tributeState.grabLog.push(player.id);
    myEntry.returnCard = grabbed.card;
    myEntry.done = true;

    // Move grabbed card to tributer's hand
    const serverRoom = room as Room & { hands: Record<string, Card[]> };
    serverRoom.hands[player.id] = [...(serverRoom.hands[player.id] ?? []), grabbed.card];
    room.handCount[player.id] = serverRoom.hands[player.id].length;

    const sorted = [...room.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));

    const allGrabbed = room.tributeState.entries.every((e) => e.done);
    if (allGrabbed) {
      // Last grabber starts first
      room.tributeState.firstPlayerId = room.tributeState.grabLog[room.tributeState.grabLog.length - 1];
      room.tributeState.grabPhase = false;
    }

    updateRoom(room);
    sendNewHands(io, room, sorted);
    io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
    broadcastRoomUpdate(io, room);

    if (allGrabbed) {
      revealThenStart(io, room);
    }
  });

  // ── leave_room ────────────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.LEAVE_ROOM, () => {
    handleActiveLeave(io, socket);
  });

  socket.on('disconnect', () => {
    handlePassiveLeave(io, socket);
  });
}

// --------------- Bot execution helpers ---------------

type ServerRoom = Room & { hands: Record<string, Card[]> };

function doPlayCards(io: Server, room: Room, player: import('@eggbomb/shared').Player, cardIds: string[], intendedType?: string): void {
  const serverRoom = room as ServerRoom;
  const playerHand = serverRoom.hands?.[player.id] ?? [];
  const playedCards = cardIds.map((id) => playerHand.find((c) => c.id === id)).filter(Boolean) as Card[];
  if (playedCards.length !== cardIds.length) {
    console.warn(`[${room.code}][doPlayCards] seat=${player.seat} card ID mismatch: wanted ${cardIds.length}, found ${playedCards.length}. IDs=${JSON.stringify(cardIds)} handSize=${playerHand.length}`);
    return;
  }

  const currentLevel = room.currentGameLevel ?? 2;
  let handResult: import('@eggbomb/shared').HandResult | null;
  if (intendedType) {
    const allPossible = classifyAllPossible(playedCards, currentLevel);
    handResult = allPossible.find((r) => r.type === intendedType) ?? null;
  } else {
    handResult = classifyHand(playedCards, currentLevel);
  }
  if (!handResult) {
    console.warn(`[${room.code}][doPlayCards] seat=${player.seat} unclassifiable hand: ${JSON.stringify(cardIds)}`);
    return;
  }
  if (room.lastPlay && room.lastPlay.playerId !== player.id) {
    if (!canBeat(handResult, room.lastPlay.hand)) {
      console.warn(`[${room.code}][doPlayCards] seat=${player.seat} can't beat lastPlay: hand=${JSON.stringify(handResult)} vs lastPlay=${JSON.stringify(room.lastPlay.hand)}`);
      return;
    }
  }

  const remainingCards = playerHand.filter((c) => !cardIds.includes(c.id));
  serverRoom.hands[player.id] = remainingCards;
  room.handCount[player.id] = remainingCards.length;
  room.lastPlay = { playerId: player.id, seat: player.seat!, cards: playedCards, hand: handResult };
  room.currentRoundPlays[player.seat!] = { cards: playedCards, hand: handResult };
  room.currentRoundPlayOrder = room.currentRoundPlayOrder.filter((s) => s !== player.seat!);
  room.currentRoundPlayOrder.push(player.seat!);
  room.consecutivePasses = 0;

  const nextSeat = getNextActiveSeat(room, player.seat!);
  room.currentTurn = nextSeat;
  updateRoom(room);

  io.to(room.code).emit(SOCKET_EVENTS.CARDS_PLAYED, { playerId: player.id, seat: player.seat, cards: playedCards, hand: handResult, nextTurn: nextSeat });

  if (remainingCards.length === 0) {
    room.finishOrder.push(player.id);
    io.to(room.code).emit(SOCKET_EVENTS.PLAYER_FINISHED, { playerId: player.id, seat: player.seat, finishPosition: room.finishOrder.length });
    const first = room.players.find((p) => p.id === room.finishOrder[0]);
    const second = room.players.find((p) => p.id === room.finishOrder[1]);
    const isLiangPao = room.finishOrder.length === 2 && first && second && first.teamId === second.teamId;
    if (room.finishOrder.length >= 3 || isLiangPao) { endGame(io, room); return; }
  }

  broadcastRoomUpdate(io, room);
  scheduleBotTurn(io, room);
}

function doPassTurn(io: Server, room: Room, player: import('@eggbomb/shared').Player): void {
  if (!room.lastPlay) return;
  room.consecutivePasses += 1;
  delete room.currentRoundPlays[player.seat!];
  room.currentRoundPlayOrder = room.currentRoundPlayOrder.filter((s) => s !== player.seat!);
  const nextSeat = getNextActiveSeat(room, player.seat!);
  room.currentTurn = nextSeat;
  updateRoom(room);

  io.to(room.code).emit(SOCKET_EVENTS.PASS_TURN, { playerId: player.id, seat: player.seat, nextTurn: nextSeat });

  const lastPlayerId = room.lastPlay?.playerId;
  const lastPlayPlayer = room.players.find((p) => p.id === lastPlayerId);
  const lastPlayerFinished = lastPlayerId !== undefined && room.finishOrder.includes(lastPlayerId);
  const activePlayers = room.players.filter((p) => p.seat !== null && !room.finishOrder.includes(p.id));
  const passesNeeded = lastPlayerFinished ? activePlayers.length : activePlayers.length - 1;
  const roundOver = room.consecutivePasses >= passesNeeded;

  if (roundOver) {
    let freshSeat = nextSeat;
    if (lastPlayerFinished && lastPlayPlayer) {
      const teammate = room.players.find((p) => p.teamId === lastPlayPlayer.teamId && p.id !== lastPlayPlayer.id && !room.finishOrder.includes(p.id) && p.seat !== null);
      if (teammate) freshSeat = teammate.seat!;
    }
    room.lastPlay = null;
    room.consecutivePasses = 0;
    room.currentRoundPlays = {};
    room.currentRoundPlayOrder = [];
    room.currentTurn = freshSeat;
    updateRoom(room);
    broadcastRoomUpdate(io, room);
  } else {
    broadcastRoomUpdate(io, room);
  }
  scheduleBotTurn(io, room);
}

// ISMCTS thinking time for bot players (ms). Managed human players use instant rule bot.
const BOT_THINK_LEAD_MS = 7000;  // leading a new round (more strategic uncertainty)
const BOT_THINK_FOLLOW_MS = 4000; // following an existing play

function scheduleBotTurn(io: Server, room: Room): void {
  const currentPlayer = room.players.find((p) => p.seat === room.currentTurn);
  if (!currentPlayer) return;
  const isAutoPlay = currentPlayer.isBot || (room.managedPlayerIds ?? []).includes(currentPlayer.id);
  if (!isAutoPlay) return;
  const roomCode = room.code;
  const seatSnapshot = room.currentTurn;
  setTimeout(async () => {
    const freshRoom = getRoomByCode(roomCode) as ServerRoom | undefined;
    if (!freshRoom || freshRoom.phase !== GamePhase.PLAYING) return;
    if (freshRoom.currentTurn !== seatSnapshot) return;

    let cardIds: string[] | null;
    let intendedType: import('@eggbomb/shared').HandType | undefined;

    if (currentPlayer.isBot && currentPlayer.botDifficulty === 'medium') {
      // Medium bot: ISMCTS in worker thread (non-blocking).
      // Skip ISMCTS when only 2 active players remain — outcome is determined by card counts,
      // all candidates score identically, and ISMCTS wastes the full time budget.
      const activePlayers = freshRoom.players.filter(p =>
        p.seat !== null && !(freshRoom.finishOrder ?? []).includes(p.id)
      ).length;
      const ctx = buildISMCTSContext(freshRoom, currentPlayer);

      if (activePlayers <= 2) {
        // 2-player endgame: outcome determined by card counts, skip ISMCTS
        const { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount } = getBotMoveContext(freshRoom, currentPlayer.id);
        const move = getBotMove(ctx.myHand, freshRoom.lastPlay, ctx.currentLevel, teammate?.id, teammateHandCount, opponentHandCounts, lastPlayHandCount);
        cardIds = move?.cardIds ?? null;
        intendedType = move?.intendedType;
      } else {
        const isLead = !freshRoom.lastPlay;
        const ismctsStart = Date.now();
        const ismctsResult = await runISMCTS(ctx, isLead ? BOT_THINK_LEAD_MS : BOT_THINK_FOLLOW_MS);
        // Ensure minimum think time even for forced (1-candidate) results
        const ismctsElapsed = Date.now() - ismctsStart;
        const minThinkMs = 2200; // combined with 800ms initial delay → 3s total minimum
        if (ismctsElapsed < minThinkMs) {
          await new Promise(r => setTimeout(r, minThinkMs - ismctsElapsed));
        }
        cardIds = ismctsResult.cardIds;
        let ismctsLog = ismctsResult.log;
        // Re-fetch room after async wait — state may have changed
        const roomAfter = getRoomByCode(roomCode) as ServerRoom | undefined;
        if (!roomAfter || roomAfter.phase !== GamePhase.PLAYING) {
          console.log(`[${roomCode}] ${ismctsLog} → room gone/phase changed`);
          return;
        }
        if (roomAfter.currentTurn !== seatSnapshot) {
          console.log(`[${roomCode}] ${ismctsLog} → turn changed to ${roomAfter.currentTurn}`);
          return;
        }
        // If ISMCTS says pass but we're leading, fall back to rule bot
        if ((cardIds === null || cardIds.length === 0) && !roomAfter.lastPlay) {
          const move = getBotMove(ctx.myHand, null, ctx.currentLevel);
          cardIds = move?.cardIds ?? null;
          intendedType = move?.intendedType;
        }
        // Fallback: if ISMCTS cardIds won't work (e.g. stale IDs), use rule bot on fresh hand
        if (cardIds && cardIds.length > 0) {
          const freshHand = roomAfter.hands?.[currentPlayer.id] ?? [];
          const allFound = cardIds.every(id => freshHand.some(c => c.id === id));
          if (!allFound) {
            const { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount } = getBotMoveContext(roomAfter, currentPlayer.id);
            const move = getBotMove(freshHand, roomAfter.lastPlay, ctx.currentLevel, teammate?.id, teammateHandCount, opponentHandCounts, lastPlayHandCount);
            cardIds = move?.cardIds ?? null;
            intendedType = move?.intendedType;
            ismctsLog += ' → stale IDs, rule bot fallback';
          }
        }
        if (!cardIds || cardIds.length === 0) {
          if (roomAfter.lastPlay) {
            console.log(`[${roomCode}] ${ismctsLog} → passes`);
            doPassTurn(io, roomAfter, currentPlayer);
          } else {
            console.warn(`[${roomCode}] ${ismctsLog} → no move and no lastPlay (unexpected)`);
          }
        } else {
          console.log(`[${roomCode}] ${ismctsLog} → plays ${cardIds.length} cards`);
          doPlayCards(io, roomAfter, currentPlayer, cardIds, intendedType);
        }
        return;
      }
    } else if (currentPlayer.isBot) {
      // Easy bot: instant rule bot
      const hand = freshRoom.hands?.[currentPlayer.id] ?? [];
      const currentLevel = freshRoom.currentGameLevel ?? 2;
      const { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount } = getBotMoveContext(freshRoom, currentPlayer.id);
      const move = getBotMove(hand, freshRoom.lastPlay, currentLevel, teammate?.id, teammateHandCount, opponentHandCounts, lastPlayHandCount);
      cardIds = move?.cardIds ?? null;
      intendedType = move?.intendedType;
    } else {
      // Managed human player: instant rule bot (no delay)
      const hand = freshRoom.hands?.[currentPlayer.id] ?? [];
      const currentLevel = freshRoom.currentGameLevel ?? 2;
      const { teammate, teammateHandCount, opponentHandCounts, lastPlayHandCount } = getBotMoveContext(freshRoom, currentPlayer.id);
      const move = getBotMove(hand, freshRoom.lastPlay, currentLevel, teammate?.id, teammateHandCount, opponentHandCounts, lastPlayHandCount);
      cardIds = move?.cardIds ?? null;
      intendedType = move?.intendedType;
    }

    if (!cardIds || cardIds.length === 0) {
      if (freshRoom.lastPlay) {
        console.log(`[${roomCode}] [Bot] seat=${seatSnapshot} passes`);
        doPassTurn(io, freshRoom, currentPlayer);
      }
    } else {
      doPlayCards(io, freshRoom, currentPlayer, cardIds, intendedType);
    }
  }, 800);
}

function scheduleBotTribute(io: Server, room: Room): void {
  if (!room.tributeState || room.tributeState.skipTribute) return;
  const roomCode = room.code;
  setTimeout(() => {
    const r = getRoomByCode(roomCode) as ServerRoom | undefined;
    if (!r || !r.tributeState || r.tributeState.skipTribute) return;

    const ts = r.tributeState;
    const currentLevel = r.currentGameLevel ?? 2;

    const isAuto = (id: string) => {
      const p = r.players.find(pl => pl.id === id);
      return p?.isBot || (r.managedPlayerIds ?? []).includes(id);
    };

    // Auto givers: bot or managed player hasn't given tribute yet
    for (const entry of ts.entries) {
      if (entry.tributeGiven) continue;
      const giver = r.players.find(p => p.id === entry.fromPlayerId);
      if (!giver || !isAuto(giver.id)) continue;
      const hand = r.hands?.[giver.id] ?? [];
      const eligible = hand.filter(c => !isWildcard(c, currentLevel));
      if (eligible.length === 0) continue;
      const maxVal = Math.max(...eligible.map(c => getGameValue(c, currentLevel)));
      const tributeCard = eligible.find(c => getGameValue(c, currentLevel) === maxVal);
      if (!tributeCard) continue;
      // Move tribute card from giver to receiver
      r.hands[giver.id] = hand.filter(c => c.id !== tributeCard.id);
      r.hands[entry.toPlayerId] = [...(r.hands[entry.toPlayerId] ?? []), tributeCard];
      r.handCount[giver.id] = r.hands[giver.id].length;
      r.handCount[entry.toPlayerId] = r.hands[entry.toPlayerId].length;
      entry.tributeCard = tributeCard;
      entry.tributeGiven = true;
      updateRoom(r);
      const sorted = [...r.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
      sendNewHands(io, r, sorted);
      io.to(r.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: r.tributeState });
      broadcastRoomUpdate(io, r);
    }

    // Auto receivers: bot or managed player, tribute given, not done yet
    for (const entry of ts.entries) {
      if (!entry.tributeGiven || entry.done) continue;
      if (ts.isEqualTribute && ts.grabPhase) continue; // handled below
      const receiver = r.players.find(p => p.id === entry.toPlayerId);
      if (!receiver || !isAuto(receiver.id)) continue;
      const hand = r.hands?.[receiver.id] ?? [];
      // Return smallest card with game value <= 10
      const eligible = hand.filter(c => getGameValue(c, currentLevel) <= 10);
      if (eligible.length === 0) continue;
      const returnCard = eligible.sort((a, b) => getGameValue(a, currentLevel) - getGameValue(b, currentLevel))[0];
      r.hands[receiver.id] = hand.filter(c => c.id !== returnCard.id);
      r.handCount[receiver.id] = r.hands[receiver.id].length;
      entry.returnCard = returnCard;
      if (ts.isEqualTribute) {
        ts.pendingReturns.push({ receiverId: receiver.id, card: returnCard });
        if (ts.pendingReturns.length >= ts.entries.length) ts.grabPhase = true;
      } else {
        r.hands[entry.fromPlayerId] = [...(r.hands[entry.fromPlayerId] ?? []), returnCard];
        r.handCount[entry.fromPlayerId] = r.hands[entry.fromPlayerId].length;
        entry.done = true;
      }
      updateRoom(r);
      const sorted = [...r.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
      sendNewHands(io, r, sorted);
      io.to(r.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: r.tributeState });
      broadcastRoomUpdate(io, r);
      if (!ts.isEqualTribute) {
        const allDone = ts.entries.every(e => e.done);
        if (allDone) revealThenStart(io, r);
      }
    }

    // Auto grab phase
    if (ts.grabPhase) {
      for (const entry of ts.entries) {
        if (entry.done) continue;
        const tributer = r.players.find(p => p.id === entry.fromPlayerId);
        if (!tributer || !isAuto(tributer.id)) continue;
        if (ts.grabLog.includes(tributer.id)) continue;
        if (ts.pendingReturns.length === 0) continue;
        const grabbed = ts.pendingReturns[0];
        ts.pendingReturns.splice(0, 1);
        ts.grabLog.push(tributer.id);
        entry.returnCard = grabbed.card;
        entry.done = true;
        r.hands[tributer.id] = [...(r.hands[tributer.id] ?? []), grabbed.card];
        r.handCount[tributer.id] = r.hands[tributer.id].length;
        updateRoom(r);
        const sorted = [...r.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
        sendNewHands(io, r, sorted);
        const allGrabbed = ts.entries.every(e => e.done);
        if (allGrabbed) {
          ts.firstPlayerId = ts.grabLog[ts.grabLog.length - 1];
          ts.grabPhase = false;
        }
        io.to(r.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: r.tributeState });
        broadcastRoomUpdate(io, r);
        if (allGrabbed) setTimeout(() => startNewGameAfterTribute(io, r), 1500);
      }
    }
  }, 600);
}

// --------------- Game start ---------------

function scheduleBotDiceRoll(io: Server, room: Room): void {
  const roomCode = room.code;
  const autoPlayers = room.players.filter(
    (p) => p.isBot || (room.managedPlayerIds ?? []).includes(p.id)
  );
  autoPlayers.forEach((p) => {
    setTimeout(() => {
      const r = getRoomByCode(roomCode);
      if (!r || r.phase !== GamePhase.DICE_ROLLING) return;
      if (r.diceRolls[p.id] !== undefined) return;
      // In a re-roll round, only roll if this player is in the re-roll set
      const reroll = diceRerollSets.get(r.code);
      if (reroll && !reroll.has(p.id)) return;
      r.diceRolls[p.id] = Math.ceil(Math.random() * 6);
      updateRoom(r);
      const allRolled = r.players.every((pl) => r.diceRolls[pl.id] !== undefined);
      if (allRolled) {
        finalizeDiceRoll(io, r);
      } else {
        broadcastRoomUpdate(io, r);
      }
    }, 500 + Math.random() * 1000);
  });
}

function finalizeDiceRoll(io: Server, room: Room): void {
  const rolls: DiceRollPayload['rolls'] = room.players.map((p) => ({
    playerId: p.id,
    seat: p.seat as PlayerSeat,
    name: p.name,
    roll: room.diceRolls[p.id] ?? 1,
  }));
  // In a reroll round, only compare the players who actually rerolled
  const rerollSet = diceRerollSets.get(room.code);
  const contestRolls = rerollSet ? rolls.filter((r) => rerollSet.has(r.playerId)) : rolls;
  const maxRoll = Math.max(...contestRolls.map((r) => r.roll));
  const tied = contestRolls.filter((r) => r.roll === maxRoll);

  if (tied.length > 1) {
    // Tie — keep all rolls visible for 2s so players can see who tied, then reset
    const tiedIds = new Set(tied.map((r) => r.playerId));
    diceRerollSets.set(room.code, tiedIds);
    room.diceTiedIds = [...tiedIds];
    room.isRerollRound = false; // still showing tie results, not yet reroll
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    setTimeout(() => {
      const r = getRoomByCode(room.code);
      if (!r || r.phase !== GamePhase.DICE_ROLLING) return;
      tiedIds.forEach((id) => delete r.diceRolls[id]);
      // Keep diceTiedIds so the client knows who is rerolling
      r.isRerollRound = true; // now the tied players need to roll again
      updateRoom(r);
      broadcastRoomUpdate(io, r);
      scheduleBotDiceRoll(io, r);
    }, 2500);
    return;
  }

  diceRerollSets.delete(room.code);
  room.isRerollRound = false;
  room.diceTiedIds = []; // clear now that a winner is determined
  const winner = tied[0];
  io.to(room.code).emit(SOCKET_EVENTS.DICE_ROLL, { rolls, winningSeat: winner.seat });
  setTimeout(() => {
    const r = getRoomByCode(room.code);
    if (!r) return;
    r.phase = GamePhase.PLAYING;
    r.currentTurn = winner.seat;
    updateRoom(r);
    broadcastRoomUpdate(io, r);
    scheduleBotTurn(io, r);
  }, 2500);
}

function startGame(io: Server, room: Room): void {
  room.phase = GamePhase.DEALING;
  updateRoom(room);

  const hands = dealCards();
  const sorted = [...room.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));

  // Initialize game state fields
  room.lastPlay = null;
  room.currentGameLevel = room.currentLevel[0]; // first game both teams at same level
  room.consecutivePasses = 0;
  room.finishOrder = [];
  room.handCount = {};
  const serverRoom = room as Room & { hands: Record<string, Card[]> };
  if (!serverRoom.hands) serverRoom.hands = {};

  sorted.forEach((player, i) => {
    room.handCount[player.id] = hands[i].length;
    serverRoom.hands[player.id] = hands[i];
  });

  io.to(room.code).emit(SOCKET_EVENTS.GAME_STARTED, { room });

  // Emit each player's hand to the whole room (client filters by playerId)
  sorted.forEach((player, i) => {
    io.to(room.code).emit(SOCKET_EVENTS.DEAL_CARDS, {
      playerId: player.id,
      cards: hands[i],
    });
  });

  // First game: enter DICE_ROLLING phase, wait for all players to roll
  const sl = room.startLevel ?? 2;
  if (room.currentLevel[0] === sl && room.currentLevel[1] === sl) {
    room.phase = GamePhase.DICE_ROLLING;
    room.diceRolls = {};
    room.isRerollRound = false;
    room.currentTurn = null;
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    scheduleBotDiceRoll(io, room);
    return;
  }

  room.phase = GamePhase.PLAYING;
  room.currentTurn = (sorted[0]?.seat ?? 0) as PlayerSeat;
  updateRoom(room);
  broadcastRoomUpdate(io, room);
  console.log(`[${room.code}] [Game] started`);
}

function getNextActiveSeat(room: Room, currentSeat: PlayerSeat): PlayerSeat {
  const activePlayers = room.players.filter(
    (p) => p.seat !== null && !room.finishOrder.includes(p.id)
  );
  const seats = activePlayers.map((p) => p.seat as PlayerSeat).sort((a, b) => a - b);
  const idx = seats.indexOf(currentSeat);
  // Counter-clockwise: seats sorted [0,1,2,3], go backwards (0→3→2→1→0)
  return seats[(idx - 1 + seats.length) % seats.length];
}

function endGame(io: Server, room: Room): void {
  // Fill in any players who didn't finish (末游 etc.)
  const allPlayerIds = room.players.map((p) => p.id);
  const remaining = allPlayerIds.filter((id) => !room.finishOrder.includes(id));
  room.finishOrder.push(...remaining);

  // Determine winning team and level advancement
  const winnerPlayerId = room.finishOrder[0];
  const winnerPlayer = room.players.find((p) => p.id === winnerPlayerId)!;
  const winningTeam = winnerPlayer.teamId as Team;

  // Find where winning team's second player finished
  const teammateId = room.players.find(
    (p) => p.teamId === winningTeam && p.id !== winnerPlayerId
  )?.id;
  const teammatePositionIndex = room.finishOrder.indexOf(teammateId!); // 0-indexed
  // If teammate not in finishOrder (末游/4th), position = 4
  const secondPosition = teammatePositionIndex === -1 ? 4 : teammatePositionIndex + 1;

  const levelAdvance = secondPosition === 2 ? 3 : secondPosition === 3 ? 2 : 1;

  // Update levels
  const newLevels: [number, number] = [...room.currentLevel] as [number, number];
  const aceTeam = room.playingAceTeam;
  let matchWon = false;
  let aceTeamFailed = false;

  if (aceTeam !== null) {
    // Playing A game
    const aceTeamWon = winningTeam === aceTeam;
    if (aceTeamWon && levelAdvance >= 2) {
      // 大跑 or 升2 → win the match
      matchWon = true;
    } else {
      // 升1 or other team won → failure
      aceTeamFailed = true;
      room.aceFailures[aceTeam]++;
      if (room.aceFailures[aceTeam] >= 3) {
        newLevels[aceTeam] = 2; // drop back to 2
        room.aceFailures[aceTeam] = 0;
      }
      // else ace team stays at 14
      if (!aceTeamWon) {
        // Other team leveled up normally
        const losingTeam = (1 - aceTeam) as Team;
        newLevels[losingTeam] = Math.min(room.currentLevel[losingTeam] + levelAdvance, 14);
      }
    }
  } else {
    // Normal game: winning team levels up (cap at 14, but can't win match by just reaching 14)
    newLevels[winningTeam] = Math.min(room.currentLevel[winningTeam] + levelAdvance, 14);
  }

  const gameResult: GameResult = {
    winningTeam,
    levelAdvance,
    newLevels,
    matchWon,
    aceTeam,
    aceTeamFailed,
    aceFailures: [...room.aceFailures] as [number, number],
    finishPositions: room.finishOrder.map((pid, idx) => ({
      playerId: pid,
      position: idx + 1,
      name: room.players.find((p) => p.id === pid)?.name ?? '?',
    })),
  };

  room.gameResult = gameResult;
  room.currentLevel = newLevels;
  room.phase = GamePhase.GAME_END;
  // Reset ready states so players must re-confirm before next game
  room.players.forEach((p) => { p.isReady = false; });
  // Bots auto-ready immediately
  room.players.filter((p) => p.isBot).forEach((p) => { p.isReady = true; });
  updateRoom(room);

  io.to(room.code).emit(SOCKET_EVENTS.GAME_ENDED, { gameResult });
  broadcastRoomUpdate(io, room);
  console.log(`[${room.code}] [Game] ended — team ${winningTeam} wins +${levelAdvance}`);
  // Next game starts when all 4 players click ready again
}

// --------------- Tribute helpers ---------------

/** Returns non-wildcard cards with the maximum game value — eligible for tribute.
 *  Jokers (大王/小王) CAN be tributed; only 万能牌 (red heart level card) is excluded. */
function getEligibleTributeCards(hand: Card[], currentLevel: number): Card[] {
  const eligible = hand.filter((c) => !isWildcard(c, currentLevel));
  if (eligible.length === 0) return [];
  const maxVal = Math.max(...eligible.map((c) => getGameValue(c, currentLevel)));
  return eligible.filter((c) => getGameValue(c, currentLevel) === maxVal);
}

function getEligibleMaxValue(hand: Card[], currentLevel: number): number {
  const eligible = hand.filter((c) => !isWildcard(c, currentLevel));
  if (eligible.length === 0) return -1;
  return Math.max(...eligible.map((c) => getGameValue(c, currentLevel)));
}

function sendNewHands(io: Server, room: Room, sorted: Player[]): void {
  const serverRoom = room as Room & { hands: Record<string, Card[]> };
  sorted.forEach((player) => {
    io.to(room.code).emit(SOCKET_EVENTS.DEAL_CARDS, {
      playerId: player.id,
      cards: serverRoom.hands[player.id] ?? [],
    });
  });
}

function revealThenStart(io: Server, room: Room): void {
  // Broadcast tribute results for 5s so all players can see
  if (room.tributeState) {
    const entries = room.tributeState.entries.map((e) => ({
      fromPlayerId: e.fromPlayerId,
      fromName: room.players.find((p) => p.id === e.fromPlayerId)?.name ?? '',
      toPlayerId: e.toPlayerId,
      toName: room.players.find((p) => p.id === e.toPlayerId)?.name ?? '',
      tributeCard: e.tributeCard,
      returnCard: e.returnCard,
    }));
    io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_REVEAL, { entries });
  }
  setTimeout(() => startNewGameAfterTribute(io, room), 5000);
}

function startNewGameAfterTribute(io: Server, room: Room): void {
  const firstPlayerId = room.tributeState?.firstPlayerId ?? room.gameResult?.finishPositions[0].playerId;
  const firstPlayer = room.players.find((p) => p.id === firstPlayerId);

  room.phase = GamePhase.PLAYING;
  room.currentTurn = (firstPlayer?.seat ?? 0) as PlayerSeat;
  room.tributeState = null;
  room.gameResult = null;
  room.lastPlay = null;
  room.consecutivePasses = 0;
  room.currentRoundPlays = {};
  room.currentRoundPlayOrder = [];
  room.finishOrder = [];

  // Reset ready states
  room.players.forEach((p) => { p.isReady = false; });

  updateRoom(room);
  io.to(room.code).emit(SOCKET_EVENTS.NEW_GAME_STARTING, { firstSeat: room.currentTurn });
  broadcastRoomUpdate(io, room);
  scheduleBotTurn(io, room);

  console.log(`[${room.code}] [Game] new game started`);
}

function startTribute(io: Server, room: Room): void {
  if (!room.gameResult) return;

  const serverRoom = room as Room & { hands: Record<string, Card[]> };
  const fullOrder = room.gameResult.finishPositions.map((fp) => fp.playerId);

  // Deal new hands for next game
  const newHands = dealCards();
  const sorted = [...room.players].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  sorted.forEach((player, i) => {
    serverRoom.hands[player.id] = newHands[i];
    room.handCount[player.id] = newHands[i].length;
  });

  // Reset per-game state (keep players/seats/levels)
  room.lastPlay = null;
  room.consecutivePasses = 0;
  room.currentRoundPlays = {};
  room.currentRoundPlayOrder = [];
  room.finishOrder = [];
  room.tributeState = null;

  const { winningTeam, levelAdvance } = room.gameResult;
  const headId = fullOrder[0];
  const secondId = fullOrder[1];
  const thirdId = fullOrder[2];
  const fourthId = fullOrder[3];
  const currentLevel = room.currentLevel[winningTeam];
  room.currentGameLevel = currentLevel;
  room.playingAceTeam = currentLevel === 14 ? winningTeam : null;

  const emptyTributeState = (firstId: string): TributeState => ({
    entries: [], skipTribute: false, firstPlayerId: firstId,
    isEqualTribute: false, grabPhase: false, pendingReturns: [], grabLog: [],
  });

  if (levelAdvance === 3) {
    // 大跑: skip if 3rd+4th together hold ≥2 big jokers
    const thirdHand = serverRoom.hands[thirdId] ?? [];
    const fourthHand = serverRoom.hands[fourthId] ?? [];
    const bigJokerTotal =
      thirdHand.filter((c) => c.suit === Suit.JOKER && c.rank === 15).length +
      fourthHand.filter((c) => c.suit === Suit.JOKER && c.rank === 15).length;

    if (bigJokerTotal >= 2) {
      const bigJokerHolders = [
        { playerId: thirdId, name: room.players.find(p => p.id === thirdId)?.name ?? '?', count: thirdHand.filter(c => c.suit === Suit.JOKER && c.rank === 15).length },
        { playerId: fourthId, name: room.players.find(p => p.id === fourthId)?.name ?? '?', count: fourthHand.filter(c => c.suit === Suit.JOKER && c.rank === 15).length },
      ].filter(h => h.count > 0);
      room.tributeState = { entries: [], skipTribute: true, firstPlayerId: headId, isEqualTribute: false, grabPhase: false, pendingReturns: [], grabLog: [], bigJokerHolders };
      room.phase = GamePhase.TRIBUTE_RETURN;
      updateRoom(room);
      broadcastRoomUpdate(io, room);
      sendNewHands(io, room, sorted);
      io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
      scheduleBotTribute(io, room);
      setTimeout(() => startNewGameAfterTribute(io, room), 5000);
      return;
    }

    // Double tribute: 3rd→1st, 4th→2nd
    const thirdMaxVal = getEligibleMaxValue(thirdHand, currentLevel);
    const fourthMaxVal = getEligibleMaxValue(fourthHand, currentLevel);
    const isEqual = thirdMaxVal >= 0 && fourthMaxVal >= 0 && thirdMaxVal === fourthMaxVal;

    // firstPlayerId: equal→determined after grab; unequal→giver of bigger card
    const firstPlayerId = isEqual ? fourthId : (thirdMaxVal > fourthMaxVal ? thirdId : fourthId);

    const entries: TributeEntry[] = [
      { fromPlayerId: thirdId, toPlayerId: headId, tributeCard: null, tributeGiven: thirdMaxVal < 0, returnCard: null, done: false },
      { fromPlayerId: fourthId, toPlayerId: secondId, tributeCard: null, tributeGiven: fourthMaxVal < 0, returnCard: null, done: false },
    ];

    room.tributeState = { entries, skipTribute: false, firstPlayerId, isEqualTribute: isEqual, grabPhase: false, pendingReturns: [], grabLog: [] };
    room.phase = GamePhase.TRIBUTE_RETURN;
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    sendNewHands(io, room, sorted);
    io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
    scheduleBotTribute(io, room);

    // If both have no eligible cards (all wildcards), skip tribute entirely
    if (thirdMaxVal < 0 && fourthMaxVal < 0) {
      setTimeout(() => startNewGameAfterTribute(io, room), 1000);
    }

  } else {
    // 升1 or 升2: 末游 (4th) gives to 头游 (1st); 4th starts
    const fourthHand = serverRoom.hands[fourthId] ?? [];
    const fourthMaxVal = getEligibleMaxValue(fourthHand, currentLevel);

    // Skip tribute if giver holds 2+ big jokers (抗贡)
    const fourthBigJokers = fourthHand.filter(c => c.suit === Suit.JOKER && c.rank === 15).length;
    if (fourthBigJokers >= 2) {
      const bigJokerHolders = [
        { playerId: fourthId, name: room.players.find(p => p.id === fourthId)?.name ?? '?', count: fourthBigJokers },
      ];
      room.tributeState = { entries: [], skipTribute: true, firstPlayerId: fourthId, isEqualTribute: false, grabPhase: false, pendingReturns: [], grabLog: [], bigJokerHolders };
      room.phase = GamePhase.TRIBUTE_RETURN;
      updateRoom(room);
      broadcastRoomUpdate(io, room);
      sendNewHands(io, room, sorted);
      io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
      scheduleBotTribute(io, room);
      setTimeout(() => startNewGameAfterTribute(io, room), 5000);
      return;
    }

    const entries: TributeEntry[] = [
      { fromPlayerId: fourthId, toPlayerId: headId, tributeCard: null, tributeGiven: fourthMaxVal < 0, returnCard: null, done: false },
    ];

    room.tributeState = { entries, skipTribute: false, firstPlayerId: fourthId, isEqualTribute: false, grabPhase: false, pendingReturns: [], grabLog: [] };
    room.phase = GamePhase.TRIBUTE_RETURN;
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    sendNewHands(io, room, sorted);
    io.to(room.code).emit(SOCKET_EVENTS.TRIBUTE_STATE, { tributeState: room.tributeState });
    scheduleBotTribute(io, room);

    if (fourthMaxVal < 0) {
      setTimeout(() => startNewGameAfterTribute(io, room), 1000);
    }
  }
}

// --------------- Disconnect / leave ---------------

// roomCode -> Set of playerIds who actively left (cannot rejoin)
const activelyLeftPlayers = new Map<string, Set<string>>();

/** Players who are human, haven't actively left, and are not the one currently leaving */
function getActiveHumans(room: Room, excludePlayerId?: string): Player[] {
  const leftSet = activelyLeftPlayers.get(room.code) ?? new Set<string>();
  return room.players.filter(
    (p) => !p.isBot && !leftSet.has(p.id) && p.id !== excludePlayerId,
  );
}

/** Transfer host to first non-bot player (by seat order) if current host is leaving */
function transferHostIfNeeded(room: Room, departingPlayerId: string): void {
  if (room.hostId !== departingPlayerId) return;
  const candidate = room.players
    .filter((p) => !p.isBot && p.id !== departingPlayerId)
    .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99))[0];
  if (candidate) {
    room.hostId = candidate.id;
    console.log(`[${room.code}] [Room] host transferred to "${candidate.name}"`);
  }
}

function scheduleRoomCleanup(io: Server, room: Room): void {
  const allHumansDisconnected = room.players
    .filter((p) => !p.isBot)
    .every((p) => (room.disconnectedPlayerIds ?? []).includes(p.id));

  if (!allHumansDisconnected) {
    // Someone is still connected — cancel any pending cleanup
    const t = roomCleanupTimers.get(room.code);
    if (t) { clearTimeout(t); roomCleanupTimers.delete(room.code); }
    return;
  }

  if (roomCleanupTimers.has(room.code)) return; // already scheduled
  const timer = setTimeout(() => {
    roomCleanupTimers.delete(room.code);
    const r = getRoomByCode(room.code);
    if (!r) return;
    const stillAllGone = r.players
      .filter((p) => !p.isBot)
      .every((p) => (r.disconnectedPlayerIds ?? []).includes(p.id));
    if (stillAllGone) {
      activelyLeftPlayers.delete(r.code);
      deleteRoom(r.code);
      console.log(`[${r.code}] [Room] deleted — all players offline for 10 minutes`);
    }
  }, 10 * 60 * 1000);
  roomCleanupTimers.set(room.code, timer);
  console.log(`[${room.code}] [Room] all players offline, will delete in 10 minutes`);
}

/** Active leave: player clicked "离开" (confirmed). Cannot rejoin. */
function handleActiveLeave(io: Server, socket: Socket): void {
  const info = unregisterSocket(socket.id);
  if (!info) return;

  const { roomCode, playerId } = info;
  const room = getRoomByCode(roomCode);
  if (!room) return;

  const player = room.players.find((p) => p.id === playerId);
  socket.leave(roomCode);

  if (!player || player.isBot) return;

  console.log(`[${room.code}] [Room] "${player.name}" actively left`);

  if (room.phase === GamePhase.WAITING) {
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.filter((p) => !p.isBot).length === 0) {
      deleteRoom(room.code);
      console.log(`[${room.code}] [Room] deleted — no players remaining`);
      return;
    }
    transferHostIfNeeded(room, playerId);
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    return;
  }

  // Game phase: check if any other active humans remain
  const others = getActiveHumans(room, playerId);
  if (others.length === 0) {
    activelyLeftPlayers.delete(roomCode);
    deleteRoom(roomCode);
    console.log(`[${room.code}] [Room] deleted — no active players remaining`);
    return;
  }

  // Mark as actively left — cannot rejoin
  let leftSet = activelyLeftPlayers.get(roomCode);
  if (!leftSet) { leftSet = new Set(); activelyLeftPlayers.set(roomCode, leftSet); }
  leftSet.add(playerId);

  // Cancel any pending reconnect grace timer
  const key = `${roomCode}:${playerId}`;
  const existing = disconnectTimers.get(key);
  if (existing) { clearTimeout(existing); disconnectTimers.delete(key); }

  // Enter managed immediately
  if (!(room.managedPlayerIds ?? []).includes(playerId)) {
    room.managedPlayerIds = [...(room.managedPlayerIds ?? []), playerId];
  }
  if (!(room.disconnectedPlayerIds ?? []).includes(playerId)) {
    room.disconnectedPlayerIds = [...(room.disconnectedPlayerIds ?? []), playerId];
  }

  updateRoom(room);
  broadcastRoomUpdate(io, room);
  scheduleRoomCleanup(io, room);
  scheduleBotDiceRoll(io, room);
  scheduleBotTurn(io, room);
  scheduleBotTribute(io, room);
}

/** Passive disconnect: network drop / browser close. Can rejoin within 10 minutes. */
function handlePassiveLeave(io: Server, socket: Socket): void {
  const info = unregisterSocket(socket.id);
  if (!info) return;

  const { roomCode, playerId } = info;
  const room = getRoomByCode(roomCode);
  if (!room) return;

  const player = room.players.find((p) => p.id === playerId);
  socket.leave(roomCode);

  if (!player || player.isBot) {
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) { deleteRoom(room.code); return; }
    updateRoom(room); broadcastRoomUpdate(io, room);
    return;
  }

  console.log(`[${room.code}] [Room] "${player.name}" disconnected`);

  if (room.phase === GamePhase.WAITING) {
    // Waiting room: kick immediately
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.filter((p) => !p.isBot).length === 0) {
      deleteRoom(room.code);
      return;
    }
    transferHostIfNeeded(room, playerId);
    updateRoom(room);
    broadcastRoomUpdate(io, room);
    return;
  }

  // Game: mark disconnected, allow rejoin
  const key = `${roomCode}:${playerId}`;
  const existing = disconnectTimers.get(key);
  if (existing) clearTimeout(existing);

  if (!(room.disconnectedPlayerIds ?? []).includes(playerId)) {
    room.disconnectedPlayerIds = [...(room.disconnectedPlayerIds ?? []), playerId];
  }
  updateRoom(room);
  broadcastRoomUpdate(io, room);
  scheduleRoomCleanup(io, room);

  // After 30s with no rejoin: enter 托管
  const timer = setTimeout(() => {
    const r = getRoomByCode(roomCode);
    disconnectTimers.delete(key);
    if (!r || r.phase === GamePhase.WAITING) return;
    if (!(r.managedPlayerIds ?? []).includes(playerId)) {
      r.managedPlayerIds = [...(r.managedPlayerIds ?? []), playerId];
    }
    updateRoom(r);
    broadcastRoomUpdate(io, r);
    scheduleBotDiceRoll(io, r);
    scheduleBotTurn(io, r);
    scheduleBotTribute(io, r);
    console.log(`[${roomCode}] [Room] "${player.name}" entered 托管 after disconnect`);
  }, 30000);
  disconnectTimers.set(key, timer);
}
