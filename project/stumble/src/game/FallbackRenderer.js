import * as THREE from 'three';

/**
 * The hosted preview can run in a browser without a WebGL context. Keep the
 * game playable there with a lightweight canvas renderer instead of leaving a
 * blank page. The normal build still uses Three.js WebGL whenever available.
 */
export class FallbackRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.pixelRatio = 1;
    this.width = 1;
    this.height = 1;
    this.match = null;
    this.shadowMap = { enabled: false, type: null };
    this.outputColorSpace = THREE.SRGBColorSpace;
    this.toneMapping = THREE.ACESFilmicToneMapping;
    this.toneMappingExposure = 1;
  }

  setPixelRatio(value) {
    this.pixelRatio = Math.max(1, Math.min(2, value || 1));
    this.resizeCanvas();
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.resizeCanvas();
  }

  resizeCanvas() {
    if (!this.context) return;
    this.canvas.width = Math.floor(this.width * this.pixelRatio);
    this.canvas.height = Math.floor(this.height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  render(_scene, _camera, match = this.match) {
    if (!this.context) return;
    const ctx = this.context;
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#120c37');
    gradient.addColorStop(0.55, '#21175a');
    gradient.addColorStop(1, '#0a0820');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.28;
    ctx.fillStyle = 'rgba(77,224,255,.08)';
    ctx.beginPath();
    ctx.moveTo(w * 0.25, horizon);
    ctx.lineTo(w * 0.75, horizon);
    ctx.lineTo(w * 0.98, h);
    ctx.lineTo(w * 0.02, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(112,233,255,.18)';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i += 1) {
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + i * w * 0.034, horizon);
      ctx.lineTo(w * 0.5 + i * w * 0.13, h);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i += 1) {
      const y = horizon + ((h - horizon) * (i / 12) ** 1.8);
      ctx.beginPath();
      ctx.moveTo(w * 0.05, y);
      ctx.lineTo(w * 0.95, y);
      ctx.stroke();
    }

    if (match?.players?.size) {
      const human = match.players.get(1);
      const focusZ = human?.position.z ?? 13;
      const playerList = [...match.players.values()];
      for (const player of playerList) {
        const depth = Math.max(-1, Math.min(1, (player.position.z - focusZ) / 34));
        const scale = 1.16 - depth * 0.34;
        const x = w * 0.5 + (player.position.x / 12) * w * 0.37;
        const y = h * 0.67 + depth * h * 0.37;
        const radius = Math.max(4, 10 * scale);
        ctx.save();
        ctx.globalAlpha = player.finished ? 0.6 : 0.95;
        ctx.fillStyle = player.id === 1 ? '#ffe270' : this.botColor(player.id);
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 0.82, radius, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#17152b';
        ctx.beginPath();
        ctx.ellipse(x, y - radius * 0.22, radius * 0.5, radius * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        if (player.id === 1) {
          ctx.strokeStyle = '#fff7b0';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CANVAS PREVIEW · FULL GAMEPLAY ACTIVE', w / 2, h - 18);
    ctx.restore();
  }

  botColor(id) {
    const colors = ['#ff4d6d', '#55d68a', '#58a6ff', '#bf7bff', '#ff6fcf', '#42d6d6', '#ff865e'];
    return colors[id % colors.length];
  }
}
