# eggbomb

Online 掼蛋 (Guan Dan) card game — create a room, invite friends, and play instantly in the browser.

## Features

- Real-time multiplayer via WebSocket (Socket.io)
- Full 掼蛋 rules: level progression 2–A, tribute/return, 抗贡, wildcards, all hand types
- Bot players with AI logic (fills empty seats)
- Autopilot (托管) mode — delegate your turn to the bot
- Dice roll to decide first player, with tie re-roll
- Disconnect/reconnect: players stay in the game for 30s after disconnect, then enter autopilot
- Host-selectable starting level (2–A)
- Hint button suggests the smallest valid play

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + Socket.io
- **Shared**: TypeScript types and game logic shared between client and server
- **Monorepo**: npm workspaces

## Project Structure

```
eggbomb/
├── client/      # React frontend (Vite)
├── server/      # Node.js game server
└── shared/      # Shared types and game logic
```

## Getting Started

**Prerequisites**: Node.js 18+

```bash
# Install all dependencies
npm install

# Start development (client + server + shared watch)
npm run dev
```

Client runs at `http://localhost:5173`, server at `http://localhost:3001`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start everything in dev mode with hot reload |
| `npm run build` | Build all packages for production |
| `npm start` | Start the production server |

To build and run in production:

```bash
npm run build
npm start
```

Then serve `client/dist/` with a static file server or reverse proxy pointing to the same origin as the backend.
