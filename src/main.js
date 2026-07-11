import './style.css';

const canvas = document.querySelector('#gooCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const app = document.querySelector('#app');
const topbar = document.querySelector('.topbar');
const playground = document.querySelector('#playground');
const makerPanel = document.querySelector('#makerPanel');
const welcomeCard = document.querySelector('#welcomeCard');
const hintBubble = document.querySelector('#hintBubble');
const soundButton = document.querySelector('#soundButton');
const resetButton = document.querySelector('#resetButton');
const exitPlayButton = document.querySelector('#exitPlayButton');

makerPanel.classList.add('before-start');
makerPanel.inert = true;
makerPanel.setAttribute('aria-hidden', 'true');
exitPlayButton.inert = true;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;

const themes = {
  berry: {
    name: 'Berry Bounce',
    colors: ['#ff75c5', '#9a42f3', '#6621bd'],
    background: ['#fff3fb', '#f1eaff'],
    shine: 'rgba(255,255,255,.58)',
  },
  lime: {
    name: 'Lime Fizz',
    colors: ['#ddff69', '#55df8d', '#23ad73'],
    background: ['#f7ffe9', '#e4fff5'],
    shine: 'rgba(255,255,224,.65)',
  },
  mango: {
    name: 'Mango Pop',
    colors: ['#ffe064', '#ff8f4c', '#f24770'],
    background: ['#fffbea', '#fff0e7'],
    shine: 'rgba(255,255,238,.62)',
  },
  aqua: {
    name: 'Aqua Wobble',
    colors: ['#74fae8', '#31cce4', '#237ee5'],
    background: ['#efffff', '#e9f5ff'],
    shine: 'rgba(240,255,255,.65)',
  },
  galaxy: {
    name: 'Galaxy Grape',
    colors: ['#b36cff', '#6537d6', '#251347'],
    background: ['#f5efff', '#e9e2ff'],
    shine: 'rgba(255,221,255,.55)',
  },
};

const state = {
  started: false,
  playMode: false,
  step: 'base',
  theme: 'berry',
  mixins: new Set(),
  muted: false,
  pointerBindings: new Map(),
  width: 0,
  height: 0,
  dpr: 1,
  time: 0,
  lastTimestamp: 0,
  hintTimer: 0,
  ripples: [],
  confetti: [],
};

try {
  const saved = JSON.parse(localStorage.getItem('rye-ryes-slime-time-recipe') || localStorage.getItem('goop-lab-recipe') || '{}');
  if (themes[saved.theme]) state.theme = saved.theme;
  if (Array.isArray(saved.mixins)) state.mixins = new Set(saved.mixins.filter((m) => ['sprinkles', 'stars', 'beads', 'glitter'].includes(m)));
  state.muted = saved.muted === true;
} catch {
  // A private browsing mode may not expose local storage. The toy still works.
}

const sprinkleImage = new Image();
sprinkleImage.src = '/candy-sprinkles.jpg';
sprinkleImage.onload = () => render();

class GooAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.lastStretch = 0;
  }

  init() {
    if (state.muted) return;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.makeNoise();
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  makeNoise() {
    const length = Math.floor(this.context.sampleRate * 0.3);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    return buffer;
  }

  blorp(intensity = 0.5, pitch = 1) {
    this.init();
    if (!this.context || state.muted) return;
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const osc = this.context.createOscillator();
    const wobble = this.context.createOscillator();
    const wobbleGain = this.context.createGain();
    const amount = clamp(intensity, 0.1, 1);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(170 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(58 * pitch, now + 0.24);
    wobble.type = 'sine';
    wobble.frequency.value = 23;
    wobbleGain.gain.setValueAtTime(28 * amount, now);
    wobbleGain.gain.exponentialRampToValueAtTime(2, now + 0.22);
    wobble.connect(wobbleGain).connect(osc.frequency);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(720, now);
    filter.frequency.exponentialRampToValueAtTime(170, now + 0.25);
    filter.Q.value = 5;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13 * amount, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(now);
    wobble.start(now);
    osc.stop(now + 0.3);
    wobble.stop(now + 0.3);
  }

  pop(pitch = 1) {
    this.init();
    if (!this.context || state.muted) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(520 * pitch, now + 0.06);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  sprinkle() {
    this.init();
    if (!this.context || state.muted) return;
    [1, 1.26, 1.55].forEach((ratio, index) => {
      const now = this.context.currentTime + index * 0.045;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480 * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(850 * ratio, now + 0.08);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.12);
    });
  }

  stretch(speed) {
    const nowMs = performance.now();
    if (nowMs - this.lastStretch < 90) return;
    this.lastStretch = nowMs;
    this.blorp(clamp(speed / 55, 0.12, 0.5), clamp(1.15 - speed / 140, 0.55, 1.1));
  }
}

const audio = new GooAudio();

function haptic(pattern = 10) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

class SoftBlob {
  constructor() {
    this.points = [];
    this.radius = 100;
    this.targetX = 0;
    this.targetY = 0;
    this.restArea = 1;
    this.seed = 2.31;
  }

  reset(width, height) {
    const count = width < 540 ? 28 : 34;
    this.radius = this.desiredRadius(width, height);
    this.radius = Math.max(76, this.radius);
    this.targetX = width / 2;
    this.targetY = height * (state.playMode ? 0.51 : 0.53);
    this.points = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU - Math.PI / 2;
      const wobble = 1 + Math.sin(i * 2.73 + this.seed) * 0.035 + Math.sin(i * 1.17) * 0.025;
      const r = this.radius * wobble;
      const x = this.targetX + Math.cos(angle) * r;
      const y = this.targetY + Math.sin(angle) * r;
      this.points.push({ x, y, oldX: x, oldY: y, angle, restRadius: r, pinnedBy: null });
    }
    this.restArea = Math.PI * this.radius * this.radius;
    state.pointerBindings.clear();
    state.ripples = [];
  }

  desiredRadius(width, height) {
    return Math.max(76, Math.min(width * (state.playMode ? 0.45 : 0.36), height * (state.playMode ? 0.41 : 0.36), state.playMode ? 310 : 245));
  }

  resize(oldWidth, oldHeight, width, height) {
    if (!oldWidth || !oldHeight || !this.points.length) {
      this.reset(width, height);
      return;
    }
    const oldCenter = this.centroid();
    const nextRadius = this.desiredRadius(width, height);
    const scale = nextRadius / this.radius;
    const nextCenter = { x: width / 2, y: height * (state.playMode ? 0.51 : 0.53) };
    for (const point of this.points) {
      point.x = nextCenter.x + (point.x - oldCenter.x) * scale;
      point.oldX = nextCenter.x + (point.oldX - oldCenter.x) * scale;
      point.y = nextCenter.y + (point.y - oldCenter.y) * scale;
      point.oldY = nextCenter.y + (point.oldY - oldCenter.y) * scale;
      point.restRadius *= scale;
    }
    this.radius = nextRadius;
    this.restArea = Math.PI * this.radius * this.radius;
    this.targetX = width / 2;
    this.targetY = height * (state.playMode ? 0.51 : 0.53);
  }

  centroid() {
    let x = 0;
    let y = 0;
    for (const point of this.points) {
      x += point.x;
      y += point.y;
    }
    return { x: x / this.points.length, y: y / this.points.length };
  }

  area() {
    let sum = 0;
    for (let i = 0; i < this.points.length; i += 1) {
      const a = this.points[i];
      const b = this.points[(i + 1) % this.points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum / 2);
  }

  update(dt) {
    if (!this.points.length) return;
    const frame = clamp(dt / 16.6667, 0.2, 2);
    const damp = prefersReducedMotion ? 0.94 : 0.982;
    const center = this.centroid();
    const centerPull = state.pointerBindings.size ? 0.0008 : 0.0025;

    for (const point of this.points) {
      if (point.pinnedBy !== null) continue;
      const velocityX = (point.x - point.oldX) * damp;
      const velocityY = (point.y - point.oldY) * damp;
      point.oldX = point.x;
      point.oldY = point.y;
      point.x += velocityX * frame + (this.targetX - center.x) * centerPull * frame;
      point.y += velocityY * frame + (this.targetY - center.y) * centerPull * frame;
      if (!prefersReducedMotion && state.pointerBindings.size === 0) {
        point.x += Math.sin(state.time * 0.0013 + point.angle * 3) * 0.035 * frame;
        point.y += Math.cos(state.time * 0.0011 + point.angle * 2) * 0.03 * frame;
      }
    }

    const iterations = state.pointerBindings.size ? 7 : 5;
    for (let pass = 0; pass < iterations; pass += 1) {
      this.applyBindings();
      const currentCenter = this.centroid();
      const targetEdge = (2 * this.radius * Math.sin(Math.PI / this.points.length));

      for (let i = 0; i < this.points.length; i += 1) {
        const a = this.points[i];
        const b = this.points[(i + 1) % this.points.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        const correction = ((distance - targetEdge) / distance) * 0.34;
        const moveX = dx * correction;
        const moveY = dy * correction;
        if (a.pinnedBy === null) { a.x += moveX * 0.5; a.y += moveY * 0.5; }
        if (b.pinnedBy === null) { b.x -= moveX * 0.5; b.y -= moveY * 0.5; }
      }

      const areaError = clamp((this.restArea - this.area()) / this.restArea, -0.32, 0.42);
      for (const point of this.points) {
        if (point.pinnedBy !== null) continue;
        const dx = point.x - currentCenter.x;
        const dy = point.y - currentCenter.y;
        const distance = Math.hypot(dx, dy) || 1;
        const radialError = point.restRadius - distance;
        const pressure = areaError * this.radius * 0.055;
        point.x += (dx / distance) * (radialError * 0.018 + pressure);
        point.y += (dy / distance) * (radialError * 0.018 + pressure);
      }
      this.applyBindings();
    }

    const margin = 7;
    for (const point of this.points) {
      if (point.x < margin) point.x = margin;
      if (point.x > state.width - margin) point.x = state.width - margin;
      if (point.y < margin) point.y = margin;
      if (point.y > state.height - margin) point.y = state.height - margin;
    }
  }

  applyBindings() {
    for (const binding of state.pointerBindings.values()) {
      const point = this.points[binding.index];
      if (!point) continue;
      point.x = binding.x;
      point.y = binding.y;
      point.pinnedBy = binding.pointerId;

      for (let offset = 1; offset <= 2; offset += 1) {
        const falloff = offset === 1 ? 0.22 : 0.08;
        const before = this.points[(binding.index - offset + this.points.length) % this.points.length];
        const after = this.points[(binding.index + offset) % this.points.length];
        if (before.pinnedBy === null) {
          before.x = lerp(before.x, binding.x, falloff);
          before.y = lerp(before.y, binding.y, falloff);
        }
        if (after.pinnedBy === null) {
          after.x = lerp(after.x, binding.x, falloff);
          after.y = lerp(after.y, binding.y, falloff);
        }
      }
    }
  }

  findPoint(x, y) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    this.points.forEach((point, index) => {
      if (point.pinnedBy !== null) return;
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return { index: bestIndex, distance: bestDistance };
  }

  poke(x, y, strength = 18) {
    const center = this.centroid();
    this.points.forEach((point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance > this.radius * 1.1) return;
      const weight = 1 - distance / (this.radius * 1.1);
      const dx = point.x - x || point.x - center.x;
      const dy = point.y - y || point.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      point.oldX = point.x + (dx / length) * strength * weight;
      point.oldY = point.y + (dy / length) * strength * weight;
    });
    state.ripples.push({ x, y, radius: 3, alpha: 0.65 });
  }
}

const blob = new SoftBlob();

function roundedBlobPath(context, points, offsetX = 0, offsetY = 0) {
  if (!points.length) return;
  const last = points[points.length - 1];
  const first = points[0];
  context.beginPath();
  context.moveTo((last.x + first.x) / 2 + offsetX, (last.y + first.y) / 2 + offsetY);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const next = points[(i + 1) % points.length];
    context.quadraticCurveTo(point.x + offsetX, point.y + offsetY, (point.x + next.x) / 2 + offsetX, (point.y + next.y) / 2 + offsetY);
  }
  context.closePath();
}

function drawBackdrop() {
  const theme = themes[state.theme];
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, theme.background[0]);
  gradient.addColorStop(1, theme.background[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 18; i += 1) {
    const x = ((i * 97.31 + 27) % state.width);
    const y = ((i * 61.73 + 18) % state.height);
    const radius = 1.5 + (i % 4) * 0.8;
    ctx.fillStyle = i % 3 === 0 ? theme.colors[0] : i % 3 === 1 ? theme.colors[1] : '#ff8d42';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawStar(x, y, outer, color, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : outer * 0.45;
    const angle = -Math.PI / 2 + (i / 10) * TAU;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawMixins(center) {
  const scale = blob.radius / 190;
  if (state.mixins.has('sprinkles') && sprinkleImage.complete && sprinkleImage.naturalWidth) {
    const size = blob.radius * 2.35;
    ctx.save();
    ctx.globalAlpha = 0.68;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.drawImage(sprinkleImage, center.x - size / 2, center.y - size / 2, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.48;
    ctx.drawImage(sprinkleImage, center.x - size / 2, center.y - size / 2, size, size);
    ctx.restore();
  }

  if (state.mixins.has('stars')) {
    const placements = [[-.45,-.18,.13], [.23,-.47,.1], [.45,.16,.14], [-.12,.38,.11], [-.35,.48,.08], [.08,.04,.07]];
    placements.forEach(([px, py, size], index) => drawStar(center.x + px * blob.radius, center.y + py * blob.radius, size * blob.radius, index % 2 ? '#fff47c' : '#ff72bd', index * .53));
  }

  if (state.mixins.has('beads')) {
    const placements = [[-.55,-.18], [-.28,.3], [.08,-.43], [.35,.25], [.5,-.08], [.1,.52], [-.05,.04], [.32,-.37]];
    placements.forEach(([px, py], index) => {
      const radius = (8 + index % 3 * 2.2) * scale;
      const bead = ctx.createRadialGradient(center.x + px * blob.radius - radius * .35, center.y + py * blob.radius - radius * .35, 1, center.x + px * blob.radius, center.y + py * blob.radius, radius);
      bead.addColorStop(0, '#fff');
      bead.addColorStop(.18, index % 2 ? '#89fff0' : '#ff99c7');
      bead.addColorStop(1, index % 2 ? '#2fc3c0' : '#d84e99');
      ctx.fillStyle = bead;
      ctx.beginPath();
      ctx.arc(center.x + px * blob.radius, center.y + py * blob.radius, radius, 0, TAU);
      ctx.fill();
    });
  }

  if (state.mixins.has('glitter')) {
    ctx.save();
    for (let i = 0; i < 30; i += 1) {
      const angle = i * 2.39996;
      const distance = blob.radius * (.18 + ((i * 37) % 70) / 100);
      const x = center.x + Math.cos(angle) * distance;
      const y = center.y + Math.sin(angle) * distance;
      const pulse = prefersReducedMotion ? 1 : .65 + Math.sin(state.time * .004 + i) * .35;
      ctx.globalAlpha = .35 + pulse * .5;
      ctx.fillStyle = i % 3 ? '#fff' : '#ffe879';
      drawStar(x, y, (1.8 + i % 4) * scale * pulse, ctx.fillStyle, angle);
    }
    ctx.restore();
  }
}

function renderBlob() {
  if (!blob.points.length) return;
  const theme = themes[state.theme];
  const center = blob.centroid();

  ctx.save();
  ctx.filter = `blur(${Math.max(8, blob.radius * .07)}px)`;
  ctx.globalAlpha = 0.22;
  roundedBlobPath(ctx, blob.points, 0, blob.radius * .12);
  ctx.fillStyle = theme.colors[2];
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedBlobPath(ctx, blob.points);
  const fill = ctx.createRadialGradient(center.x - blob.radius * .38, center.y - blob.radius * .42, blob.radius * .08, center.x, center.y, blob.radius * 1.12);
  fill.addColorStop(0, theme.colors[0]);
  fill.addColorStop(.5, theme.colors[1]);
  fill.addColorStop(1, theme.colors[2]);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  drawMixins(center);

  const glaze = ctx.createLinearGradient(center.x - blob.radius, center.y - blob.radius, center.x + blob.radius, center.y + blob.radius);
  glaze.addColorStop(0, 'rgba(255,255,255,.2)');
  glaze.addColorStop(.45, 'rgba(255,255,255,0)');
  glaze.addColorStop(1, 'rgba(30,0,70,.18)');
  ctx.fillStyle = glaze;
  ctx.fillRect(center.x - blob.radius * 1.8, center.y - blob.radius * 1.8, blob.radius * 3.6, blob.radius * 3.6);
  ctx.restore();

  ctx.save();
  roundedBlobPath(ctx, blob.points);
  ctx.strokeStyle = 'rgba(255,255,255,.34)';
  ctx.lineWidth = Math.max(1.5, blob.radius * .012);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(center.x - blob.radius * .29, center.y - blob.radius * .33);
  ctx.rotate(-.5);
  ctx.scale(1.9, .72);
  const shine = ctx.createRadialGradient(0, 0, 0, 0, 0, blob.radius * .18);
  shine.addColorStop(0, theme.shine);
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(0, 0, blob.radius * .18, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawEffects(dt = 16.6667) {
  for (let i = state.ripples.length - 1; i >= 0; i -= 1) {
    const ripple = state.ripples[i];
    ripple.radius += dt * 0.075;
    ripple.alpha -= dt * 0.0016;
    if (ripple.alpha <= 0) {
      state.ripples.splice(i, 1);
      continue;
    }
    ctx.strokeStyle = `rgba(255,255,255,${ripple.alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, ripple.radius, 0, TAU);
    ctx.stroke();
  }

  for (let i = state.confetti.length - 1; i >= 0; i -= 1) {
    const item = state.confetti[i];
    item.x += item.vx * (dt / 16.6667);
    item.y += item.vy * (dt / 16.6667);
    item.vy += .08 * (dt / 16.6667);
    item.life -= dt;
    if (item.life <= 0) {
      state.confetti.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = clamp(item.life / 500, 0, 1);
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function render(dt = 16.6667) {
  if (!state.width || !state.height) return;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  drawBackdrop();
  renderBlob();
  drawEffects(dt);
}

function update(dt = 16.6667) {
  state.time += dt;
  blob.update(dt);
}

function frame(timestamp) {
  const dt = state.lastTimestamp ? clamp(timestamp - state.lastTimestamp, 8, 34) : 16.6667;
  state.lastTimestamp = timestamp;
  update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const oldWidth = state.width;
  const oldHeight = state.height;
  state.width = Math.max(1, rect.width);
  state.height = Math.max(1, rect.height);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  blob.resize(oldWidth, oldHeight, state.width, state.height);
  render();
}

function canvasPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function insideBlob(x, y) {
  const center = blob.centroid();
  return Math.hypot(x - center.x, y - center.y) < blob.radius * 1.1;
}

function pointerDown(event) {
  if (!state.started) return;
  event.preventDefault();
  audio.init();
  const position = canvasPosition(event);
  const nearest = blob.findPoint(position.x, position.y);
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic test events and a few older touch browsers do not expose capture.
  }

  if (nearest.distance < blob.radius * .78 || insideBlob(position.x, position.y)) {
    const point = blob.points[nearest.index];
    point.pinnedBy = event.pointerId;
    state.pointerBindings.set(event.pointerId, {
      pointerId: event.pointerId,
      index: nearest.index,
      x: position.x,
      y: position.y,
      lastX: position.x,
      lastY: position.y,
      speed: 0,
      velocityX: 0,
      velocityY: 0,
    });
    blob.poke(position.x, position.y, 11 + (event.pressure || .5) * 12);
    audio.blorp(.42 + (event.pressure || .4) * .25, .95 + Math.random() * .15);
    haptic(10);
  } else {
    blob.poke(position.x, position.y, 25);
    audio.pop(.85);
  }
  hideHint();
}

function pointerMove(event) {
  const binding = state.pointerBindings.get(event.pointerId);
  if (!binding) return;
  event.preventDefault();
  const position = canvasPosition(event);
  const dx = position.x - binding.lastX;
  const dy = position.y - binding.lastY;
  binding.speed = Math.hypot(dx, dy);
  binding.velocityX = dx;
  binding.velocityY = dy;
  binding.x = clamp(position.x, 3, state.width - 3);
  binding.y = clamp(position.y, 3, state.height - 3);
  binding.lastX = position.x;
  binding.lastY = position.y;
  if (binding.speed > 7) audio.stretch(binding.speed);
  if (binding.speed > 15 && Math.random() > .7) haptic(4);
}

function pointerUp(event) {
  const binding = state.pointerBindings.get(event.pointerId);
  if (!binding) return;
  const point = blob.points[binding.index];
  if (point) {
    point.pinnedBy = null;
    const kick = clamp(binding.speed, 0, 28) * .55;
    point.oldX = point.x - binding.velocityX * kick;
    point.oldY = point.y - binding.velocityY * kick;
  }
  state.pointerBindings.delete(event.pointerId);
  audio.blorp(.32, 1.2);
  haptic([5, 18, 7]);
}

function burstConfetti() {
  const center = blob.centroid();
  const palette = ['#ff4f9e', '#7b40f1', '#40ded0', '#ffbd3d', '#fff'];
  for (let i = 0; i < 25; i += 1) {
    const angle = Math.random() * TAU;
    const speed = 1.2 + Math.random() * 3.6;
    state.confetti.push({
      x: center.x + (Math.random() - .5) * blob.radius,
      y: center.y + (Math.random() - .5) * blob.radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.4,
      size: 1.5 + Math.random() * 3.5,
      color: palette[i % palette.length],
      life: 450 + Math.random() * 450,
    });
  }
}

function saveRecipe() {
  try {
    localStorage.setItem('rye-ryes-slime-time-recipe', JSON.stringify({ theme: state.theme, mixins: [...state.mixins], muted: state.muted }));
  } catch {
    // Saving is a bonus; never let it interrupt play.
  }
}

function setStep(step) {
  state.step = step;
  document.querySelectorAll('.step-tab').forEach((button) => {
    const selected = button.dataset.step === step;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('.step-content').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === step));
  audio.pop(step === 'base' ? .9 : step === 'mix' ? 1.1 : 1.3);
  haptic(7);
}

function showHint(message, duration = 1500) {
  clearTimeout(state.hintTimer);
  hintBubble.textContent = message;
  hintBubble.classList.add('show');
  state.hintTimer = window.setTimeout(hideHint, duration);
}

function hideHint() {
  hintBubble.classList.remove('show');
}

function startMaking() {
  audio.init();
  audio.blorp(.65, 1.05);
  haptic([12, 25, 16]);
  state.started = true;
  welcomeCard.classList.add('hidden');
  welcomeCard.inert = true;
  welcomeCard.setAttribute('aria-hidden', 'true');
  makerPanel.classList.remove('before-start');
  makerPanel.inert = false;
  makerPanel.removeAttribute('aria-hidden');
  showHint('1 · Pick your goop!', 1900);
  setTimeout(resizeCanvas, 420);
}

function enterPlayMode() {
  state.playMode = true;
  app.classList.add('full-goo');
  playground.classList.add('play-mode');
  makerPanel.classList.add('play-mode');
  makerPanel.inert = true;
  makerPanel.setAttribute('aria-hidden', 'true');
  topbar.inert = true;
  topbar.setAttribute('aria-hidden', 'true');
  exitPlayButton.inert = false;
  audio.blorp(.9, .75);
  haptic([15, 30, 20, 30, 28]);
  burstConfetti();
  setTimeout(() => {
    resizeCanvas();
    blob.poke(state.width / 2, state.height / 2, 28);
    showHint('Use every finger!', 1900);
  }, 460);
}

function exitPlayMode() {
  state.playMode = false;
  app.classList.remove('full-goo');
  playground.classList.remove('play-mode');
  makerPanel.classList.remove('play-mode');
  makerPanel.inert = false;
  makerPanel.removeAttribute('aria-hidden');
  topbar.inert = false;
  topbar.removeAttribute('aria-hidden');
  exitPlayButton.inert = true;
  audio.pop(.8);
  haptic(8);
  setTimeout(resizeCanvas, 460);
}

function goHome() {
  if (state.playMode) exitPlayMode();
  state.started = false;
  welcomeCard.classList.remove('hidden');
  welcomeCard.inert = false;
  welcomeCard.removeAttribute('aria-hidden');
  makerPanel.classList.add('before-start');
  makerPanel.inert = true;
  makerPanel.setAttribute('aria-hidden', 'true');
  hideHint();
  audio.pop(.75);
}

function resetGoo() {
  blob.reset(state.width, state.height);
  audio.blorp(.7, .7);
  haptic([8, 20, 12]);
  showHint('Fresh goo!', 1000);
}

document.querySelector('#startButton').addEventListener('click', startMaking);
document.querySelector('#squishButton').addEventListener('click', enterPlayMode);
document.querySelector('#homeButton').addEventListener('click', goHome);
exitPlayButton.addEventListener('click', exitPlayMode);
resetButton.addEventListener('click', resetGoo);

soundButton.classList.toggle('sound-muted', state.muted);
soundButton.setAttribute('aria-pressed', String(!state.muted));
soundButton.setAttribute('aria-label', state.muted ? 'Turn sound on' : 'Turn sound off');
soundButton.addEventListener('click', () => {
  state.muted = !state.muted;
  soundButton.classList.toggle('sound-muted', state.muted);
  soundButton.setAttribute('aria-pressed', String(!state.muted));
  soundButton.setAttribute('aria-label', state.muted ? 'Turn sound on' : 'Turn sound off');
  if (!state.muted) audio.pop(1.2);
  haptic(6);
  saveRecipe();
});

document.querySelectorAll('.step-tab').forEach((button) => button.addEventListener('click', () => setStep(button.dataset.step)));

document.querySelectorAll('.goo-choice').forEach((button) => {
  const selected = button.dataset.goo === state.theme;
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    state.theme = button.dataset.goo;
    document.querySelectorAll('.goo-choice').forEach((choice) => {
      const isSelected = choice === button;
      choice.classList.toggle('selected', isSelected);
      choice.setAttribute('aria-pressed', String(isSelected));
    });
    blob.poke(blob.centroid().x, blob.centroid().y, 22);
    audio.blorp(.65, .85 + Math.random() * .35);
    haptic([7, 15, 10]);
    showHint(`${themes[state.theme].name}!`, 1050);
    saveRecipe();
  });
});

document.querySelectorAll('.mix-choice').forEach((button) => {
  const mix = button.dataset.mix;
  const selected = state.mixins.has(mix);
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    if (state.mixins.has(mix)) state.mixins.delete(mix); else state.mixins.add(mix);
    const enabled = state.mixins.has(mix);
    button.classList.toggle('selected', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    if (enabled) {
      burstConfetti();
      audio.sprinkle();
      haptic([5, 18, 5, 18, 8]);
      blob.poke(blob.centroid().x, blob.centroid().y, 18);
      showHint(mix === 'sprinkles' ? 'Sprinkle storm!' : `${button.textContent.trim().replace(/\s+/g, ' ')}!`, 1100);
    } else {
      audio.pop(.7);
      haptic(5);
    }
    saveRecipe();
  });
});

canvas.addEventListener('pointerdown', pointerDown, { passive: false });
canvas.addEventListener('pointermove', pointerMove, { passive: false });
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.tabIndex = 0;
canvas.addEventListener('keydown', (event) => {
  if (!state.started) return;
  const center = blob.centroid();
  const directions = { ArrowLeft: [-25, 0], ArrowRight: [25, 0], ArrowUp: [0, -25], ArrowDown: [0, 25] };
  if (directions[event.key]) {
    event.preventDefault();
    const [x, y] = directions[event.key];
    blob.points.forEach((point) => { point.oldX -= x; point.oldY -= y; });
    audio.blorp(.35, 1);
  }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    blob.poke(center.x, center.y, 28);
    audio.blorp(.7, .85);
    haptic(10);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audio.context?.state === 'suspended' && !state.muted) audio.context.resume();
});

new ResizeObserver(resizeCanvas).observe(playground);
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(frame);

window.render_game_to_text = () => {
  const center = blob.centroid();
  return JSON.stringify({
    coordinateSystem: 'Canvas origin is top-left; x increases right; y increases down; units are CSS pixels.',
    mode: !state.started ? 'welcome' : state.playMode ? 'full-goo' : `making-${state.step}`,
    recipe: { theme: state.theme, themeName: themes[state.theme].name, mixins: [...state.mixins] },
    blob: {
      center: { x: Math.round(center.x), y: Math.round(center.y) },
      restRadius: Math.round(blob.radius),
      points: blob.points.length,
      currentArea: Math.round(blob.area()),
    },
    activeTouches: state.pointerBindings.size,
    sound: state.muted ? 'off' : 'on',
    hapticsAvailable: 'vibrate' in navigator,
  });
};

window.advanceTime = (milliseconds) => {
  const steps = Math.max(1, Math.round(milliseconds / 16.6667));
  for (let i = 0; i < steps; i += 1) update(16.6667);
  render(16.6667);
};
