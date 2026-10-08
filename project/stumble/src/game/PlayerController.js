import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  GRAVITY, IMPACT_THRESHOLD, JUMP_VELOCITY, MOVE_ACCELERATION, PLAYER_HEIGHT, PLAYER_RADIUS,
  RAGDOLL_DURATION, SLIDE_DURATION, TOP_SPEED, clamp,
} from './constants.js';

export const PlayerState = Object.freeze({ NORMAL: 'normal', DIVE: 'dive', SLIDE: 'slide', RAGDOLL: 'ragdoll' });

function makeCapsuleParts(body, radius, totalHeight) {
  const straightHeight = Math.max(0.08, totalHeight - radius * 2);
  const cylinder = new CANNON.Cylinder(radius, radius, straightHeight, 10);
  const top = new CANNON.Sphere(radius);
  const bottom = new CANNON.Sphere(radius);
  body.addShape(cylinder);
  body.addShape(top, new CANNON.Vec3(0, straightHeight / 2, 0));
  body.addShape(bottom, new CANNON.Vec3(0, -straightHeight / 2, 0));
  return { cylinder, top, bottom };
}

export function createCapsuleBody(world, position, id) {
  const body = new CANNON.Body({ mass: 1, material: new CANNON.Material('player') });
  body.position.set(position.x, position.y, position.z);
  body.userData = { type: 'player', entityId: id };
  makeCapsuleParts(body, PLAYER_RADIUS, PLAYER_HEIGHT);
  body.linearDamping = 0.08;
  body.angularDamping = 0.55;
  body.allowSleep = false;
  body.angularFactor.set(0, 1, 0);
  world.addBody(body);
  return body;
}

export function createPlayerVisual(color, id) {
  const group = new THREE.Group();
  group.name = `stumbler-${id}`;
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.04 });
  const suitDark = new THREE.MeshStandardMaterial({ color: 0x30265a, roughness: 0.62, metalness: 0.04 });
  const visorMaterial = new THREE.MeshStandardMaterial({ color: 0x17152b, roughness: 0.12, metalness: 0.38, emissive: 0x0b0920, emissiveIntensity: 0.24 });

  // Low-poly capsule body: the silhouette is deliberately chunky and readable
  // at race-camera distance, while remaining a real Three.js mesh.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.4, 5, 12), suit);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.255, 16, 10), visorMaterial);
  visor.scale.set(1.2, 0.62, 0.26);
  visor.position.set(0, 0.18, -0.315);
  visor.castShadow = true;
  group.add(visor);

  const eyeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.018), new THREE.MeshBasicMaterial({ color: 0x9ff8ff }));
  eyeGlow.position.set(0, 0.2, -0.382);
  group.add(eyeGlow);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.28, 3, 7), suit);
  const rightArm = leftArm.clone();
  leftArm.position.set(-0.43, -0.02, 0);
  rightArm.position.set(0.43, -0.02, 0);
  leftArm.rotation.z = -0.18;
  rightArm.rotation.z = 0.18;
  leftArm.castShadow = rightArm.castShadow = true;
  group.add(leftArm, rightArm);

  const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.16, 0.42), suitDark);
  const rightFoot = leftFoot.clone();
  leftFoot.position.set(-0.22, -0.56, -0.07);
  rightFoot.position.set(0.22, -0.56, -0.07);
  leftFoot.castShadow = rightFoot.castShadow = true;
  group.add(leftFoot, rightFoot);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.43, 0.18), suitDark);
  backpack.position.set(0, 0.02, 0.32);
  backpack.castShadow = true;
  group.add(backpack);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.025, 6, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.59;
  group.add(ring);
  group.userData.rig = { body, leftArm, rightArm, leftFoot, rightFoot, visor, eyeGlow, backpack, ring };
  return group;
}

export class PlayerController {
  constructor({ world, scene, id, position, color = 0x58a6ff, isBot = false, skill = 0.75 }) {
    this.id = id;
    this.isBot = isBot;
    this.skill = skill;
    this.world = world;
    this.body = createCapsuleBody(world, position, id);
    this.mesh = createPlayerVisual(color, id);
    this.mesh.position.copy(position);
    scene.add(this.mesh);
    this.state = PlayerState.NORMAL;
    this.stateTime = 0;
    this.diveUsed = false;
    this.grounded = false;
    this.lastGrounded = false;
    this.recovery = 0;
    this.currentInput = { x: 0, y: 0 };
    this.animationTime = 0;
    this.yaw = 0;
    this.desiredYaw = 0;
    this.slideVelocity = new CANNON.Vec3();
    this.stunReason = '';
    this.finished = false;
    this.eliminated = false;
    this.abilityCooldown = 0;
    this.shieldTimer = 0;
    this.finishSlot = 0;
    this.baseShapes = null;
    this.setColliderProfile(PLAYER_HEIGHT);
  }

  setColliderProfile(totalHeight) {
    while (this.body.shapes.length) this.body.removeShape(this.body.shapes[0]);
    this.baseShapes = makeCapsuleParts(this.body, PLAYER_RADIUS, totalHeight);
    this.body.updateBoundingRadius();
  }

  get position() { return this.body.position; }
  get velocity() { return this.body.velocity; }
  get forward() {
    const dir = new THREE.Vector3(this.currentInput.x, 0, -this.currentInput.y);
    if (dir.lengthSq() < 0.05) dir.set(this.body.velocity.x, 0, this.body.velocity.z);
    if (dir.lengthSq() < 0.05) dir.set(0, 0, -1);
    return dir.normalize();
  }

  updateGrounded(context) {
    const safeHeight = context?.groundProbeY ?? 0;
    this.lastGrounded = this.grounded;
    this.grounded = this.body.position.y <= safeHeight + 0.78 && this.body.velocity.y <= 2.0;
    if (this.grounded && !this.lastGrounded) this.diveUsed = false;
  }

  setUprightRotation() {
    this.body.angularFactor.set(0, 1, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.yaw = Math.atan2(-this.forward.x, -this.forward.z);
    this.desiredYaw = this.yaw;
    this.body.quaternion.setFromEuler(0, this.yaw, 0);
  }

  updateFacing(inputDirection, dt) {
    if (inputDirection.lengthSq() < 0.025) return;
    this.desiredYaw = Math.atan2(-inputDirection.x, -inputDirection.z);
    let delta = this.desiredYaw - this.yaw;
    delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
    this.yaw += delta * Math.min(1, dt * 14);
    this.body.quaternion.setFromEuler(0, this.yaw, 0);
  }

  startDive() {
    if (this.state === PlayerState.RAGDOLL || this.diveUsed) return false;
    this.diveUsed = true;
    this.state = PlayerState.DIVE;
    this.stateTime = 0;
    this.setColliderProfile(0.78);
    const fwd = this.forward;
    this.body.velocity.x = fwd.x * TOP_SPEED * 1.3;
    this.body.velocity.z = fwd.z * TOP_SPEED * 1.3;
    this.body.velocity.y = Math.min(this.body.velocity.y, 1.0);
    return true;
  }

  enterRagdoll(impulse = new CANNON.Vec3(), reason = 'impact') {
    if (this.shieldTimer > 0) return false;
    if (this.state === PlayerState.RAGDOLL && this.stateTime < RAGDOLL_DURATION) {
      this.body.applyImpulse(impulse);
      return;
    }
    this.state = PlayerState.RAGDOLL;
    this.stateTime = 0;
    this.stunReason = reason;
    this.recovery = 0;
    this.body.angularFactor.set(1, 1, 1);
    this.body.applyImpulse(impulse);
    this.body.wakeUp();
  }

  onImpact(impulse, reason = 'collision') {
    const strength = Math.hypot(impulse.x, impulse.y, impulse.z);
    if (strength >= IMPACT_THRESHOLD) this.enterRagdoll(impulse, reason);
    else this.body.applyImpulse(impulse);
  }

  startSlideKick() {
    if (this.state === PlayerState.RAGDOLL) return false;
    this.state = PlayerState.SLIDE;
    this.stateTime = 0;
    this.setColliderProfile(0.78);
    const fwd = this.forward;
    this.slideVelocity.set(fwd.x * TOP_SPEED * 1.55, 0.1, fwd.z * TOP_SPEED * 1.55);
    this.body.velocity.copy(this.slideVelocity);
    return true;
  }

  lockAtFinish(finishZ, slot = 0) {
    if (this.finished) return;
    this.finished = true;
    this.finishSlot = slot;
    this.state = PlayerState.NORMAL;
    this.stateTime = 0;
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.angularFactor.set(0, 0, 0);
    this.body.type = CANNON.Body.KINEMATIC;
    this.body.mass = 0;
    this.body.updateMassProperties();
    this.body.position.x = clamp((slot - 3.5) * 1.5, -6.2, 6.2);
    this.body.position.z = finishZ - 3.2 - Math.floor(slot / 8) * 1.2;
    this.body.position.y = Math.max(this.body.position.y, 0.78);
  }

  recoverFromRagdoll() {
    this.state = PlayerState.NORMAL;
    this.stateTime = 0;
    this.stunReason = '';
    this.setColliderProfile(PLAYER_HEIGHT);
    this.body.position.y = Math.max(this.body.position.y, 0.78);
    this.setUprightRotation();
    this.diveUsed = false;
  }

  simulate(input, dt, context = {}) {
    this.currentInput = input;
    this.animationTime += dt;
    this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    if (this.finished || this.eliminated) {
      this.body.velocity.set(0, 0, 0);
      this.body.angularVelocity.set(0, 0, 0);
      this.syncVisual();
      return;
    }
    this.stateTime += dt;
    this.updateGrounded(context);

    if (this.state === PlayerState.RAGDOLL) {
      this.body.angularFactor.set(1, 1, 1);
      if (this.stateTime >= RAGDOLL_DURATION && this.grounded && this.body.velocity.length() < 0.8) {
        this.recovery = clamp(this.recovery + dt * 7, 0, 1);
        this.mesh.quaternion.slerp(new THREE.Quaternion(), Math.min(1, dt * 7));
        if (this.recovery >= 1) this.recoverFromRagdoll();
      }
      this.syncVisual();
      return;
    }

    this.body.angularFactor.set(0, 1, 0);
    this.body.angularVelocity.x = 0;
    this.body.angularVelocity.z = 0;

    if (this.state === PlayerState.SLIDE) {
      this.updateFacing(new THREE.Vector3(input.x, 0, -input.y), dt);
      const f = this.forward;
      const friction = context.onIce ? 0.992 : 0.86;
      this.body.velocity.x = this.body.velocity.x * friction + f.x * TOP_SPEED * 0.14;
      this.body.velocity.z = this.body.velocity.z * friction + f.z * TOP_SPEED * 0.14;
      if (this.stateTime >= SLIDE_DURATION) {
        this.state = PlayerState.NORMAL;
        this.stateTime = 0;
        this.setColliderProfile(PLAYER_HEIGHT);
      }
      this.syncVisual();
      return;
    }

    if (this.state === PlayerState.DIVE) {
      this.updateFacing(new THREE.Vector3(input.x, 0, -input.y), dt);
      const f = this.forward;
      this.body.velocity.x = this.body.velocity.x * 0.992 + f.x * TOP_SPEED * 0.025;
      this.body.velocity.z = this.body.velocity.z * 0.992 + f.z * TOP_SPEED * 0.025;
      if (this.grounded || this.stateTime > 0.8) {
        this.state = PlayerState.SLIDE;
        this.stateTime = 0;
      }
      this.syncVisual();
      return;
    }

    const inputDirection = new THREE.Vector3(input.x, 0, -input.y);
    if (inputDirection.lengthSq() > 1) inputDirection.normalize();
    this.updateFacing(inputDirection, dt);
    const speedScale = context.speedScale ?? 1;
    const acceleration = (context.onIce ? MOVE_ACCELERATION / 5 : MOVE_ACCELERATION) * dt;
    const targetX = inputDirection.x * TOP_SPEED * speedScale;
    const targetZ = inputDirection.z * TOP_SPEED * speedScale;
    this.body.velocity.x = THREE.MathUtils.lerp(this.body.velocity.x, targetX, Math.min(1, acceleration));
    this.body.velocity.z = THREE.MathUtils.lerp(this.body.velocity.z, targetZ, Math.min(1, acceleration));

    if (this.grounded && input.jumpPressed) {
      this.body.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
    } else if (!this.grounded && input.jumpPressed) {
      this.startDive();
    }

    if (context.conveyor) {
      this.body.velocity.x += context.conveyor.x * dt;
      this.body.velocity.z += context.conveyor.z * dt;
    }
    this.syncVisual();
  }

  animateVisual() {
    const rig = this.mesh.userData.rig;
    if (!rig) return;
    const horizontalSpeed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const running = this.grounded && this.state === PlayerState.NORMAL && horizontalSpeed > 0.35;
    const stride = running ? Math.sin(this.animationTime * (8 + horizontalSpeed * 1.3)) * Math.min(0.48, horizontalSpeed / TOP_SPEED * 0.48) : 0;
    const bounce = running ? Math.abs(Math.sin(this.animationTime * (8 + horizontalSpeed * 1.3))) * 0.035 : 0;
    rig.leftArm.rotation.x = stride * 0.78;
    rig.rightArm.rotation.x = -stride * 0.78;
    rig.leftFoot.rotation.x = -stride * 0.55;
    rig.rightFoot.rotation.x = stride * 0.55;
    rig.body.scale.y = 1 + bounce;
    rig.visor.position.y = 0.18 + bounce * 0.35;
    rig.eyeGlow.position.y = 0.2 + bounce * 0.35;

    if (this.state === PlayerState.RAGDOLL) {
      rig.leftArm.rotation.z = -0.8 + Math.sin(this.animationTime * 8) * 0.2;
      rig.rightArm.rotation.z = 0.8 - Math.sin(this.animationTime * 7) * 0.2;
      rig.leftFoot.rotation.z = Math.sin(this.animationTime * 6) * 0.35;
      rig.rightFoot.rotation.z = -Math.sin(this.animationTime * 6) * 0.35;
    } else if (this.state === PlayerState.DIVE || this.state === PlayerState.SLIDE) {
      rig.leftArm.rotation.z = -0.55;
      rig.rightArm.rotation.z = 0.55;
      rig.leftFoot.rotation.x = 0.25;
      rig.rightFoot.rotation.x = 0.25;
    } else {
      rig.leftArm.rotation.z = -0.18;
      rig.rightArm.rotation.z = 0.18;
    }
  }

  syncVisual() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
    if (this.state === PlayerState.DIVE) this.mesh.rotateX(-Math.PI / 2);
    if (this.state === PlayerState.SLIDE) this.mesh.rotateX(-Math.PI / 2);
    this.mesh.position.y -= 0.02;
    this.animateVisual();
  }

  dispose() {
    this.world.removeBody(this.body);
    this.mesh.parent?.remove(this.mesh);
    this.body.shapes.length = 0;
  }
}
