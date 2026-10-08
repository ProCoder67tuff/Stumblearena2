import * as THREE from 'three';
import { LEVEL_PALETTE, MAP_DEFINITIONS, ROUND_DEFINITIONS } from './constants.js';
import { ObstacleSystem, addFloor, addWall } from './obstacles.js';

const zSegments = (start, end, step = 12) => {
  const segments = [];
  for (let z = start; z >= end; z -= step) segments.push(z);
  return segments;
};

function makeScenery(scene, palette, round) {
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.fog, 38, 190);
  const hemi = new THREE.HemisphereLight(0xb7d4ff, palette.floor, 1.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(-18, 28, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  scene.add(sun);
  const rim = new THREE.PointLight(palette.accent, 22, 42, 2);
  rim.position.set(0, 9, -30);
  scene.add(rim);
  const grid = new THREE.GridHelper(200, 80, palette.accent, palette.floor);
  grid.position.y = -0.51;
  grid.material.transparent = true;
  grid.material.opacity = 0.14;
  scene.add(grid);

  // Tall gradient-like course markers keep the route readable without textures.
  for (let i = 0; i < 22; i += 1) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3 + (i % 3), 0.18), new THREE.MeshBasicMaterial({ color: i % 2 ? palette.accent : palette.accent2 }));
    marker.position.set((i % 2 ? -1 : 1) * (10.5 + (i % 4)), 1.5, 10 - i * 8);
    scene.add(marker);
  }
  return { hemi, sun, rim, grid };
}

function addContinuousRoute(world, scene, obstacle, palette, round) {
  for (const z of zSegments(18, -126)) addFloor(world, scene, 0, z, 22, 13, palette.floor);
  addWall(world, scene, -11.5, -50, 0.6, 150, 2.4, palette.accent2);
  addWall(world, scene, 11.5, -50, 0.6, 150, 2.4, palette.accent2);
  obstacle.addFinish(-130);

  obstacle.addBumper({ x: -4.3, y: 1.0, z: 1 }, { radius: 1.0, speed: 3.2, color: palette.accent2 });
  obstacle.addBumper({ x: 4.4, y: 1.0, z: -30 }, { radius: 1.2, speed: -3.4, color: palette.accent });
  obstacle.addBumper({ x: -4.2, y: 1.0, z: -62 }, { radius: 1.1, speed: 2.8, color: palette.accent2 });
  obstacle.addBumper({ x: 4.0, y: 1.0, z: -98 }, { radius: 1.35, speed: -3.8, color: palette.accent });
  obstacle.addBumper({ x: 0, y: 1.0, z: -18 }, { radius: 1.0, speed: 4.8, color: palette.accent });
  obstacle.addBumper({ x: 0, y: 1.0, z: -76 }, { radius: 1.0, speed: -5.0, color: palette.accent2 });
  obstacle.addIceZone({ minX: -9, maxX: 9, minZ: -18, maxZ: -4 });
  obstacle.addIceZone({ minX: -9, maxX: 9, minZ: -89, maxZ: -77 });

  // Simple jump gates make the first map read like a race instead of a flat test box.
  for (const z of [-12, -46, -82, -114]) {
    obstacle.addMovingBlock({ x: 0, y: 0.9, z }, { x: 5.5, y: 1.8, z: 0.7 }, palette.accent2, { axis: 'x', amplitude: 3.2, frequency: 1.4 });
  }
}

function addFactoryRoute(world, scene, obstacle, palette) {
  for (const z of zSegments(18, -118)) addFloor(world, scene, 0, z, 22, 13, palette.floor);
  addWall(world, scene, -11.5, -48, 0.6, 140, 2.4, palette.accent);
  addWall(world, scene, 11.5, -48, 0.6, 140, 2.4, palette.accent);
  obstacle.addFinish(-122);
  obstacle.addConveyorZone({ minX: -8.8, maxX: 8.8, minZ: 6, maxZ: 18 }, { x: 5.5, z: 0 });
  obstacle.addConveyorZone({ minX: -8.8, maxX: 8.8, minZ: -42, maxZ: -28 }, { x: -6.5, z: 0 });
  obstacle.addConveyorZone({ minX: -8.8, maxX: 8.8, minZ: -94, maxZ: -80 }, { x: 0, z: 6.5 });
  for (let i = 0; i < 10; i += 1) {
    const x = i % 2 ? -4.3 : 4.3;
    obstacle.addMovingBlock({ x, y: 1.15, z: -8 - i * 10 }, { x: 2.3, y: 2.3, z: 1.0 }, palette.accent2, { axis: 'x', amplitude: 2.4, frequency: 1.55 + (i % 3) * 0.18 });
  }
  obstacle.addBumper({ x: 0, y: 1.1, z: -54 }, { radius: 1.55, speed: 4.4, color: palette.accent });
  obstacle.addBumper({ x: -4.8, y: 1.1, z: -20 }, { radius: 1.1, speed: -4.7, color: palette.accent2 });
  obstacle.addBumper({ x: 4.8, y: 1.1, z: -88 }, { radius: 1.1, speed: 5.1, color: palette.accent });
  obstacle.addIceZone({ minX: -9, maxX: 9, minZ: -112, maxZ: -100 });
}

function addHexRoute(world, scene, obstacle, palette) {
  const tileRadius = 1.75;
  const rowSpacing = 3.0;
  const rows = 36;
  for (let row = 0; row < rows; row += 1) {
    const z = 20 - row * rowSpacing;
    for (let col = -3; col <= 3; col += 1) {
      // Every seventh row has a deliberate gap, forcing a lane change rather
      // than allowing a perfect straight-line bot route.
      if (row % 7 === 4 && col === (row % 2 ? 1 : -1)) continue;
      const x = col * 3.05 + (row % 2 ? 1.52 : 0);
      obstacle.addHexTile({ x, y: -0.16, z }, tileRadius, row % 3 === 0 ? palette.accent : palette.accent2);
    }
  }
  obstacle.addFinish(20 - rows * rowSpacing - 4);
  addWall(world, scene, -12, -32, 0.5, 120, 3, palette.accent2);
  addWall(world, scene, 12, -32, 0.5, 120, 3, palette.accent2);
  obstacle.addBumper({ x: -5.6, y: 1.1, z: -34 }, { radius: 1.05, speed: 5.2, color: palette.accent });
  obstacle.addBumper({ x: 5.6, y: 1.1, z: -72 }, { radius: 1.05, speed: -5.2, color: palette.accent2 });
  obstacle.addBumper({ x: 0, y: 1.1, z: -51 }, { radius: 0.9, speed: 6.0, color: palette.accent });
}

function addFinalRoute(world, scene, obstacle, palette) {
  for (const z of zSegments(18, -106)) addFloor(world, scene, 0, z, 16, 13, palette.floor);
  addWall(world, scene, -8.5, -42, 0.5, 120, 2.7, palette.accent2);
  addWall(world, scene, 8.5, -42, 0.5, 120, 2.7, palette.accent2);
  obstacle.addFinish(-112);
  obstacle.addIceZone({ minX: -6.5, maxX: 6.5, minZ: -15, maxZ: -2 });
  obstacle.addConveyorZone({ minX: -6.5, maxX: 6.5, minZ: -55, maxZ: -42 }, { x: 0, z: -7 });
  for (const z of [-30, -64, -93]) obstacle.addBumper({ x: 0, y: 1.05, z }, { radius: 1.3, speed: z % 2 ? 4 : -4, color: palette.accent });
  obstacle.addBumper({ x: -4.2, y: 1.05, z: -18 }, { radius: 0.95, speed: -5.4, color: palette.accent2 });
  obstacle.addBumper({ x: 4.2, y: 1.05, z: -79 }, { radius: 0.95, speed: 5.4, color: palette.accent2 });
  obstacle.addMovingBlock({ x: 0, y: 1.0, z: -48 }, { x: 4.8, y: 2.0, z: 0.65 }, palette.accent2, { axis: 'x', amplitude: 2.7, frequency: 1.9 });
  obstacle.addMovingBlock({ x: 0, y: 1.0, z: -101 }, { x: 4.8, y: 2.0, z: 0.65 }, palette.accent, { axis: 'x', amplitude: 2.7, frequency: 2.1 });
}

function addLaserRoute(world, scene, obstacle, palette) {
  for (const z of zSegments(18, -86)) addFloor(world, scene, 0, z, 18, 13, palette.floor);
  addWall(world, scene, -10, -34, 0.6, 110, 2.6, palette.accent2);
  addWall(world, scene, 10, -34, 0.6, 110, 2.6, palette.accent2);
  obstacle.addFinish(-92);
  obstacle.addLaser({ x: 0, y: 0.9, z: -12 }, { length: 8.5, speed: 1.25, phase: 0, color: palette.accent });
  obstacle.addLaser({ x: 0, y: 1.25, z: -40 }, { length: 8.5, speed: -1.8, phase: 1.5, color: palette.accent2 });
  obstacle.addLaser({ x: 0, y: 1.55, z: -68 }, { length: 8.5, speed: 2.25, phase: 2.4, color: palette.accent });
  obstacle.addBumper({ x: -5.2, y: 1.0, z: -27 }, { radius: 0.9, speed: 4.4, color: palette.accent2 });
  obstacle.addBumper({ x: 5.2, y: 1.0, z: -56 }, { radius: 0.9, speed: -4.4, color: palette.accent });
}

function addCoins(obstacle) {
  for (let row = 0; row < 10; row += 1) {
    const z = 9 - row * 11;
    obstacle.addCoin({ x: ((row % 4) - 1.5) * 3.2, y: 0.9, z, value: row % 3 === 0 ? 3 : 1 });
    obstacle.addCoin({ x: (row % 2 ? -1 : 1) * 5.8, y: 0.9, z: z - 3, value: 1 });
  }
}

export function createLevel({ world, scene, roundIndex, mapId, definition: requestedDefinition }) {
  const map = MAP_DEFINITIONS.find((item) => item.id === mapId) || MAP_DEFINITIONS[roundIndex % MAP_DEFINITIONS.length];
  const definition = requestedDefinition || ROUND_DEFINITIONS[roundIndex] || {
    ...map, mode: map.type, entrants: 32, qualifiers: map.qualifiers, duration: map.duration,
  };
  const palette = LEVEL_PALETTE[map.theme];
  const scenery = makeScenery(scene, palette, definition);
  const obstacle = new ObstacleSystem(world, scene);
  if (map.route === 'continuous') addContinuousRoute(world, scene, obstacle, palette, definition);
  if (map.route === 'factory') addFactoryRoute(world, scene, obstacle, palette);
  if (map.route === 'hex') addHexRoute(world, scene, obstacle, palette);
  if (map.route === 'final') addFinalRoute(world, scene, obstacle, palette);
  if (map.route === 'laser') addLaserRoute(world, scene, obstacle, palette);
  if (map.id === 'coin-collect') addCoins(obstacle);
  const startPositions = Array.from({ length: definition.entrants }, (_, index) => ({
    x: ((index % 8) - 3.5) * 1.05,
    y: map.route === 'hex' ? 1.05 : 1.0,
    z: 13 + Math.floor(index / 8) * 2.0,
  }));
  return { definition, map, palette, scenery, obstacle, startPositions };
}
