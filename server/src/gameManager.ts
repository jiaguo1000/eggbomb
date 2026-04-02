import { Room, GamePhase, Card } from '@eggbomb/shared';

// Extend Room for server-side use
export type ServerRoom = Room & { hands: Record<string, Card[]> };

// In-memory store: roomCode -> Room
const rooms = new Map<string, Room>();

// socketId -> roomCode mapping for disconnect cleanup
const socketRoomMap = new Map<string, string>();

// socketId -> playerId mapping
const socketPlayerMap = new Map<string, string>();

// --------------- Room CRUD ---------------

export function getRoomByCode(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function getRoomById(id: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.id === id) return room;
  }
  return undefined;
}

export function createRoom(room: Room): void {
  rooms.set(room.code, room);
}

export function updateRoom(room: Room): void {
  rooms.set(room.code, room);
}

export function deleteRoom(code: string): void {
  rooms.delete(code.toUpperCase());
}

export function getAllRooms(): Room[] {
  return Array.from(rooms.values());
}

// --------------- Socket <-> Player mapping ---------------

export function registerSocket(socketId: string, roomCode: string, playerId: string): void {
  socketRoomMap.set(socketId, roomCode);
  socketPlayerMap.set(socketId, playerId);
}

export function unregisterSocket(socketId: string): { roomCode: string; playerId: string } | null {
  const roomCode = socketRoomMap.get(socketId);
  const playerId = socketPlayerMap.get(socketId);
  socketRoomMap.delete(socketId);
  socketPlayerMap.delete(socketId);
  if (roomCode && playerId) return { roomCode, playerId };
  return null;
}

export function getRoomCodeBySocket(socketId: string): string | undefined {
  return socketRoomMap.get(socketId);
}

export function getPlayerIdBySocket(socketId: string): string | undefined {
  return socketPlayerMap.get(socketId);
}

// --------------- Game helpers ---------------

export function isRoomReady(room: Room): boolean {
  return (
    room.players.length === 4 &&
    room.players.every((p) => p.isReady) &&
    room.players.every((p) => p.seat !== null)
  );
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

export function createEmptyRoom(id: string, code: string, hostId: string): ServerRoom {
  return {
    id,
    code,
    hostId,
    players: [],
    phase: GamePhase.WAITING,
    currentLevel: [2, 2], // both teams start at level 2
    currentTurn: null,
    lastPlay: null,
    consecutivePasses: 0,
    finishOrder: [],
    handCount: {},
    currentRoundPlays: {},
    currentRoundPlayOrder: [],
    gameResult: null,
    tributeState: null,
    diceRolls: {},
    currentGameLevel: 2,
    playingAceTeam: null,
    aceFailures: [0, 0],
    startLevel: 2,
    managedPlayerIds: [],
    disconnectedPlayerIds: [],
    diceTiedIds: [],
    isRerollRound: false,
    hands: {},
  };
}
