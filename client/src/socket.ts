import { io, Socket } from 'socket.io-client';

// In dev: connect via Vite proxy (no URL needed)
// In production: connect directly to VPS via VITE_SERVER_URL env var
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '';

const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
});

export default socket;
