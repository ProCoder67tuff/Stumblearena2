import * as CANNON from 'cannon-es';
import * as THREE from 'three';

function makeStaticBox(world, scene, position, size, color, options = {}) {
  const body = new CANNON.Body({ mass: 0, material: options.material });
  body.position.set(position.x, position.y, position.z);
  body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
  body.userData = { type: options.type || 'static' };
  world.addBody(body);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04, transparent: options.transparent ?? false, opacity: options.opacity ?? 1 }),
  );
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { body, mesh, position, size, type: options.type || 'static' };
}

function makeHexTile(world, scene, position, radius, color) {
  const body = new CANNON.Body({ mass: 0 });
  body.position.set(position.x, position.y, position.z);
  body.addShape(new CANNON.Cylinder(radius, radius, 0.32, 6));
  body.userData = { type: 'hex-tile' };
  world.addBody(body);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0.03 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.32, 6), material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.y = Math.PI / 6;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { body, mesh, material, center: new THREE.Vector3(position.x, position.y, position.z), radius, triggerTimer: 0, triggered: false, disabled: false };
}

function inZone(zone, player, padding = 0) {
  const p = player.position;
  return p.x >= zone.minX - padding && p.x <= zone.maxX + padding && p.z >= zone.minZ - padding && p.z <= zone.maxZ + padding;
}

export class ObstacleSystem {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.bumpers = [];
    this.iceZones = [];
    this.conveyorZones = [];
    this.hexTiles = [];
    this.bananas = [];
    this.coins = [];
    this.lasers = [];
    this.movingBlocks = [];
    this.finishZ = -120;
    this.tick = 0;
    this.elapsed = 0;
  }

  addBumper(position, { radius = 1.15, speed = 2.6, color = 0xff4bba } = {}) {
    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0 });
    body.position.set(position.x, position.y, position.z);
    body.addShape(new CANNON.Cylinder(radius * 0.5, radius * 0.5, 1.8, 12));
    body.userData = { type: 'spinner', obstacle: true };
    this.world.addBody(body);
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), new THREE.MeshStandardMaterial({ color: 0xffe477, roughness: 0.35 }));
    group.add(hub);
    const barMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.15 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(radius * 3.3, 0.38, 0.5), barMaterial);
    bar.castShadow = true;
    group.add(bar);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.35 }));
    cap.position.x = radius * 1.55;
    group.add(cap);
    group.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
    this.scene.add(group);
    const bumper = { body, group, position: new THREE.Vector3(position.x, position.y, position.z), radius, speed, cooldowns: new Map() };
    this.bumpers.push(bumper);
    return bumper;
  }

  addIceZone(zone) {
    this.iceZones.push(zone);
    const width = zone.maxX - zone.minX;
    const depth = zone.maxZ - zone.minZ;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.025, depth), new THREE.MeshStandardMaterial({ color: 0x70e8ff, transparent: true, opacity: 0.48, roughness: 0.15, metalness: 0.35 }));
    mesh.position.set((zone.minX + zone.maxX) / 2, 0.03, (zone.minZ + zone.maxZ) / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    zone.mesh = mesh;
  }

  addConveyorZone(zone, velocity) {
    this.conveyorZones.push({ ...zone, velocity });
    const width = zone.maxX - zone.minX;
    const depth = zone.maxZ - zone.minZ;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, depth), new THREE.MeshStandardMaterial({ color: 0xffa24a, transparent: true, opacity: 0.68, roughness: 0.5 }));
    mesh.position.set((zone.minX + zone.maxX) / 2, 0.04, (zone.minZ + zone.maxZ) / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    zone.mesh = mesh;
  }

  addMovingBlock(position, size, color = 0xff7b57, options = {}) {
    const block = makeStaticBox(this.world, this.scene, position, size, color, { type: 'moving-block' });
    block.base = { ...position };
    block.phase = (Math.abs(position.x) * 0.31 + Math.abs(position.z) * 0.017) % (Math.PI * 2);
    block.axis = options.axis || 'x';
    block.amplitude = options.amplitude ?? 2.5;
    block.frequency = options.frequency ?? 1.8;
    this.movingBlocks.push(block);
    return block;
  }

  addHexTile(position, radius = 1.35, color = 0xffcf4d) {
    const tile = makeHexTile(this.world, this.scene, position, radius, color);
    this.hexTiles.push(tile);
    return tile;
  }

  addFinish(z) {
    this.finishZ = z;
    // A short raised finish deck acts as a staging area. Qualified players are
    // converted to kinematic bodies and remain parked here until the round
    // transition, instead of running through the next scene.
    this.finishPlatform = makeStaticBox(
      this.world,
      this.scene,
      { x: 0, y: -0.25, z: z - 4.5 },
      { x: 18, y: 0.5, z: 10 },
      0x342e78,
      { type: 'finish-platform' },
    );
    addWall(this.world, this.scene, -9.2, z - 4.5, 0.35, 10, 1.2, 0xffd85d);
    addWall(this.world, this.scene, 9.2, z - 4.5, 0.35, 10, 1.2, 0xffd85d);
    const portal = new THREE.Group();
    portal.position.set(0, 2.4, z);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d6cff, emissive: 0x4c36ff, emissiveIntensity: 0.7, roughness: 0.3 });
    for (const x of [-8.8, 8.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.8, 0.35), mat);
      post.position.x = x;
      portal.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(18, 0.35, 0.35), mat);
    portal.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color: 0x64e6ff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.3;
    portal.add(ring);
    portal.traverse((child) => { child.castShadow = true; });
    this.scene.add(portal);
    this.finishPortal = portal;
  }

  spawnBanana(position) {
    const group = new THREE.Group();
    group.position.set(position.x, 0.18, position.z);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffd84d, roughness: 0.5 });
    const stem = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.09, 6, 12, Math.PI * 1.25), yellow);
    stem.rotation.z = 0.8;
    group.add(stem);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4d2c1e }));
    tip.position.set(0.23, 0.05, 0);
    group.add(tip);
    this.scene.add(group);
    const banana = { group, position: new THREE.Vector3(position.x, 0, position.z), ttl: 18, consumed: false };
    this.bananas.push(banana);
    return banana;
  }

  addCoin(position) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y ?? 0.9, position.z);
    const material = new THREE.MeshStandardMaterial({
      color: position.value > 1 ? 0xfff28a : 0xffd84d,
      emissive: 0xff9f22,
      emissiveIntensity: 0.45,
      metalness: 0.5,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.11, 8, 16), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    group.add(mesh);
    this.scene.add(group);
    const coin = { group, mesh, position: new THREE.Vector3(position.x, position.y ?? 0.9, position.z), value: position.value || 1, collected: false };
    this.coins.push(coin);
    return coin;
  }

  addLaser(position, { length = 8, speed = 1.5, phase = 0, color = 0xff4d6d } = {}) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(length * 2, 0.18, 0.24),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, transparent: true, opacity: 0.92 }),
    );
    beam.castShadow = true;
    group.add(beam);
    this.scene.add(group);
    const laser = { group, beam, position: new THREE.Vector3(position.x, position.y, position.z), length, speed, phase };
    this.lasers.push(laser);
    return laser;
  }

  getModifiers(player) {
    const modifier = { onIce: false, conveyor: null };
    for (const zone of this.iceZones) if (inZone(zone, player)) modifier.onIce = true;
    for (const zone of this.conveyorZones) if (inZone(zone, player)) modifier.conveyor = zone.velocity;
    return modifier;
  }

  update(dt, players) {
    this.tick += 1;
    this.elapsed += dt;
    for (const block of this.movingBlocks) {
      const offset = Math.sin(this.elapsed * block.frequency + block.phase) * block.amplitude;
      if (block.axis === 'z') {
        block.body.position.z = block.base.z + offset;
        block.mesh.position.z = block.body.position.z;
      } else {
        block.body.position.x = block.base.x + offset;
        block.mesh.position.x = block.body.position.x;
      }
    }
    for (const bumper of this.bumpers) {
      bumper.group.rotation.y += bumper.speed * dt;
      bumper.body.quaternion.setFromEuler(0, bumper.group.rotation.y, 0);
      for (const player of players) {
        if (player.state === 'ragdoll') continue;
        const dx = player.position.x - bumper.position.x;
        const dz = player.position.z - bumper.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < bumper.radius + 0.62) {
          const last = bumper.cooldowns.get(player.id) || -Infinity;
          if (this.tick - last < 18) continue;
          bumper.cooldowns.set(player.id, this.tick);
          const length = distance || 1;
          const radial = new CANNON.Vec3((dx / length) * (8 + bumper.speed * 1.5), 2.5, (dz / length) * (8 + bumper.speed * 1.5));
          player.onImpact(radial, 'spinning bumper');
        }
      }
    }

    for (const tile of this.hexTiles) {
      if (tile.disabled) continue;
      for (const player of players) {
        if (tile.triggered || player.state === 'ragdoll') continue;
        const distance = Math.hypot(player.position.x - tile.center.x, player.position.z - tile.center.z);
        if (distance < tile.radius * 0.84 && player.position.y < 2.2) {
          tile.triggered = true;
          tile.triggerTimer = 0;
          tile.material.color.setHex(0xffdb4a);
        }
      }
      if (tile.triggered) {
        tile.triggerTimer += dt;
        if (tile.triggerTimer > 0.4 && tile.triggerTimer <= 0.8) tile.material.color.setHex(0xff4f52);
        if (tile.triggerTimer > 0.8) {
          tile.disabled = true;
          tile.mesh.visible = false;
          this.world.removeBody(tile.body);
        }
      }
    }

    for (const laser of this.lasers) {
      laser.group.rotation.y = laser.phase + this.elapsed * laser.speed;
      const angle = laser.group.rotation.y;
      const direction = { x: Math.cos(angle), z: Math.sin(angle) };
      for (const player of players) {
        if (player.state === 'ragdoll' || player.finished) continue;
        const dx = player.position.x - laser.position.x;
        const dz = player.position.z - laser.position.z;
        const along = dx * direction.x + dz * direction.z;
        const across = Math.abs(dx * direction.z - dz * direction.x);
        if (Math.abs(along) < laser.length && across < 0.75 && player.position.y < laser.position.y + 1.15) {
          const last = laser.hitCooldowns?.get(player.id) || -Infinity;
          if (!laser.hitCooldowns) laser.hitCooldowns = new Map();
          if (this.tick - last >= 24) {
            laser.hitCooldowns.set(player.id, this.tick);
            player.onImpact(new CANNON.Vec3(direction.x * 8, 3.2, direction.z * 8), 'laser beam');
          }
        }
      }
    }

    for (const coin of this.coins) {
      if (coin.collected) continue;
      coin.group.rotation.y += dt * 3.5;
      for (const player of players) {
        if (player.finished || player.eliminated) continue;
        if (Math.hypot(player.position.x - coin.position.x, player.position.z - coin.position.z) < 0.85 && player.position.y < 2.0) {
          coin.collected = true;
          coin.group.visible = false;
          player.collectionScore = (player.collectionScore || 0) + coin.value;
          break;
        }
      }
    }

    for (const banana of this.bananas) {
      if (banana.consumed) continue;
      banana.ttl -= dt;
      banana.group.rotation.y += dt * 3;
      if (banana.ttl <= 0) banana.consumed = true;
      for (const player of players) {
        if (banana.consumed) break;
        const distance = Math.hypot(player.position.x - banana.position.x, player.position.z - banana.position.z);
        if (distance < 0.72 && player.position.y < 1.5) {
          banana.consumed = true;
          banana.group.visible = false;
          player.enterRagdoll(new CANNON.Vec3(0, 3.2, 0), 'banana peel');
        }
      }
    }
    this.bananas = this.bananas.filter((banana) => !banana.consumed);
    this.coins = this.coins.filter((coin) => !coin.collected);
  }

  hasFinished(player) {
    return player.position.z <= this.finishZ;
  }

  dispose() {
    for (const bumper of this.bumpers) this.world.removeBody(bumper.body);
    for (const block of this.movingBlocks) this.world.removeBody(block.body);
    for (const tile of this.hexTiles) if (!tile.disabled) this.world.removeBody(tile.body);
    if (this.finishPlatform) this.world.removeBody(this.finishPlatform.body);
    for (const banana of this.bananas) banana.group.removeFromParent();
    for (const coin of this.coins) coin.group.removeFromParent();
    for (const laser of this.lasers) laser.group.removeFromParent();
    this.bumpers.length = 0;
    this.movingBlocks.length = 0;
    this.hexTiles.length = 0;
    this.iceZones.length = 0;
    this.conveyorZones.length = 0;
    this.bananas.length = 0;
    this.coins.length = 0;
    this.lasers.length = 0;
  }
}

export function addFloor(world, scene, x, z, width = 20, depth = 12, color = 0x281e62) {
  return makeStaticBox(world, scene, { x, y: -0.25, z }, { x: width, y: 0.5, z: depth }, color, { type: 'floor' });
}

export function addWall(world, scene, x, z, width, depth, height = 1.8, color = 0x3e2d7c) {
  return makeStaticBox(world, scene, { x, y: height / 2, z }, { x: width, y: height, z: depth }, color, { type: 'wall' });
}

export function addMovingBlock(world, scene, position, size, color = 0xff7b57) {
  const block = makeStaticBox(world, scene, position, size, color, { type: 'moving-block' });
  block.base = { ...position };
  // A coordinate-derived phase keeps obstacle presentation deterministic for
  // replay/rollback tests instead of consuming a process-global RNG.
  block.phase = (Math.abs(position.x) * 0.31 + Math.abs(position.z) * 0.017) % (Math.PI * 2);
  return block;
}
