const KEY_TO_ACTION = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  Digit1: 'punch',
  Digit2: 'kick',
  Digit3: 'banana',
  KeyE: 'ability',
};

const pressedOnce = new Set();
const held = new Set();
const virtualPressed = new Set();
const virtualHeld = new Set();
let virtualX = 0;
let virtualY = 0;

export function installKeyboardInput(target = window) {
  target.addEventListener('keydown', (event) => {
    const action = KEY_TO_ACTION[event.code];
    if (!action) return;
    event.preventDefault();
    if (!held.has(action)) pressedOnce.add(action);
    held.add(action);
  }, { passive: false });

  target.addEventListener('keyup', (event) => {
    const action = KEY_TO_ACTION[event.code];
    if (action) held.delete(action);
  });
}

export function setVirtualMove(x, y) {
  virtualX = Math.max(-1, Math.min(1, x));
  virtualY = Math.max(-1, Math.min(1, y));
}

export function pressVirtualAction(action) {
  virtualPressed.add(action);
}

export function setVirtualAction(action, active) {
  if (active) {
    if (!virtualHeld.has(action)) virtualPressed.add(action);
    virtualHeld.add(action);
  } else {
    virtualHeld.delete(action);
  }
}

export function sampleInput(tick) {
  const keyboardX = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  const keyboardY = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
  const x = keyboardX || virtualX;
  const y = keyboardY || virtualY;
  const length = Math.hypot(x, y);
  const input = {
    tick,
    x: length > 1 ? x / length : x,
    y: length > 1 ? y / length : y,
    jumpPressed: pressedOnce.has('jump') || virtualPressed.has('jump'),
    punchPressed: pressedOnce.has('punch') || virtualPressed.has('punch'),
    kickPressed: pressedOnce.has('kick') || virtualPressed.has('kick'),
    bananaPressed: pressedOnce.has('banana') || virtualPressed.has('banana'),
    abilityPressed: pressedOnce.has('ability') || virtualPressed.has('ability'),
  };
  pressedOnce.clear();
  virtualPressed.clear();
  return input;
}

export function emptyInput(tick = 0) {
  return { tick, x: 0, y: 0, jumpPressed: false, punchPressed: false, kickPressed: false, bananaPressed: false, abilityPressed: false };
}

export function sanitizeInput(packet, tick = 0) {
  const x = Number(packet?.x) || 0;
  const y = Number(packet?.y) || 0;
  const length = Math.hypot(x, y) || 1;
  return {
    tick: Number.isInteger(packet?.tick) ? packet.tick : tick,
    x: Math.max(-1, Math.min(1, x / Math.max(1, length))),
    y: Math.max(-1, Math.min(1, y / Math.max(1, length))),
    jumpPressed: packet?.jumpPressed === true,
    punchPressed: packet?.punchPressed === true,
    kickPressed: packet?.kickPressed === true,
    bananaPressed: packet?.bananaPressed === true,
    abilityPressed: packet?.abilityPressed === true,
  };
}
