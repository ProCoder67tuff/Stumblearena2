import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DeterministicECS } from './ecs.js';
import { emptyInput } from './input.js';
import { PlayerController, PlayerState } from './PlayerController.js';
import { createLevel } from './LevelFactory.js';
import { FallbackRenderer } from './FallbackRenderer.js';
import {
  BOT_COUNT,
  FIXED_DT,
  GRAVITY,
  JUMP_VELOCITY,
  MAP_DEFINITIONS,
  MAX_CATCH_UP_STEPS,
  OFFLINE_MODES,
  PLAYER_COLORS,
  ROUND_DEFINITIONS,
  clamp,
} from './constants.js';

function buildWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  const playerMaterial = new CANNON.Material('player');
  const floorMaterial = new CANNON.Material('floor');
  world.addContactMaterial(new CANNON.ContactMaterial(playerMaterial, floorMaterial, { friction: 0.9, restitution: 0.02 }));
  world.defaultContactMaterial.friction = 0.65;
  world.defaultContactMaterial.restitution = 0.05;
  return world;
}

function mapById(id) {
  return MAP_DEFINITIONS.find((map) => map.id === id) || MAP_DEFINITIONS[0];
}

function buildRounds(mode) {
  if (mode.id === 'original' || mode.id === 'classic') return ROUND_DEFINITIONS.map((round) => ({ ...round }));
  if (mode.id === 'grand-prix') {
    const playlist = ['spin-go-round', 'cannon-climb', 'tile-fall', 'coin-collect', 'laser-tracer'];
    return playlist.map((mapId, index) => {
      const map = mapById(mapId);
      return { id: index + 1, mapId, name: map.name, mode: map.type, entrants: mode.entrants, qualifiers: mode.entrants, duration: map.duration, theme: map.theme };
    });
  }
  if (mode.id === 'showdown') {
    const map = mapById('laser-tracer');
    return [{ id: 1, mapId: map.id, name: map.name, mode: 'elimination', entrants: mode.entrants, qualifiers: 1, duration: map.duration, theme: map.theme }];
  }
  if (mode.id === 'duel') {
    const map = mapById('spin-go-round');
    return [{ id: 1, mapId: map.id, name: map.name, mode: 'race', entrants: 2, qualifiers: 1, duration: map.duration, theme: map.theme }];
  }
  if (mode.id === 'clash') {
    const playlist = ['spin-go-round', 'cannon-climb', 'laser-tracer'];
    return playlist.map((mapId, index) => {
      const map = mapById(mapId);
      return { id: index + 1, mapId, name: map.name, mode: map.type, entrants: index === 0 ? 4 : index === 1 ? 3 : 2, qualifiers: index === 0 ? 3 : index === 1 ? 2 : 1, duration: map.duration, theme: map.theme };
    });
  }
  if (mode.id === 'turbo') {
    const playlist = ['spin-go-round', 'cannon-climb', 'laser-tracer'];
    return playlist.map((mapId, index) => {
      const map = mapById(mapId);
      return { id: index + 1, mapId, name: map.name, mode: map.type, entrants: index === 0 ? 16 : index === 1 ? 8 : 4, qualifiers: index === 0 ? 8 : index === 1 ? 4 : 1, duration: Math.round(map.duration * 0.72), theme: map.theme };
    });
  }
  if (mode.id === 'blitz') {
    const map = mapById('spin-go-round');
    return [{ id: 1, mapId: map.id, name: map.name, mode: 'race', entrants: 32, qualifiers: 1, duration: 64, theme: map.theme }];
  }
  if (mode.id === 'teams') {
    const playlist = ['spin-go-round', 'coin-collect', 'laser-tracer'];
    return playlist.map((mapId, index) => {
      const map = mapById(mapId);
      return { id: index + 1, mapId, name: map.name, mode: map.type, entrants: index === 0 ? 16 : index === 1 ? 8 : 4, qualifiers: index === 0 ? 8 : index === 1 ? 4 : 1, duration: map.duration, theme: map.theme };
    });
  }
  const map = mapById('cannon-climb');
  return [{ id: 1, mapId: map.id, name: map.name, mode: 'race', entrants: 1, qualifiers: 1, duration: map.duration, theme: map.theme }];
}

export class OfflineMatch {
  constructor(canvas, { inputProvider, onUpdate, onMessage } = {}) {
    this.canvas = canvas;
    this.inputProvider = inputProvider || emptyInput;
    this.onUpdate = onUpdate || (() => {});
    this.onMessage = onMessage || (() => {});
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.rendererMode = 'webgl';
    } catch (error) {
      // Hosted previews may not expose WebGL. Keep the local simulation and
      // interface visible with the small 2D fallback renderer.
      this.renderer = new FallbackRenderer(canvas);
      this.rendererMode = 'canvas';
      console.warn('WebGL unavailable; using the canvas preview renderer.', error);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 260);
    this.scene = new THREE.Scene();
    this.ecs = new DeterministicECS();
    this.players = new Map();
    this.records = new Map();
    this.roundParticipants = [];
    this.qualified = [];
    this.roundIndex = 0;
    this.mode = OFFLINE_MODES[0];
    this.roundDefinitions = ROUND_DEFINITIONS.map((round) => ({ ...round }));
    this.phase = 'lobby';
    this.tickId = 0;
    this.accumulator = 0;
    this.previousTime = 0;
    this.transitionTimer = 0;
    this.running = false;
    this.lastHumanPlace = 0;
    this.teamScores = { red: 0, blue: 0 };
    this.cameraLook = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    if (this.rendererMode === 'canvas') this.renderer.match = this;
    this.resize();
    this.buildLobbyScene();
    window.addEventListener('resize', () => this.resize());
  }

  buildLobbyScene() {
    this.scene.background = new THREE.Color(0x100b2f);
    this.scene.fog = new THREE.Fog(0x100b2f, 28, 140);
    this.scene.add(new THREE.HemisphereLight(0x9bc9ff, 0x201548, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(-14, 22, 10);
    sun.castShadow = true;
    this.scene.add(sun);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.5, 120),
      new THREE.MeshStandardMaterial({ color: 0x251b59, roughness: 0.72 }),
    );
    floor.position.set(0, -0.25, -34);
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(140, 56, 0x49e6ff, 0x38205c);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.18;
    this.scene.add(grid);
    for (let i = 0; i < 12; i += 1) {
      const beacon = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 3 + (i % 3), 0.22),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff52c8 : 0x49e6ff }),
      );
      beacon.position.set((i % 2 ? -1 : 1) * (8 + (i % 4)), 1.5, 4 - i * 7);
      this.scene.add(beacon);
    }
    this.camera.position.set(0, 7.5, 13);
    this.camera.lookAt(0, 0.6, -22);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.previousTime = performance.now();
    requestAnimationFrame((time) => this.frame(time));
  }

  stop() {
    this.running = false;
  }

  startMatch({ mode = 'classic' } = {}) {
    this.mode = OFFLINE_MODES.find((candidate) => candidate.id === mode) || OFFLINE_MODES[0];
    this.roundDefinitions = buildRounds(this.mode);
    this.roundIndex = 0;
    this.tickId = 0;
    this.records.clear();
    this.qualified = [];
    this.teamScores = { red: 0, blue: 0 };
    const entrants = this.roundDefinitions[0].entrants;
    for (let id = 1; id <= entrants; id += 1) {
      this.records.set(id, {
        id,
        isBot: id !== 1,
        team: id % 2 ? 'red' : 'blue',
        ability: ['fighter', 'mage', 'rogue', 'cleric'][id % 4],
        skill: id === 1 ? 1 : 0.54 + ((id * 37) % 42) / 100,
        eliminated: false,
        qualified: false,
        score: 0,
      });
    }
    this.roundParticipants = [...this.records.keys()];
    this.phase = 'transition';
    this.transitionTimer = 0.3;
    this.onMessage(this.mode.name.toUpperCase(), `${entrants} local racers are ready. ${this.roundDefinitions[0].name} is up first.`);
    this.start();
  }

  buildRoundWorld() {
    const definition = this.roundDefinitions[this.roundIndex];
    this.world = buildWorld();
    this.scene.clear();
    this.players.clear();
    this.ecs = new DeterministicECS();
    const level = createLevel({ world: this.world, scene: this.scene, roundIndex: this.roundIndex, mapId: definition.mapId, definition });
    this.level = level;
    this.obstacle = level.obstacle;
    this.roundTimer = level.definition.duration;
    this.qualified = [];
    this.roundParticipants.forEach((id, index) => {
      const record = this.records.get(id);
      if (!record || record.eliminated) return;
      const spawn = level.startPositions[index] || { x: 0, y: 1, z: 13 + index * 1.5 };
      const player = new PlayerController({
        world: this.world,
        scene: this.scene,
        id,
        position: spawn,
        color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length],
        isBot: record.isBot,
        skill: record.skill,
      });
      player.collectionScore = 0;
      this.players.set(id, player);
      this.ecs.createEntity(id);
      this.ecs.addComponent(id, 'controller', player);
      this.ecs.addComponent(id, 'record', record);
    });
    this.phase = 'playing';
    const map = mapById(definition.mapId);
    this.onMessage(`ROUND ${definition.id} · ${map.name.toUpperCase()}`, `${this.objectiveText(definition)} Move, jump, dive, and stay in the pack.`);
  }

  objectiveText(definition) {
    if (definition.mode === 'elimination') return `Survive until only ${definition.qualifiers} remain.`;
    if (definition.mode === 'collection') return 'Collect the most coins before time expires.';
    if (this.mode.scoring) return 'Finish strong to earn Grand Prix points.';
    return `Race to the finish. Top ${definition.qualifiers} qualify.`;
  }

  frame(now) {
    if (!this.running) return;
    const elapsed = Math.min(0.1, Math.max(0, (now - this.previousTime) / 1000));
    this.previousTime = now;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_CATCH_UP_STEPS) {
      this.simulateTick();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps === MAX_CATCH_UP_STEPS) this.accumulator = 0;
    this.renderFrame();
    requestAnimationFrame((time) => this.frame(time));
  }

  simulateTick() {
    this.tickId += 1;
    if (this.phase === 'transition') {
      this.transitionTimer -= FIXED_DT;
      if (this.transitionTimer <= 0) this.buildRoundWorld();
      this.pushUiUpdate();
      return;
    }
    if (this.phase !== 'playing') {
      this.pushUiUpdate();
      return;
    }

    const humanInput = this.inputProvider(this.tickId);
    const snapshot = [...this.players.values()].sort((a, b) => a.id - b.id);
    this.obstacle.update(FIXED_DT, snapshot);

    for (const player of snapshot) {
      if (player.eliminated) continue;
      const input = player.id === 1 ? humanInput : this.botInput(player);
      this.applyAbilities(player, input);
      const modifiers = this.obstacle.getModifiers(player);
      const speedScale = player.isBot ? 0.98 + player.skill * 0.12 : 1.06;
      player.simulate(input, FIXED_DT, { ...modifiers, groundProbeY: 0, speedScale });
    }

    this.world.step(FIXED_DT);
    this.resolvePlayerContact(snapshot);
    this.handleFallen(snapshot);
    if (this.level.definition.mode !== 'elimination') this.recordFinishers(snapshot);
    this.roundTimer -= FIXED_DT;
    this.applyBotEliminationPressure();

    const definition = this.level.definition;
    const alive = snapshot.filter((player) => !player.eliminated).length;
    const finishedEnough = definition.mode === 'elimination'
      ? alive <= definition.qualifiers
      : definition.mode === 'collection'
        ? this.roundTimer <= 0
        : this.qualified.length >= definition.qualifiers || this.roundTimer <= 0;
    if (finishedEnough) this.finishRound();
    this.pushUiUpdate();
  }

  handleFallen(players) {
    for (const player of players) {
      if (player.eliminated || player.position.y >= -8) continue;
      if (this.level.definition.mode === 'elimination') {
        this.eliminatePlayer(player, 'fell out');
      } else {
        const z = Math.min(13, player.position.z + 8);
        player.body.position.set(clamp(player.position.x, -7.5, 7.5), 1.4, z);
        player.body.velocity.set(0, 0, 0);
        player.recoverFromRagdoll();
      }
    }
  }

  eliminatePlayer(player, _reason = 'eliminated') {
    const record = this.records.get(player.id);
    if (!record || record.eliminated) return;
    record.eliminated = true;
    player.eliminated = true;
    player.finished = true;
    player.body.velocity.set(0, 0, 0);
    player.body.type = CANNON.Body.KINEMATIC;
    player.body.mass = 0;
    player.body.updateMassProperties();
    player.mesh.visible = false;
  }

  applyBotEliminationPressure() {
    const definition = this.level.definition;
    if (definition.mode !== 'elimination' || this.roundTimer > 18 || this.tickId % 60 !== 0) return;
    const alive = [...this.players.values()].filter((player) => !player.eliminated);
    if (alive.length <= definition.qualifiers) return;
    const candidates = alive.filter((player) => player.id !== 1).sort((a, b) => b.position.z - a.position.z);
    if (candidates[0]) this.eliminatePlayer(candidates[0], 'survival cutoff');
  }

  botInput(player) {
    if (player.eliminated) return emptyInput(this.tickId);
    const checkpoint = Math.min(4, Math.max(0, Math.floor((13 - player.position.z) / 27)));
    const baseLane = ((player.id * 17 + checkpoint * 5 + this.roundIndex * 3) % 13) - 6;
    const wave = Math.sin(this.tickId * 0.027 + player.id * 1.43) * (1.1 + (1 - player.skill) * 1.8);
    let targetX = clamp(baseLane * 1.12 + wave, -8.0, 8.0);
    let danger = false;
    let avoidX = 0;
    const hazards = [
      ...this.obstacle.bumpers.map((bumper) => ({ x: bumper.position.x, z: bumper.position.z, radius: bumper.radius + 1.2 })),
      ...this.obstacle.movingBlocks.map((block) => ({ x: block.body.position.x, z: block.body.position.z, radius: Math.max(block.size.x, block.size.z) * 0.55 + 1.2 })),
    ];
    for (const hazard of hazards) {
      const ahead = player.position.z - hazard.z;
      if (ahead > -1.5 && ahead < 8.5 && Math.abs(player.position.x - hazard.x) < hazard.radius) {
        danger = true;
        avoidX += player.position.x <= hazard.x ? -1.8 : 1.8;
      }
    }
    if (this.roundIndex === 2 && this.obstacle.hexTiles.length) {
      const nextRow = Math.round((20 - player.position.z) / 3) + 1;
      const candidates = this.obstacle.hexTiles.filter((tile) => !tile.disabled && Math.abs(Math.round((20 - tile.center.z) / 3) - nextRow) <= 1);
      if (candidates.length) {
        candidates.sort((a, b) => Math.abs(a.center.x - (targetX + avoidX)) - Math.abs(b.center.x - (targetX + avoidX)));
        targetX = candidates[0].center.x;
        danger = danger || Math.abs(player.position.x - targetX) > 1.2;
      }
    }
    targetX = clamp(targetX + avoidX, -8.5, 8.5);
    const steeringNoise = Math.sin(this.tickId * 0.19 + player.id * 2.1) * (1 - player.skill) * 0.28;
    const steer = clamp((targetX - player.position.x) * 0.42 + steeringNoise, -1, 1);
    const stuck = player.grounded && Math.abs(player.velocity.z) < 1.8;
    const jumpWindow = Math.max(14, Math.floor(29 / Math.max(0.35, player.skill)));
    const jump = player.grounded && (danger || stuck) && ((this.tickId + player.id * 7) % jumpWindow === 0);
    return { tick: this.tickId, x: steer, y: 1, jumpPressed: jump, punchPressed: false, kickPressed: false, bananaPressed: false };
  }

  applyAbilities(player, input) {
    if (input.abilityPressed && player.abilityCooldown <= 0) {
      const record = this.records.get(player.id);
      const ability = record?.ability || ['fighter', 'mage', 'rogue', 'cleric'][player.id % 4];
      const f = player.forward;
      player.abilityCooldown = 8;
      if (ability === 'fighter') {
        player.body.velocity.x = f.x * 14;
        player.body.velocity.z = f.z * 14;
        const target = this.findTargetInFront(player, 2.4, 0.45);
        if (target) target.enterRagdoll(new CANNON.Vec3(f.x * 13, 4.2, f.z * 13), 'ability strike');
      } else if (ability === 'mage') {
        player.body.position.x = clamp(player.position.x + f.x * 4.5, -8.8, 8.8);
        player.body.position.z += f.z * 4.5;
      } else if (ability === 'rogue') {
        player.body.velocity.y = Math.max(player.body.velocity.y, JUMP_VELOCITY * 1.45);
        player.diveUsed = false;
      } else {
        player.shieldTimer = 2.6;
      }
    }
    if (input.punchPressed) {
      const target = this.findTargetInFront(player, 1.8, 0.72);
      if (target) {
        const f = player.forward;
        target.enterRagdoll(new CANNON.Vec3(f.x * 11, 3.2, f.z * 11), 'punch');
      }
    }
    if (input.kickPressed) player.startSlideKick();
    if (input.bananaPressed) {
      const f = player.forward;
      this.obstacle.spawnBanana({ x: player.position.x + f.x * 1.3, z: player.position.z + f.z * 1.3 });
    }
    if (player.state === PlayerState.SLIDE && player.stateTime < 0.22) {
      for (const target of this.players.values()) {
        if (target.id === player.id || target.finished || target.eliminated || target.state === PlayerState.RAGDOLL) continue;
        const dx = target.position.x - player.position.x;
        const dz = target.position.z - player.position.z;
        if (Math.hypot(dx, dz) < 1.35) {
          const length = Math.hypot(dx, dz) || 1;
          target.enterRagdoll(new CANNON.Vec3((dx / length) * 8, 4.5, (dz / length) * 8), 'slide kick');
        }
      }
    }
  }

  findTargetInFront(player, range, cone) {
    const f = player.forward;
    let best = null;
    let bestDistance = Infinity;
    for (const target of this.players.values()) {
      if (target.id === player.id || target.finished || target.eliminated || target.state === PlayerState.RAGDOLL) continue;
      const dx = target.position.x - player.position.x;
      const dz = target.position.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > range || distance < 0.1) continue;
      const dot = (dx * f.x + dz * f.z) / distance;
      if (dot >= cone && distance < bestDistance) { best = target; bestDistance = distance; }
    }
    return best;
  }

  resolvePlayerContact(players) {
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i];
        const b = players[j];
        if (a.finished || b.finished || a.eliminated || b.eliminated) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0 && distance < 0.72) {
          const push = (0.72 - distance) * 0.22;
          a.body.position.x -= dx / distance * push;
          a.body.position.z -= dz / distance * push;
          b.body.position.x += dx / distance * push;
          b.body.position.z += dz / distance * push;
        }
      }
    }
  }

  recordFinishers(players) {
    for (const player of players) {
      if (player.eliminated || this.qualified.includes(player.id)) continue;
      if (this.level.definition.mode !== 'collection' && this.obstacle.hasFinished(player)) {
        this.qualified.push(player.id);
        player.lockAtFinish(this.obstacle.finishZ, this.qualified.length - 1);
        const record = this.records.get(player.id);
        if (record) record.qualified = true;
      }
    }
  }

  ranking() {
    const players = [...this.players.values()].filter((player) => !player.eliminated);
    if (this.level.definition.mode === 'collection') {
      return players.sort((a, b) => (b.collectionScore || 0) - (a.collectionScore || 0) || a.position.z - b.position.z);
    }
    return players.sort((a, b) => a.position.z - b.position.z);
  }

  awardGrandPrixPoints(ranking) {
    ranking.forEach((player, index) => {
      const record = this.records.get(player.id);
      if (record) record.score += Math.max(1, ranking.length - index);
    });
  }

  awardTeamPoints(ranking) {
    ranking.forEach((player, index) => {
      const record = this.records.get(player.id);
      if (record) this.teamScores[record.team] += Math.max(1, ranking.length - index);
    });
  }

  finishRound() {
    if (this.phase !== 'playing') return;
    const definition = this.level.definition;
    const ranking = this.ranking();
    if (this.mode.scoring) this.awardGrandPrixPoints(ranking);
    if (this.mode.teams) this.awardTeamPoints(ranking);

    if (this.mode.scoring) {
      if (this.roundIndex === this.roundDefinitions.length - 1) {
        const winner = [...this.records.values()].sort((a, b) => b.score - a.score)[0];
        this.completeMatch(winner?.id || 1, `Grand Prix complete · ${winner?.score || 0} points`);
        return;
      }
      this.roundParticipants = [...this.records.keys()];
      this.roundIndex += 1;
      this.phase = 'transition';
      this.transitionTimer = 2.2;
      this.onMessage(`SCOREBOARD · ${this.roundIndex + 1}/${this.roundDefinitions.length}`, 'Every finish counts. The next course is loading.');
      return;
    }

    let advancing;
    if (definition.mode === 'elimination') {
      advancing = ranking.slice(0, definition.qualifiers).map((player) => player.id);
    } else if (definition.mode === 'collection') {
      advancing = ranking.slice(0, definition.qualifiers).map((player) => player.id);
    } else {
      const finishers = this.qualified.map((id) => this.players.get(id)).filter(Boolean);
      const remaining = ranking.filter((player) => !this.qualified.includes(player.id));
      advancing = [...finishers, ...remaining].slice(0, definition.qualifiers).map((player) => player.id);
    }

    if (this.mode.teams) {
      const winningTeam = this.teamScores.red >= this.teamScores.blue ? 'red' : 'blue';
      const teamPlayers = ranking.filter((player) => this.records.get(player.id)?.team === winningTeam);
      const selected = teamPlayers.length >= definition.qualifiers ? teamPlayers : ranking;
      advancing = selected.slice(0, definition.qualifiers).map((player) => player.id);
    }

    if (this.roundIndex === this.roundDefinitions.length - 1) {
      this.completeMatch(advancing[0] || ranking[0]?.id || 1, 'Final round complete.');
      return;
    }

    if (!advancing.includes(1)) {
      this.phase = 'complete';
      this.onMessage('RUN OVER', `You finished outside the top ${definition.qualifiers}. Choose Restart to try another route.`);
      this.pushUiUpdate();
      return;
    }

    this.roundParticipants = advancing;
    for (const record of this.records.values()) record.qualified = advancing.includes(record.id);
    this.roundIndex += 1;
    this.phase = 'transition';
    this.transitionTimer = 2.4;
    this.onMessage(`TOP ${advancing.length} QUALIFIED`, `Next up: ${this.roundDefinitions[this.roundIndex].name}. Get ready.`);
  }

  completeMatch(winnerId, detail) {
    this.phase = 'complete';
    const winner = this.records.get(winnerId);
    this.onMessage(winnerId === 1 ? 'YOU ARE THE CHAMPION' : `BOT ${winnerId} TAKES THE CROWN`, winnerId === 1 ? detail : 'Run it back and change the line through the hazards.');
    this.pushUiUpdate();
  }

  pushUiUpdate() {
    const definition = this.roundDefinitions[Math.min(this.roundIndex, this.roundDefinitions.length - 1)] || ROUND_DEFINITIONS[0];
    const activePlayers = [...this.players.values()].filter((player) => !player.eliminated);
    const place = this.mode.scoring
      ? [...this.records.values()].sort((a, b) => b.score - a.score).findIndex((record) => record.id === 1) + 1
      : activePlayers.sort((a, b) => a.position.z - b.position.z).findIndex((player) => player.id === 1) + 1;
    const human = this.players.get(1);
    this.lastHumanPlace = place || 0;
    const denominator = this.obstacle ? Math.max(1, 13 - this.obstacle.finishZ) : 130;
    const progress = human ? clamp((13 - human.position.z) / denominator, 0, 1) : 0;
    this.onUpdate({
      phase: this.phase,
      mode: this.mode.id,
      modeName: this.mode.name,
      round: this.roundIndex + 1,
      totalRounds: this.roundDefinitions.length,
      level: definition.name,
      objective: this.objectiveText(definition),
      qualified: this.qualified.length,
      qualifiers: definition.qualifiers,
      entrants: definition.entrants,
      alive: activePlayers.length,
      score: this.records.get(1)?.score || 0,
      teamScores: { ...this.teamScores },
      collectionScore: human?.collectionScore || 0,
      timeLeft: Math.max(0, this.roundTimer || 0),
      place: this.lastHumanPlace,
      progress,
      tick: this.tickId,
    });
  }

  renderFrame() {
    const human = this.players.get(1);
    if (human) {
      this.cameraPosition.set(human.position.x * 0.42, 7.5, human.position.z + 12.5);
      this.camera.position.lerp(this.cameraPosition, 0.08);
      this.cameraLook.set(human.position.x * 0.15, 0.65, human.position.z - 16);
      this.camera.lookAt(this.cameraLook);
    }
    if (this.level?.scenery?.rim) this.level.scenery.rim.position.z = human ? human.position.z - 26 : -30;
    this.renderer.render(this.scene, this.camera, this);
  }
}
