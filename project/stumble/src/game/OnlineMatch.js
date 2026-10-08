import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createLevel } from './LevelFactory.js';
import { createPlayerVisual } from './PlayerController.js';
import { FallbackRenderer } from './FallbackRenderer.js';
import { NetClient } from './NetClient.js';
import { PLAYER_COLORS } from './constants.js';

export class OnlineMatch {
  constructor(canvas, { inputProvider, onUpdate, onMessage, onStatus } = {}) {
    this.canvas = canvas;
    this.inputProvider = inputProvider || (() => ({}));
    this.onUpdate = onUpdate || (() => {});
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.rendererMode = 'webgl';
    } catch (error) {
      this.renderer = new FallbackRenderer(canvas);
      this.rendererMode = 'canvas';
      console.warn('Online WebGL unavailable; using canvas preview renderer.', error);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 260);
    this.scene = new THREE.Scene();
    this.world = null;
    this.level = null;
    this.players = new Map();
    this.phase = 'queue';
    this.running = false;
    this.tick = 0;
    this.lastInputAt = 0;
    this.playerId = 0;
    this.roomId = '';
    this.round = 1;
    this.targetCamera = new THREE.Vector3(0, 7.5, 13);
    this.lookTarget = new THREE.Vector3(0, 0.6, -22);
    if (this.rendererMode === 'canvas') this.renderer.match = this;
    this.buildLobbyScene();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.net = new NetClient({
      onMessage: (message) => this.handleMessage(message),
      onStatus: (status) => this.onStatus(status),
    });
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  buildLobbyScene() {
    this.scene.background = new THREE.Color(0x0e1233);
    this.scene.add(new THREE.HemisphereLight(0xb0d6ff, 0x172047, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(-12, 22, 12);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 100), new THREE.MeshStandardMaterial({ color: 0x223261, roughness: 0.7 }));
    floor.position.set(0, -0.25, -30);
    this.scene.add(floor);
    const grid = new THREE.GridHelper(120, 48, 0x55d8ff, 0x342e78);
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    this.scene.add(grid);
    this.camera.position.copy(this.targetCamera);
    this.camera.lookAt(this.lookTarget);
  }

  startQueue(name, mode = 'original') {
    this.running = true;
    this.net.connect({ name, mode });
    this.frame(performance.now());
  }

  stop() {
    this.running = false;
    this.net.close();
  }

  handleMessage(message) {
    if (message.type === 'connected') {
      this.onStatus('AUTHORITY CONNECTED · SEARCHING FOR A ROOM…');
      return;
    }
    if (message.type === 'room-state') {
      this.roomId = message.roomId || this.roomId;
      this.playerId = message.playerId || this.playerId;
      this.phase = message.phase;
      this.onUpdate({
        phase: 'queue',
        mode: 'online',
        modeName: 'Original Online',
        round: 1,
        totalRounds: 3,
        level: message.phase === 'countdown' ? 'Room ready' : 'Waiting room',
        objective: message.message || 'Waiting for another player…',
        entrants: message.roomSize || 1,
        qualifiers: Math.max(1, Math.ceil((message.roomSize || 1) / 2)),
        qualified: 0,
        alive: message.roomSize || 1,
        timeLeft: message.countdown || 0,
        place: 0,
        progress: 0,
        queueSize: message.roomSize || 1,
        countdown: message.countdown || 0,
      });
      this.onStatus(message.message || `ROOM ${message.roomSize}/${message.maxPlayers}`);
      return;
    }
    if (message.type === 'match-start' || message.type === 'round-start') {
      this.round = message.round || 1;
      this.setupLevel(message.map);
      this.phase = 'playing';
      this.onStatus(`ROUND ${this.round} · ${message.map?.name || 'COURSE'}`);
      return;
    }
    if (message.type === 'round-end') {
      this.onMessage(`TOP ${message.qualified?.length || 0} QUALIFIED`, `Next up: ${message.nextMap?.name || 'next course'}.`);
      return;
    }
    if (message.type === 'match-end') {
      this.phase = 'complete';
      this.onMessage(message.winnerId === this.playerId ? 'YOU ARE THE CHAMPION' : 'MATCH COMPLETE', 'The authority has closed the final round.');
      return;
    }
    if (message.type === 'snapshot') {
      this.applySnapshot(message);
    }
    if (message.type === 'error') this.onStatus(message.message || 'AUTHORITY ERROR');
  }

  setupLevel(map) {
    if (!map) return;
    this.scene.clear();
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
    const definition = {
      id: this.round,
      mapId: map.mapId,
      name: map.name,
      mode: map.mode,
      entrants: 32,
      qualifiers: map.mode === 'elimination' ? 1 : 16,
      duration: map.duration,
      theme: map.theme || 'neon',
    };
    this.level = createLevel({ world: this.world, scene: this.scene, roundIndex: this.round - 1, mapId: map.mapId, definition });
    for (const record of this.players.values()) this.scene.add(record.mesh);
    this.camera.position.set(0, 7.5, 13);
    this.camera.lookAt(0, 0.6, -22);
  }

  applySnapshot(snapshot) {
    this.phase = snapshot.phase;
    if (!this.level || this.level.map?.id !== snapshot.map?.mapId) this.setupLevel(snapshot.map);
    const seen = new Set();
    for (const state of snapshot.players || []) {
      seen.add(state.id);
      let record = this.players.get(state.id);
      if (!record) {
        const mesh = createPlayerVisual(PLAYER_COLORS[(state.id - 1) % PLAYER_COLORS.length], state.id);
        this.scene.add(mesh);
        record = { id: state.id, mesh, position: new THREE.Vector3(), target: new THREE.Vector3(), velocity: new THREE.Vector3(), finished: false, eliminated: false };
        this.players.set(state.id, record);
      }
      record.target.set(state.x, state.y, state.z);
      record.velocity.set(state.vx, state.vy, state.vz);
      record.finished = state.finished;
      record.eliminated = state.eliminated;
      record.mesh.visible = !state.eliminated;
      record.team = state.team;
    }
    for (const [id, record] of this.players) {
      if (!seen.has(id)) {
        record.mesh.removeFromParent();
        this.players.delete(id);
      }
    }
    const human = this.players.get(this.playerId);
    const place = [...this.players.values()].filter((player) => !player.eliminated).sort((a, b) => a.target.z - b.target.z).findIndex((player) => player.id === this.playerId) + 1;
    this.onUpdate({
      phase: snapshot.phase === 'complete' ? 'complete' : 'playing',
      mode: 'online',
      modeName: 'Original Online',
      round: snapshot.round,
      totalRounds: snapshot.totalRounds,
      level: snapshot.map?.name || 'Course',
      objective: snapshot.map?.mode === 'elimination' ? `Survive until ${snapshot.qualifiers} remain.` : `Top ${snapshot.qualifiers} qualify.`,
      qualified: snapshot.qualified,
      qualifiers: snapshot.qualifiers,
      entrants: snapshot.players?.length || 0,
      alive: snapshot.alive,
      timeLeft: snapshot.timeLeft,
      place: place || 0,
      progress: human ? Math.max(0, Math.min(1, (13 - human.target.z) / 133)) : 0,
      queueSize: snapshot.players?.length || 0,
    });
  }

  sendInput(now) {
    if (now - this.lastInputAt < 50 || !this.net.opened) return;
    this.lastInputAt = now;
    this.tick += 1;
    this.net.sendInput(this.inputProvider(this.tick));
  }

  frame(now) {
    if (!this.running) return;
    this.sendInput(now);
    for (const record of this.players.values()) {
      record.position.lerp(record.target, 0.28);
      record.mesh.position.copy(record.position);
      if (record.velocity.lengthSq() > 0.04) record.mesh.rotation.y = Math.atan2(-record.velocity.x, -record.velocity.z);
    }
    if (this.level?.obstacle) this.level.obstacle.update(1 / 60, []);
    const human = this.players.get(this.playerId);
    if (human) {
      this.targetCamera.set(human.position.x * 0.42, 7.5, human.position.z + 12.5);
      this.camera.position.lerp(this.targetCamera, 0.08);
      this.lookTarget.set(human.position.x * 0.15, 0.65, human.position.z - 16);
      this.camera.lookAt(this.lookTarget);
    }
    this.renderer.render(this.scene, this.camera, this);
    requestAnimationFrame((time) => this.frame(time));
  }
}
