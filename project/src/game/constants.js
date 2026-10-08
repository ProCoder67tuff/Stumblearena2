export const FIXED_DT = 1 / 60;
export const MAX_CATCH_UP_STEPS = 6;
export const SIMULATION_HZ = 60;
export const GRAVITY = -18;
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.2;
export const TOP_SPEED = 8.6;
export const MOVE_ACCELERATION = 26;
export const JUMP_HEIGHT = 2.25;
export const JUMP_VELOCITY = Math.sqrt(2 * Math.abs(GRAVITY) * JUMP_HEIGHT);
export const IMPACT_THRESHOLD = 7.5;
export const RAGDOLL_DURATION = 1.2;
export const SLIDE_DURATION = 0.6;
export const BOT_COUNT = 31;

// Offline event formats inspired by the current Play Center structure. They
// all use local simulation and deterministic bots; no account or connection is
// needed to play any event.
export const OFFLINE_MODES = [
  { id: 'original', name: 'Original', rounds: 3, entrants: 32, description: 'The classic knockout: 32 racers become 16, then 8, then one champion.' },
  { id: 'grand-prix', name: 'Grand Prix', rounds: 5, entrants: 16, scoring: true, description: 'Play five rounds and win on consistency, not one lucky finish.' },
  { id: 'showdown', name: 'Showdown', rounds: 1, entrants: 8, description: 'A single high-pressure survival final. Be the last stumbler standing.' },
  { id: 'duel', name: 'Duel', rounds: 1, entrants: 2, description: 'A head-to-head race with one finish line and no room for mistakes.' },
  { id: 'clash', name: 'Clash', rounds: 3, entrants: 4, description: 'A compact three-round tournament for a tiny field of rivals.' },
  { id: 'turbo', name: 'Turbo', rounds: 3, entrants: 16, description: 'A faster three-round knockout with tighter timers and fewer racers.' },
  { id: 'blitz', name: 'Blitz', rounds: 1, entrants: 32, description: 'One chaotic course. Reach the finish before the field closes it.' },
  { id: 'teams', name: 'Teams', rounds: 3, entrants: 16, teams: true, description: 'Red versus blue: your squad advances by combining finish points.' },
  { id: 'time-trial', name: 'Time Trial', rounds: 1, entrants: 1, solo: true, description: 'A focused solo run with checkpoints, shortcuts, and a personal timer.' },
];

export const MAP_DEFINITIONS = [
  { id: 'spin-go-round', name: 'Spin Go Round', type: 'race', route: 'continuous', duration: 80, qualifiers: 16, theme: 'neon', description: 'Counter-rotating bars and slippery lanes.' },
  { id: 'cannon-climb', name: 'Cannon Climb', type: 'race', route: 'factory', duration: 78, qualifiers: 8, theme: 'factory', description: 'Climb through conveyors and swinging machinery.' },
  { id: 'tile-fall', name: 'Tile Fall', type: 'race', route: 'hex', duration: 70, qualifiers: 8, theme: 'honey', description: 'Read the safe path before the tiles disappear.' },
  { id: 'honey-drop', name: 'Honey Drop', type: 'elimination', route: 'hex', duration: 65, qualifiers: 4, theme: 'honey', description: 'Keep moving while the floor breaks away.' },
  { id: 'laser-tracer', name: 'Laser Tracer', type: 'elimination', route: 'laser', duration: 65, qualifiers: 4, theme: 'crown', description: 'Jump and dive over rotating laser beams.' },
  { id: 'block-dash', name: 'Block Dash', type: 'elimination', route: 'final', duration: 60, qualifiers: 1, theme: 'crown', description: 'Survive the moving wall and claim the crown.' },
  { id: 'coin-collect', name: 'Coin Quest', type: 'collection', route: 'factory', duration: 60, qualifiers: 8, theme: 'neon', description: 'Collect the most coins before the clock expires.' },
];

export const ROUND_DEFINITIONS = [
  { id: 1, mapId: 'spin-go-round', name: 'Spin Go Round', mode: 'race', entrants: 32, qualifiers: 16, duration: 80, theme: 'neon' },
  { id: 2, mapId: 'cannon-climb', name: 'Cannon Climb', mode: 'race', entrants: 16, qualifiers: 8, duration: 78, theme: 'factory' },
  { id: 3, mapId: 'laser-tracer', name: 'Laser Tracer', mode: 'elimination', entrants: 8, qualifiers: 1, duration: 65, theme: 'crown' },
];

export const PLAYER_COLORS = [
  0xff4d6d, 0xffb84d, 0x55d68a, 0x58a6ff, 0xbf7bff, 0xff6fcf,
  0x42d6d6, 0xe9e36f, 0xff865e, 0x8fd14f, 0x9d83ff, 0xf45d9a,
];

export const LEVEL_PALETTE = {
  neon: { sky: 0x110d35, fog: 0x110d35, floor: 0x251b59, accent: 0x49e6ff, accent2: 0xff52c8 },
  factory: { sky: 0x111d34, fog: 0x111d34, floor: 0x243958, accent: 0xffa24a, accent2: 0x55d8ff },
  honey: { sky: 0x281534, fog: 0x281534, floor: 0x543047, accent: 0xffd84a, accent2: 0xff6a53 },
  crown: { sky: 0x180d31, fog: 0x180d31, floor: 0x38205c, accent: 0xffd85d, accent2: 0xb670ff },
};

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
