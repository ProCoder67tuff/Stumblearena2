import { OfflineMatch } from './game/OfflineMatch.js';
import { OnlineMatch } from './game/OnlineMatch.js';
import { OFFLINE_MODES } from './game/constants.js';
import {
  installKeyboardInput, pressVirtualAction, sampleInput, setVirtualAction, setVirtualMove,
} from './game/input.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#game-canvas');
const messageCard = $('#message-card');
const messageTitle = $('#message-title');
const messageBody = $('#message-body');
const messageKicker = document.querySelector('.message-kicker');
const startButton = $('#start-button');
const restartButton = $('#restart-button');
const roundLabel = $('#round-label');
const levelLabel = $('#level-label');
const objectiveLabel = $('#objective-label');
const qualifiedCount = $('#qualified-count');
const timeLeft = $('#time-left');
const placeValue = $('#place-value');
const teamScoreBlock = $('#team-score-block');
const teamScore = $('#team-score');
const progressFill = $('#round-progress');
const toast = $('#toast');
const modePicker = $('#mode-picker');
const modeDescription = $('#mode-description');
const modeCards = [...document.querySelectorAll('.mode-card')];
const playModeButtons = [...document.querySelectorAll('.play-mode-button')];
const onlinePanel = $('#online-panel');
const onlineStatus = $('#online-status');
const displayName = $('#display-name');
const queueButton = $('#queue-button');

installKeyboardInput(window);
let toastTimer = 0;
let selectedMode = 'original';
let playMode = 'offline';
let match;
let onlineMatch;

function formatTime(seconds) {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function getMode(id) {
  return OFFLINE_MODES.find((mode) => mode.id === id) || OFFLINE_MODES[0];
}

function showMessage(kicker, title, body, showButton = false) {
  messageKicker.textContent = kicker;
  messageTitle.textContent = title;
  messageBody.textContent = body;
  messageCard.classList.toggle('visible', showButton);
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function selectMode(modeId) {
  selectedMode = modeId;
  const mode = getMode(modeId);
  for (const card of modeCards) card.classList.toggle('active', card.dataset.mode === modeId);
  modeDescription.textContent = mode.description;
  messageBody.textContent = `${mode.name}: ${mode.description}`;
  levelLabel.textContent = mode.name;
}

function updateHud(state) {
  const modeName = state.modeName || 'Original';
  const totalRounds = state.totalRounds || 3;
  modePicker.classList.toggle('hidden', state.phase !== 'lobby' || playMode !== 'offline');
  if (state.phase === 'queue') {
    roundLabel.textContent = `ONLINE QUEUE · ${state.queueSize || state.entrants || 1}/32`;
    levelLabel.textContent = state.level || 'Waiting room';
    objectiveLabel.textContent = state.objective || 'Searching for an available room…';
    qualifiedCount.textContent = `${state.queueSize || state.entrants || 1} IN ROOM`;
    timeLeft.textContent = state.countdown ? formatTime(state.countdown) : '--:--';
    placeValue.textContent = '--';
    teamScoreBlock.style.display = 'none';
    progressFill.style.width = '0%';
    messageCard.classList.add('visible');
    startButton.style.display = 'none';
    onlinePanel.classList.remove('hidden');
    return;
  }
  if (state.phase === 'lobby') {
    startButton.style.display = 'inline-block';
    onlinePanel.classList.add('hidden');
    roundLabel.textContent = `${modeName.toUpperCase()} · READY`;
    levelLabel.textContent = modeName;
    objectiveLabel.textContent = state.objective || getMode(selectedMode).description;
    qualifiedCount.textContent = `${state.entrants || getMode(selectedMode).entrants} RACERS`;
    timeLeft.textContent = '--:--';
    placeValue.textContent = '--';
    teamScoreBlock.style.display = 'none';
    progressFill.style.width = '0%';
    return;
  }
  roundLabel.textContent = `${modeName.toUpperCase()} · ROUND ${state.round} / ${totalRounds}`;
  levelLabel.textContent = state.level;
  objectiveLabel.textContent = state.objective;
  if (state.mode === 'grand-prix') qualifiedCount.textContent = `${state.score} PTS`;
  else if (state.level === 'Coin Quest') qualifiedCount.textContent = `${state.collectionScore} COINS`;
  else if (state.level === 'Laser Tracer' || state.mode === 'showdown') qualifiedCount.textContent = `${state.alive} LEFT`;
  else qualifiedCount.textContent = `${state.qualified} / ${state.qualifiers}`;
  timeLeft.textContent = formatTime(state.timeLeft);
  placeValue.textContent = state.place ? `#${state.place}` : '--';
  teamScoreBlock.style.display = state.mode === 'teams' ? 'flex' : 'none';
  if (state.mode === 'teams') teamScore.textContent = `${state.teamScores.red}R · ${state.teamScores.blue}B`;
  progressFill.style.width = `${Math.round(state.progress * 100)}%`;
  if (state.phase === 'playing' || state.phase === 'transition') messageCard.classList.remove('visible');
  if (state.phase === 'complete') {
    messageCard.classList.add('visible');
    startButton.disabled = false;
    startButton.textContent = 'PLAY AGAIN  ENTER';
  }
}

function startOffline() {
  if (match.phase === 'complete') {
    window.location.reload();
    return;
  }
  if (match.phase !== 'lobby') return;
  messageCard.classList.remove('visible');
  match.startMatch({ mode: selectedMode });
}

function setPlayMode(nextMode) {
  playMode = nextMode;
  for (const button of playModeButtons) button.classList.toggle('active', button.dataset.playMode === nextMode);
  if (nextMode === 'online') {
    match?.stop();
    modePicker.classList.add('hidden');
    modeDescription.classList.add('hidden');
    onlinePanel.classList.remove('hidden');
    startButton.style.display = 'none';
    messageKicker.textContent = 'WASMER AUTHORITY';
    messageTitle.textContent = 'ONLINE QUEUE';
    messageBody.textContent = 'Find an available waiting room. A second queued player starts the countdown.';
    onlineStatus.textContent = 'The authority will place you into a room with up to 32 players.';
    messageCard.classList.add('visible');
    showToast('ONLINE QUEUE READY');
    return;
  }
  onlinePanel.classList.add('hidden');
  modeDescription.classList.remove('hidden');
  modePicker.classList.remove('hidden');
  startButton.style.display = 'inline-block';
  messageKicker.textContent = 'OFFLINE EVENTS';
  messageTitle.textContent = 'STUMBLE ARENA';
  selectMode(selectedMode);
  messageCard.classList.add('visible');
}

function startOnline() {
  if (!onlineMatch) {
    onlineMatch = new OnlineMatch(canvas, {
      inputProvider: sampleInput,
      onUpdate: updateHud,
      onMessage: (title, body) => {
        showToast(`${title} · ${body}`);
        if (title.includes('CHAMPION') || title === 'MATCH COMPLETE') messageCard.classList.add('visible');
      },
      onStatus: (status) => {
        onlineStatus.textContent = status;
        if (/DISCONNECTED|ERROR|FAILED/i.test(status)) {
          queueButton.disabled = false;
          queueButton.textContent = 'FIND MATCH';
        }
        showToast(status);
      },
    });
  }
  const name = displayName.value.trim() || 'Stumbler';
  queueButton.disabled = true;
  queueButton.textContent = 'SEARCHING…';
  onlineMatch.startQueue(name, 'original');
}

for (const card of modeCards) card.addEventListener('click', () => selectMode(card.dataset.mode));
for (const button of playModeButtons) button.addEventListener('click', () => setPlayMode(button.dataset.playMode));
queueButton.addEventListener('click', startOnline);
startButton.addEventListener('click', startOffline);
restartButton.addEventListener('click', () => window.location.reload());
window.addEventListener('keydown', (event) => {
  if (event.code === 'Enter' && messageCard.classList.contains('visible')) startOffline();
});

// Virtual joystick and buttons feed the same input sampler as keyboard input.
const joystick = $('#virtual-joystick');
const joystickKnob = $('#joystick-knob');
let joystickPointerId = null;
function moveJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  const radius = rect.width * 0.5;
  const dx = event.clientX - (rect.left + radius);
  const dy = event.clientY - (rect.top + radius);
  const limit = radius - 28;
  const distance = Math.min(limit, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const nx = distance > 0 ? Math.cos(angle) * distance / limit : 0;
  const ny = distance > 0 ? Math.sin(angle) * distance / limit : 0;
  joystickKnob.style.transform = `translate(calc(-50% + ${nx * limit}px), calc(-50% + ${ny * limit}px))`;
  setVirtualMove(nx, -ny);
}
function resetJoystick() {
  joystickPointerId = null;
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  setVirtualMove(0, 0);
}
joystick.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  joystickPointerId = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  moveJoystick(event);
});
joystick.addEventListener('pointermove', (event) => {
  if (event.pointerId === joystickPointerId) moveJoystick(event);
});
joystick.addEventListener('pointerup', resetJoystick);
joystick.addEventListener('pointercancel', resetJoystick);
for (const button of document.querySelectorAll('.action-button')) {
  const action = button.dataset.action;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.classList.add('active');
    if (action === 'jump') setVirtualAction(action, true);
    else pressVirtualAction(action);
  });
  const release = () => {
    button.classList.remove('active');
    if (action === 'jump') setVirtualAction(action, false);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

const callbacks = {
  inputProvider: sampleInput,
  onUpdate: updateHud,
  onMessage: (title, body) => {
    if (title.includes('CLASSIC') || title.includes('GRAND PRIX') || title.includes('SHOWDOWN') || title.includes('TEAMS') || title.includes('TIME TRIAL')) {
      showToast(`${title} · ${body}`);
      return;
    }
    if (title.startsWith('ROUND')) {
      messageCard.classList.remove('visible');
      showToast(`${title} · ${body}`);
      return;
    }
    showToast(`${title} · ${body}`);
  },
};

match = new OfflineMatch(canvas, callbacks);
selectMode('original');
showMessage('OFFLINE EVENTS', 'STUMBLE ARENA', 'Choose an event, then race bots through colorful obstacle rounds.', true);
match.start();
