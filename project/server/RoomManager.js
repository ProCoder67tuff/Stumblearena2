const MAX_PLAYERS = 32;
const COUNTDOWN_SECONDS = 10;
const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;
const GRAVITY = -18;
const TOP_SPEED = 8.6;
const JUMP_VELOCITY = 9;
const FINISH_Z = -120;
const ROUND_DEFINITIONS = [
  { mapId: 'spin-go-round', name: 'Spin Go Round', mode: 'race', duration: 80 },
  { mapId: 'cannon-climb', name: 'Cannon Climb', mode: 'race', duration: 78 },
  { mapId: 'laser-tracer', name: 'Laser Tracer', mode: 'elimination', duration: 65 },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const send = (ws, packet) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(packet));
};

function spawnPosition(index) {
  return {
    x: ((index % 8) - 3.5) * 1.05,
    y: 1,
    z: 13 + Math.floor(index / 8) * 2,
  };
}

function makePlayer(id, index, name) {
  const position = spawnPosition(index);
  return {
    id,
    name: String(name || `Stumbler ${id}`).slice(0, 18),
    team: id % 2 ? 'red' : 'blue',
    x: position.x,
    y: position.y,
    z: position.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    grounded: false,
    diveUsed: false,
    state: 'normal',
    stateTimer: 0,
    hazardCooldown: 0,
    actionCooldown: 0,
    finished: false,
    eliminated: false,
    finishPlace: 0,
    input: { x: 0, y: 0, jumpPressed: false, punchPressed: false, kickPressed: false, bananaPressed: false, abilityPressed: false },
    lastInputTick: 0,
    score: 0,
    ws: null,
  };
}

export class AuthorityRoom {
  constructor(id, mode = 'original', onEmpty = () => {}) {
    this.id = id;
    this.mode = mode;
    this.onEmpty = onEmpty;
    this.players = new Map();
    this.phase = 'waiting';
    this.countdown = 0;
    this.roundIndex = 0;
    this.roundTime = 0;
    this.elapsed = 0;
    this.tick = 0;
    this.snapshotTick = 0;
    this.qualified = [];
    this.roundPlayers = [];
    this.bananas = [];
    this.intermission = 0;
    this.disposalTimer = 0;
  }

  get size() {
    return this.players.size;
  }

  get available() {
    return this.size < MAX_PLAYERS && (this.phase === 'waiting' || this.phase === 'countdown');
  }

  addPlayer(ws, name) {
    const id = this.nextPlayerId();
    const player = makePlayer(id, this.players.size, name);
    player.ws = ws;
    this.players.set(id, player);
    ws.roomId = this.id;
    ws.playerId = id;
    send(ws, { type: 'room-state', roomId: this.id, playerId: id, phase: this.phase, roomSize: this.size, maxPlayers: MAX_PLAYERS, countdown: this.countdown });
    this.broadcastRoomState();
    if (this.phase === 'waiting' && this.size >= 2) this.beginCountdown();
    return player;
  }

  nextPlayerId() {
    let id = 1;
    while (this.players.has(id)) id += 1;
    return id;
  }

  removePlayer(ws) {
    const player = this.players.get(ws.playerId);
    if (!player) return;
    this.players.delete(player.id);
    ws.roomId = null;
    ws.playerId = null;
    if (this.size === 0) {
      this.onEmpty(this);
      return;
    }
    if (this.phase === 'countdown' && this.size < 2) {
      this.phase = 'waiting';
      this.countdown = 0;
    }
    this.broadcastRoomState();
  }

  beginCountdown() {
    if (this.phase !== 'waiting' || this.size < 2) return;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.broadcastRoomState();
  }

  startMatch() {
    if (this.size < 2 || this.phase === 'playing') return;
    this.phase = 'playing';
    this.roundIndex = 0;
    this.roundPlayers = [...this.players.keys()];
    this.beginRound();
    this.broadcast({ type: 'match-start', roomId: this.id, totalRounds: ROUND_DEFINITIONS.length, map: this.currentRound() });
  }

  currentRound() {
    return ROUND_DEFINITIONS[Math.min(this.roundIndex, ROUND_DEFINITIONS.length - 1)];
  }

  beginRound() {
    const definition = this.currentRound();
    this.roundTime = definition.duration;
    this.elapsed = 0;
    this.qualified = [];
    this.bananas = [];
    this.roundPlayers.forEach((id, index) => {
      const player = this.players.get(id);
      if (!player) return;
      const position = spawnPosition(index);
      Object.assign(player, {
        x: position.x,
        y: position.y,
        z: position.z,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: false,
        diveUsed: false,
        state: 'normal',
        stateTimer: 0,
        hazardCooldown: 0,
        actionCooldown: 0,
        finished: false,
        eliminated: false,
        finishPlace: 0,
        score: 0,
      });
    });
  }

  receiveInput(ws, packet) {
    const player = this.players.get(ws.playerId);
    if (!player || this.phase !== 'playing' || player.eliminated || player.finished) return;
    const x = Number(packet?.x) || 0;
    const y = Number(packet?.y) || 0;
    const length = Math.hypot(x, y) || 1;
    player.input = {
      x: clamp(x / Math.max(1, length), -1, 1),
      y: clamp(y / Math.max(1, length), -1, 1),
      jumpPressed: packet?.jumpPressed === true,
      punchPressed: packet?.punchPressed === true,
      kickPressed: packet?.kickPressed === true,
      bananaPressed: packet?.bananaPressed === true,
      abilityPressed: packet?.abilityPressed === true,
    };
    player.lastInputTick = Number.isInteger(packet?.tick) ? packet.tick : player.lastInputTick;
  }

  tickRoom(dt) {
    this.tick += 1;
    if (this.phase === 'waiting') return;
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 0) this.startMatch();
      if (this.tick % 6 === 0) this.broadcastRoomState();
      return;
    }
    if (this.phase === 'intermission') {
      this.intermission = Math.max(0, this.intermission - dt);
      if (this.intermission <= 0) {
        this.phase = 'playing';
        this.roundIndex += 1;
        this.roundPlayers = [...this.qualified];
        this.beginRound();
        this.broadcast({ type: 'round-start', map: this.currentRound(), round: this.roundIndex + 1 });
      }
      return;
    }
    if (this.phase !== 'playing') return;

    this.elapsed += dt;
    for (const player of this.players.values()) this.simulatePlayer(player, dt);
    this.updateBananas(dt);
    this.roundTime = Math.max(0, this.roundTime - dt);
    const active = [...this.players.values()].filter((player) => this.roundPlayers.includes(player.id) && !player.eliminated);
    const target = this.roundQualifiers();
    if (this.currentRound().mode === 'elimination' && active.length <= target) this.finishRound();
    else if (this.qualified.length >= target || this.roundTime <= 0) this.finishRound();

    this.snapshotTick += 1;
    if (this.snapshotTick >= Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE))) {
      this.snapshotTick = 0;
      this.broadcastSnapshot();
    }
  }

  simulatePlayer(player, dt) {
    if (player.eliminated || player.finished) return;
    player.stateTimer = Math.max(0, player.stateTimer - dt);
    player.hazardCooldown = Math.max(0, player.hazardCooldown - dt);
    player.actionCooldown = Math.max(0, player.actionCooldown - dt);
    if (player.state === 'ragdoll') {
      player.vy += GRAVITY * dt;
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.y += player.vy * dt;
      if (player.y <= 0.78) {
        player.y = 0.78;
        player.vy = 0;
        player.grounded = true;
      }
      if (player.stateTimer <= 0) player.state = 'normal';
      this.checkFall(player);
      return;
    }

    const input = player.input;
    this.applyActions(player, input);
    const directionX = input.x;
    const directionZ = -input.y;
    const accel = 0.18;
    const targetX = directionX * TOP_SPEED;
    const targetZ = directionZ * TOP_SPEED;
    player.vx += (targetX - player.vx) * accel;
    player.vz += (targetZ - player.vz) * accel;
    player.yaw = Math.atan2(-directionX, -directionZ);

    if (input.jumpPressed && player.grounded) {
      player.vy = JUMP_VELOCITY;
      player.grounded = false;
      player.diveUsed = false;
    } else if (input.jumpPressed && !player.grounded && !player.diveUsed) {
      player.diveUsed = true;
      player.state = 'dive';
      player.vz = directionZ * TOP_SPEED * 1.35;
      player.vx = directionX * TOP_SPEED * 1.35;
    }
    if (input.kickPressed) {
      player.state = 'slide';
      player.stateTimer = 0.5;
      player.vx = directionX * TOP_SPEED * 1.45;
      player.vz = directionZ * TOP_SPEED * 1.45;
    }
    if (input.abilityPressed) {
      player.vx = directionX * TOP_SPEED * 1.7;
      player.vz = directionZ * TOP_SPEED * 1.7;
    }

    player.vy += GRAVITY * dt;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.y += player.vy * dt;
    player.x = clamp(player.x, -9.25, 9.25);
    if (player.y <= 0.78) {
      player.y = 0.78;
      player.vy = 0;
      player.grounded = true;
      player.diveUsed = false;
      if (player.state === 'dive' || player.state === 'slide') player.state = 'normal';
    } else player.grounded = false;

    this.applyServerHazards(player);
    if (player.z <= FINISH_Z) this.finishPlayer(player);
    this.checkFall(player);
  }

  applyActions(player, input) {
    if (player.actionCooldown > 0) return;
    const directionX = input.x;
    const directionZ = -input.y;
    if (input.punchPressed) {
      player.actionCooldown = 0.5;
      const target = [...this.players.values()].find((candidate) => {
        if (candidate.id === player.id || candidate.eliminated || candidate.finished) return false;
        const dx = candidate.x - player.x;
        const dz = candidate.z - player.z;
        const distance = Math.hypot(dx, dz);
        const dot = distance ? (dx * directionX + dz * directionZ) / distance : 0;
        return distance < 2.2 && dot > 0.35;
      });
      if (target) {
        target.state = 'ragdoll';
        target.stateTimer = 0.75;
        target.vx = directionX * 10;
        target.vz = directionZ * 10;
        target.vy = 3.5;
      }
    }
    if (input.bananaPressed) {
      player.actionCooldown = 0.35;
      this.bananas.push({ x: player.x + directionX * 1.3, z: player.z + directionZ * 1.3, ttl: 18 });
    }
  }

  updateBananas(dt) {
    for (const banana of this.bananas) {
      banana.ttl -= dt;
      if (banana.ttl <= 0) continue;
      for (const player of this.players.values()) {
        if (player.eliminated || player.finished) continue;
        if (Math.hypot(player.x - banana.x, player.z - banana.z) < 0.75 && player.y < 1.8) {
          player.state = 'ragdoll';
          player.stateTimer = 0.8;
          player.vy = 3.2;
          banana.ttl = 0;
          break;
        }
      }
    }
    this.bananas = this.bananas.filter((banana) => banana.ttl > 0);
  }

  applyServerHazards(player) {
    if (player.hazardCooldown > 0 || player.grounded === false && player.y > 2.3) return;
    const round = this.currentRound();
    const bumperZ = [-14, -43, -72, -101];
    for (const z of bumperZ) {
      const bumperX = Math.sin(this.elapsed * 3 + z) * 5.8;
      if (Math.abs(player.z - z) < 1.2 && Math.abs(player.x - bumperX) < 1.35) {
        player.hazardCooldown = 0.45;
        player.state = 'ragdoll';
        player.stateTimer = 0.65;
        player.vx = player.x < bumperX ? -8 : 8;
        player.vz = 5;
        player.vy = 3.5;
        return;
      }
    }
    if (round.mapId === 'laser-tracer') {
      for (const z of [-18, -48, -78]) {
        const angle = this.elapsed * 1.7 + z;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const along = player.x * dx + (player.z - z) * dz;
        const across = Math.abs(player.x * dz - (player.z - z) * dx);
        if (Math.abs(along) < 8 && across < 0.62 && player.y < 1.95) {
          player.hazardCooldown = 0.6;
          player.state = 'ragdoll';
          player.stateTimer = 0.7;
          player.vx = dx * 8;
          player.vz = dz * 8;
          player.vy = 3.2;
          return;
        }
      }
    }
  }

  checkFall(player) {
    if (player.y >= -5) return;
    if (this.currentRound().mode === 'elimination') this.eliminatePlayer(player);
    else {
      player.y = 1;
      player.z = Math.min(13, player.z + 8);
      player.vx = 0;
      player.vy = 0;
      player.vz = 0;
    }
  }

  finishPlayer(player) {
    if (player.finished || player.eliminated) return;
    player.finished = true;
    player.finishPlace = this.qualified.length + 1;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.z = FINISH_Z - 2;
    this.qualified.push(player.id);
  }

  eliminatePlayer(player) {
    player.eliminated = true;
    player.state = 'eliminated';
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
  }

  roundQualifiers() {
    const count = Math.max(1, this.roundPlayers.length);
    if (this.roundIndex >= ROUND_DEFINITIONS.length - 1) return 1;
    return Math.max(1, Math.ceil(count / 2));
  }

  finishRound() {
    if (this.phase !== 'playing') return;
    const target = this.roundQualifiers();
    const active = [...this.players.values()].filter((player) => this.roundPlayers.includes(player.id) && !player.eliminated);
    const sorted = active.sort((a, b) => (a.finished ? -1 : 1) - (b.finished ? -1 : 1) || a.z - b.z);
    const ids = [...this.qualified, ...sorted.map((player) => player.id)].filter((id, index, all) => all.indexOf(id) === index).slice(0, target);
    this.qualified = ids;
    if (this.roundIndex >= ROUND_DEFINITIONS.length - 1) {
      this.phase = 'complete';
      const winnerId = ids[0] || sorted[0]?.id;
      this.broadcast({ type: 'match-end', winnerId, roomId: this.id });
      this.broadcastSnapshot();
      this.disposalTimer = 20;
      return;
    }
    this.phase = 'intermission';
    this.intermission = 3;
    this.broadcast({ type: 'round-end', qualified: ids, nextMap: ROUND_DEFINITIONS[this.roundIndex + 1], intermission: this.intermission });
    this.broadcastSnapshot();
  }

  broadcastRoomState() {
    this.broadcast({
      type: 'room-state',
      roomId: this.id,
      phase: this.phase,
      roomSize: this.size,
      maxPlayers: MAX_PLAYERS,
      countdown: Math.ceil(this.countdown),
      message: this.phase === 'waiting' ? 'Waiting for another player…' : this.phase === 'countdown' ? 'Players found. Match starting soon.' : 'Match in progress',
    });
  }

  broadcastSnapshot() {
    const definition = this.currentRound();
    const active = [...this.players.values()].filter((player) => !player.eliminated);
    this.broadcast({
      type: 'snapshot',
      roomId: this.id,
      phase: this.phase,
      round: this.roundIndex + 1,
      totalRounds: ROUND_DEFINITIONS.length,
      map: definition,
      countdown: Math.ceil(this.countdown),
      timeLeft: Math.ceil(this.roundTime),
      qualifiers: this.roundQualifiers(),
      qualified: this.qualified.length,
      alive: active.length,
      tick: this.tick,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        team: player.team,
        x: player.x,
        y: player.y,
        z: player.z,
        vx: player.vx,
        vy: player.vy,
        vz: player.vz,
        yaw: player.yaw,
        state: player.state,
        finished: player.finished,
        eliminated: player.eliminated,
        finishPlace: player.finishPlace,
      })),
    });
  }

  broadcast(packet) {
    for (const player of this.players.values()) send(player.ws, packet);
  }

  tickDisposal(dt) {
    if (this.phase === 'complete') {
      this.disposalTimer -= dt;
      if (this.disposalTimer <= 0) this.onEmpty(this);
    }
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.nextRoomNumber = 1;
    this.loop = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  createRoom(mode = 'original') {
    const id = `room-${String(this.nextRoomNumber++).padStart(4, '0')}`;
    const room = new AuthorityRoom(id, mode, (emptyRoom) => this.rooms.delete(emptyRoom.id));
    this.rooms.set(id, room);
    return room;
  }

  findAvailableRoom(mode) {
    return [...this.rooms.values()].find((room) => room.mode === mode && room.available);
  }

  queue(ws, { name, mode = 'original' } = {}) {
    const room = this.findAvailableRoom(mode) || this.createRoom(mode);
    room.addPlayer(ws, name);
    return room;
  }

  disconnect(ws) {
    const room = ws.roomId ? this.rooms.get(ws.roomId) : null;
    if (room) room.removePlayer(ws);
  }

  receive(ws, packet) {
    if (packet?.type === 'queue') return this.queue(ws, packet);
    if (packet?.type === 'input') {
      const room = ws.roomId ? this.rooms.get(ws.roomId) : null;
      room?.receiveInput(ws, packet);
    }
    if (packet?.type === 'ping') send(ws, { type: 'pong', at: Date.now() });
  }

  tick() {
    for (const room of this.rooms.values()) {
      room.tickRoom(1 / TICK_RATE);
      room.tickDisposal(1 / TICK_RATE);
    }
  }

  close() {
    clearInterval(this.loop);
  }
}

export { MAX_PLAYERS, COUNTDOWN_SECONDS, ROUND_DEFINITIONS };
