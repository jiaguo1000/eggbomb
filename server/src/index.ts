import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { registerRoomHandlers } from './roomHandlers';
import { getAllRooms } from './gameManager';

const PORT = process.env.PORT || 3001;
export const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 10;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', game: '掼蛋 (Guan Dan)' });
});

// Stats
app.get('/stats', (_req, res) => {
  const rooms = getAllRooms();
  const playerCount = rooms.reduce((sum, r) => sum + r.players.length, 0);
  res.json({ roomCount: rooms.length, playerCount, maxRooms: MAX_ROOMS });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,   // wait 60s for pong before declaring disconnect
  pingInterval: 25000,  // send ping every 25s
});

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  registerRoomHandlers(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Client disconnected: ${socket.id} — reason: ${reason}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n🥚 掼蛋 (Guan Dan) server running on http://localhost:${PORT}\n`);
});
