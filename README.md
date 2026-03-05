# Watch Party

A real-time YouTube watch party app where multiple users watch the same video in sync.

Users can create/join rooms, get role-based permissions (Host, Moderator, Participant), control synchronized playback, and chat live.

## Live Deployment

- Frontend: [https://watch-party-iytq.onrender.com](https://watch-party-iytq.onrender.com)
- Backend: [https://watch-party-backend-4msr.onrender.com](https://watch-party-backend-4msr.onrender.com)
- Backend health: [https://watch-party-backend-4msr.onrender.com/health](https://watch-party-backend-4msr.onrender.com/health)

## Core Features

- Room-based watch parties with shareable room code/link
- Real-time sync of:
  - play/pause
  - seek
  - video change
- Role-based access control:
  - Host: full control, role assignment, remove participant, transfer host
  - Moderator: playback + video control
  - Participant: watch/chat only
- Participant list with current roles
- Basic room chat
- YouTube search and watch-from-results flow

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Real-time: Socket.IO
- Video: YouTube IFrame Player (`react-youtube`)

## Architecture Overview

1. Client joins a room using `join_room`.
2. Server creates room (first user becomes Host) or adds participant.
3. Playback actions (`play`, `pause`, `seek`, `change_video`) are permission-checked on backend.
4. Backend updates room state and broadcasts `sync_state` to room.
5. Clients apply sync to YouTube player.
6. Role and participant updates are broadcast (`role_assigned`, `participant_removed`, `user_joined`, `user_left`).
7. Chat messages use `send_message` / `message_received`.

Room state is kept in-memory using `Room` + `RoomManager` classes.

## Project Structure

```
watch-party/
  backend/
    src/
      server.ts
      rooms/
        Room.ts
        RoomManager.ts
        Participant.ts
  frontend/
    src/
      App.tsx
      socket.ts
```

## Environment Variables

### Backend (`backend/.env`)

Copy `backend/.env.example` to `backend/.env`.

```env
PORT=5000
APP_VERSION=1.0.0
CORS_ORIGIN=http://localhost:5173,https://watch-party-iytq.onrender.com
```

Notes:
- `CORS_ORIGIN` supports comma-separated origins.
- Use origins without trailing slash.

### Frontend (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env`.

```env
VITE_SOCKET_URL=http://localhost:5000
VITE_API_URL=http://localhost:5000
```

For production frontend deployment:

```env
VITE_SOCKET_URL=https://watch-party-backend-4msr.onrender.com
VITE_API_URL=https://watch-party-backend-4msr.onrender.com
```

## Local Development

### 1) Start backend

```bash
cd backend
npm install
npm run dev
```

Backend runs on `http://localhost:5000`.

### 2) Start frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Build Commands

### Backend

```bash
cd backend
npm run build
npm start
```

### Frontend

```bash
cd frontend
npm run build
npm run preview
```

## Main WebSocket Events

Client -> Server:
- `join_room`
- `leave_room`
- `play`
- `pause`
- `seek`
- `change_video`
- `progress`
- `request_sync`
- `assign_role`
- `remove_participant`
- `transfer_host`
- `send_message`

Server -> Client:
- `joined_room`
- `sync_state`
- `user_joined`
- `user_left`
- `role_assigned`
- `participant_removed`
- `message_received`
- `error_message`

## Deployment (Render)

### Backend Web Service

- Root Directory: `backend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Environment:
  - `APP_VERSION=1.0.0`
  - `CORS_ORIGIN=https://watch-party-iytq.onrender.com,http://localhost:5173`

### Frontend Static Site

- Root Directory: `frontend`
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Environment:
  - `VITE_SOCKET_URL=https://watch-party-backend-4msr.onrender.com`
  - `VITE_API_URL=https://watch-party-backend-4msr.onrender.com`

After changing env vars on Render, redeploy the service.

## Troubleshooting

### CORS errors on Socket.IO polling

If you see:

- `No 'Access-Control-Allow-Origin' header is present`
- `net::ERR_FAILED 200 (OK)`

Check:
- Backend `CORS_ORIGIN` includes your frontend origin exactly
- Origins are comma-separated and have no trailing slash
- Backend has been redeployed after env changes

### YouTube video not loading

Try another video. Some videos are restricted by YouTube embed policy.

## License

MIT
