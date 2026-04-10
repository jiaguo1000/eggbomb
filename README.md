# eggbomb

Online 掼蛋 (Guan Dan) card game — create a room, invite friends, and play instantly in the browser.

## Features

- Real-time multiplayer via WebSocket (Socket.io)
- Full 掼蛋 rules: level progression 2–A, tribute/return, 抗贡, wildcards, all hand types
- Bot players powered by Monte Carlo Tree Search (MCTS) — fills empty seats or can be added by the host; two difficulty levels (easy / medium)
- Autopilot (托管) mode — delegate your turn to the MCTS bot
- Dice roll to decide first player, with tie re-roll
- Disconnect/reconnect: players stay in the game for 30s after disconnect, then enter autopilot
- Host-selectable starting level (2–A)
- Hint button suggests the smallest valid play

## Tech Stack

- **Frontend**: React + TypeScript + Vite — responsive layout, optimized for both desktop and mobile landscape
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

## Deployment

Designed to run on a single VPS with Nginx and PM2.

**1. Build**

```bash
# Set client env before building
echo "VITE_SERVER_URL=https://your-domain.com" > client/.env.production

npm run build
```

**2. Serve with PM2**

```bash
npm start   # or: pm2 start npm --name eggbomb -- start
```

**3. Nginx config (single domain)**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Static frontend
    location / {
        root /path/to/eggbomb/client/dist;
        try_files $uri /index.html;
    }

    # WebSocket + API proxy
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /stats {
        proxy_pass http://localhost:3001;
    }
}
```

Add SSL with `certbot --nginx` for HTTPS.
