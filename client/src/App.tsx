import React, { useState, useEffect, useRef } from 'react';
import { SOCKET_EVENTS, Room, Card } from '@eggbomb/shared';
import socket from './socket';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import GamePage from './pages/GamePage';

type Page = 'lobby' | 'room' | 'game';

interface AppState {
  page: Page;
  playerName: string;
  playerId: string | null;
  roomCode: string | null;
  room: Room | null;
  hand: Card[];
  currentLevel: number;
}

const initialState: AppState = {
  page: 'lobby',
  playerName: '',
  playerId: null,
  roomCode: null,
  room: null,
  hand: [],
  currentLevel: 2,
};

const SESSION_KEY = 'eggbomb_session';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(initialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      const cur = stateRef.current;
      if (cur.playerId && cur.roomCode) {
        // Socket reconnected mid-session — rejoin
        socket.emit(SOCKET_EVENTS.REJOIN, { roomCode: cur.roomCode, playerId: cur.playerId });
      } else {
        // Fresh page load — check localStorage
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) {
          try {
            const { playerId, roomCode } = JSON.parse(saved);
            // Set a short timeout: if REJOIN_SUCCESS doesn't arrive, clear stale session
            const failTimer = setTimeout(() => localStorage.removeItem(SESSION_KEY), 3000);
            socket.once(SOCKET_EVENTS.REJOIN_SUCCESS, () => clearTimeout(failTimer));
            socket.emit(SOCKET_EVENTS.REJOIN, { roomCode, playerId });
          } catch { localStorage.removeItem(SESSION_KEY); }
        }
      }
    });

    socket.on(SOCKET_EVENTS.REJOIN_SUCCESS, ({ room, hand, playerId }: { room: Room; hand: Card[]; playerId: string }) => {
      const cur = stateRef.current;
      // If user has already explicitly joined/created a different room, ignore stale rejoin
      if (cur.playerId !== null && cur.playerId !== playerId) return;
      setState((prev) => ({
        ...prev,
        room,
        hand,
        playerId,
        roomCode: room.code,
        currentLevel: room.currentGameLevel ?? 2,
        page: room.phase === 'WAITING' ? 'room' : 'game',
      }));
    });

    socket.on('room_created', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId, roomCode }));
      setState((prev) => ({ ...prev, page: 'room', playerId, roomCode }));
    });

    socket.on('room_joined', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId, roomCode }));
      setState((prev) => ({ ...prev, page: 'room', playerId, roomCode }));
    });

    socket.on(SOCKET_EVENTS.ROOM_UPDATE, ({ room }: { room: Room }) => {
      setState((prev) => ({
        ...prev,
        room,
        currentLevel: room.currentGameLevel ?? prev.currentLevel,
        ...(prev.page === 'game' && room.phase === 'WAITING' ? { page: 'room' } : {}),
      }));
    });

    socket.on(SOCKET_EVENTS.GAME_STARTED, ({ room }: { room: Room }) => {
      setState((prev) => ({ ...prev, room, page: 'game', currentLevel: room.currentGameLevel ?? prev.currentLevel }));
    });

    socket.on(SOCKET_EVENTS.DEAL_CARDS, ({ playerId, cards }: { playerId: string; cards: Card[] }) => {
      setState((prev) => {
        if (prev.playerId !== playerId) return prev;
        const level = prev.room?.currentGameLevel ?? 2;
        return { ...prev, hand: cards, currentLevel: level };
      });
    });

    socket.on(SOCKET_EVENTS.GAME_ENDED, () => {
      // Stay on game page to see result, handled inside GamePage
    });

    socket.on(SOCKET_EVENTS.NEW_GAME_STARTING, () => {
      // Hand was already updated via DEAL_CARDS during tribute phase — don't clear it
      setState((prev) => ({ ...prev, page: 'game' }));
    });

    socket.on(SOCKET_EVENTS.ERROR, ({ message }: { message: string }) => {
      alert(`错误: ${message}`);
    });

    return () => {
      socket.off('connect');
      socket.off('room_created');
      socket.off('room_joined');
      socket.off(SOCKET_EVENTS.REJOIN_SUCCESS);
      socket.off(SOCKET_EVENTS.ROOM_UPDATE);
      socket.off(SOCKET_EVENTS.GAME_STARTED);
      socket.off(SOCKET_EVENTS.DEAL_CARDS);
      socket.off(SOCKET_EVENTS.GAME_ENDED);
      socket.off(SOCKET_EVENTS.NEW_GAME_STARTING);
      socket.off(SOCKET_EVENTS.ERROR);
      socket.disconnect();
    };
  }, []);

  const goToLobby = () => {
    socket.emit(SOCKET_EVENTS.LEAVE_ROOM);
    localStorage.removeItem(SESSION_KEY);
    setState(initialState);
  };

  if (state.page === 'lobby') {
    return (
      <LobbyPage
        playerName={state.playerName}
        onPlayerNameChange={(name) => setState((prev) => ({ ...prev, playerName: name }))}
      />
    );
  }

  if (state.page === 'room') {
    if (!state.room || !state.playerId || !state.roomCode) {
      return <div style={{ color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>正在进入房间...</div>;
    }
    return <RoomPage room={state.room} playerId={state.playerId} onLeave={goToLobby} />;
  }

  if (state.page === 'game') {
    if (!state.room || !state.playerId) {
      return <div style={{ color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>加载游戏中...</div>;
    }
    return (
      <GamePage
        room={state.room}
        playerId={state.playerId}
        hand={state.hand}
        currentLevel={state.currentLevel}
        onLeave={goToLobby}
      />
    );
  }

  return null;
};

export default App;
