# Stumble Arena 3D

A browser party-knockout game built with Three.js and cannon-es. It supports a fully local bot mode and an authoritative WebSocket match mode for Wasmer Edge.

## Local game

The Vite client provides the game UI, 3D courses, touch controls, bots, event selection, and local simulation. The offline event menu includes Original, Grand Prix, Showdown, Duel, Clash, Turbo, Blitz, Teams, and Time Trial.

## Online mode

Online mode uses the same client but sends only input frames to the authority. The authority owns:

- Room creation and queue membership
- Room capacity, capped at 32 players
- Matching players into the same available waiting room
- The countdown, which begins when a room reaches two players
- Player positions, velocities, jumps, dives, stumbles, hazards, finish order, and qualification
- Round transitions and final winner selection
- WebSocket snapshots sent back to every player in a room

A player who queues alone creates a waiting room. A second player using the same authority and event joins that room. When a room reaches 32 players, the next queued player is assigned to a new room.

The browser connects to `/ws` on the same origin. During local development, Vite proxies `/ws` to the authority on port `8787`. On Wasmer, the Node-compatible authority serves both `dist/` and `/ws` from the same app.

## Wasmer layout

- `app.yaml` — Wasmer Edge app configuration; replace the owner placeholder
- `wasmer.toml` — local package manifest using Wasmer Edge.js/QuickJS to run the Node-compatible authority
- `server/index.js` — HTTP/static server and WebSocket upgrade endpoint
- `server/RoomManager.js` — room allocator, countdowns, authoritative simulation, and snapshots
- `src/game/OnlineMatch.js` — client-side renderer for authoritative snapshots
- `src/game/NetClient.js` — browser WebSocket transport

The current Wasmer Node.js Edge runtime is documented as beta, and this project uses the `wasmer/edgejs-quickjs` runtime declared in `wasmer.toml`. Wasmer Edge documents WebSocket gateway support. The room state is intentionally in memory: a single authority instance owns each room. A multi-instance production deployment would need a shared room directory or routing strategy before rooms could span instances.

To deploy, build the Vite client, replace the Wasmer username placeholders in `app.yaml` and `wasmer.toml`, then deploy the root package with the Wasmer app workflow. Verify the deployed `/healthz` endpoint and connect through the deployed page so the browser uses the same-origin WebSocket endpoint.

## Controls

- **WASD / Arrow Keys** — Move
- **Space** — Jump; press again in mid-air to dive
- **1** — Punch
- **2** — Slide kick
- **3** — Drop a banana peel
- **E** — Use the local ability
- **On-screen joystick and action buttons** — Touch, mouse, and pen input

## Course set

- **Spin Go Round** — Rotating bumpers, ice, and moving gates
- **Cannon Climb** — Conveyors and moving machinery
- **Tile Fall** — Disappearing-tile path
- **Honey Drop** — Falling-floor survival
- **Laser Tracer** — Rotating laser beams
- **Block Dash** — Final obstacle gauntlet
- **Coin Quest** — Collection scoring round

## Project structure

- `index.html` — Offline event picker and online queue controls
- `src/main.js` — UI, controls, and match selection
- `src/game/OfflineMatch.js` — Local event flow and bot simulation
- `src/game/OnlineMatch.js` — Authoritative snapshot renderer
- `src/game/NetClient.js` — Browser WebSocket transport
- `src/game/FallbackRenderer.js` — Preview fallback when WebGL is unavailable
- `src/game/LevelFactory.js` — Course construction
- `src/game/PlayerController.js` — Local physics and abilities
- `src/game/obstacles.js` — Hazards, lasers, coins, tiles, and bumpers
- `src/game/constants.js` — Event, map, and physics definitions
- `vite.config.js` — Client dev server and local WebSocket proxy
