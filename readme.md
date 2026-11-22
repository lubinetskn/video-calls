# Video Calls

A fullstack application for one-to-one video conversations, rebuilt in 2026 by Konstantin Lubinets. Create a room, share a link, and talk face to face with realtime chat.

## Stack

React 19 · TypeScript · Vite 8 · Node.js 22 · Fastify 5 · Socket.IO 4 · WebRTC · SQLite · Zod · Playwright

This edition replaces the legacy client and its external backend dependency. The original implementation remains in Git history. The new application uses guest display names and capability-based room links rather than accounts.

## Local development

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Create a room, then open its invitation link in another browser or an incognito window. Both participants must allow camera and microphone access. A room admits two participants; a third receives an explicit error.

Requires Node.js >=22.13. Node's built-in SQLite API is experimental in Node 22 and can print a warning.

## Production build / local demo

```sh
npm run build
npm start
```

Open http://127.0.0.1:8080. Fastify serves the compiled frontend, REST endpoints, and Socket.IO from the same origin. No database service or account is needed. SQLite data is stored in `data/calls.sqlite`.

Copy `.env.example` to `.env` for optional configuration. Restart the server after changes.

## What works

- Random, unguessable room links with 24-hour admission expiry.
- Two-person calls with peer-to-peer audio/video and mute/camera controls.
- Socket.IO signaling with room membership checks and bounded payloads.
- Realtime chat stored in SQLite; the last 100 messages load on rejoin.
- Camera permission, full-room, invalid-room, and connection error states.
- Explicit rejoin after a lost server connection; peer departure frees the seat.
- Responsive layout and keyboard-accessible controls.

## Architecture and tradeoffs

`apps/web` owns media permissions, React UI, RTCPeerConnection lifecycle, and chat. `apps/server` owns room admission, message persistence, validation, rate limits, and signaling. Media does not travel through the application server. A TURN relay may carry encrypted WebRTC media when direct connectivity fails.

The room URL is the access credential. Anyone holding it can enter while a seat is available and read stored chat. Display names are not verified identities. There is no account authentication, recording, moderation, or end-to-end encryption for stored chat. Signaling/chat require HTTPS in a public deployment. Do not use this demo for sensitive conversations.

Rooms stop accepting joins/messages after 24 hours. Expired rooms and messages are physically removed when another room is created, not by a guaranteed scheduled purge. Active media is not forcibly terminated at expiry. Participant presence is in memory: run a single server instance; restarting disconnects calls but preserves rooms/messages.

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

API/Socket.IO integration tests cover room admission, capacity, messaging, signaling and rate limits. Browser tests use synthetic camera/microphone devices to connect two independent browser contexts, receive remote video, exchange chat, mute, reject a third participant, and leave. This does not replace testing across real networks/devices.

## Deployment path

The included Dockerfile runs the same application. Expose port 8080 and mount persistent storage at `/data`; set `PUBLIC_ORIGIN` to the exact external HTTPS origin and `HOST=0.0.0.0`. The platform must support long-lived WebSocket connections. SQLite needs a writable volume; an ephemeral free instance loses chat and rooms on redeploy.

For a free proof-of-concept use a container host with a free tier or a temporary HTTPS tunnel to the local server. No public demo has been provisioned as part of this source change. Free-tier availability and sleep limits depend on the provider. Do not expose the server without setting `PUBLIC_ORIGIN`.

For reliable calls across mobile/corporate networks, configure `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL`. Without TURN some peers cannot connect. Static TURN credentials are exposed to room participants: use restricted demo credentials, and add a short-lived credential service before a wider public release. A free TURN quota is not guaranteed.

Before scaling: move persistence to PostgreSQL, add a shared presence/signaling adapter, authenticated users if needed, abuse protection, and a defined data-retention job.

## Author

[Konstantin Lubinets](https://www.linkedin.com/in/konstantin-lubinets/) · [GitHub](https://github.com/lubinetskn)

MIT license. See `licence.md`.
