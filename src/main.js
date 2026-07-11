import WebGLFluidEnhanced from 'webgl-fluid-enhanced';
import './style.css';

const app = document.querySelector('#app');
const topbar = document.querySelector('.topbar');
const playground = document.querySelector('#playground');
const fluidStage = document.querySelector('#fluidStage');
let slimeCanvas = document.querySelector('#slimeCanvas');
const toppingCanvas = document.querySelector('#toppingCanvas');
const toppingContext = toppingCanvas.getContext('2d');
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
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

const themes = {
  berry: {
    name: 'Berry Bounce',
    palette: ['#ff3f91', '#ff79c5', '#a74df4', '#6d24d6', '#ffd0e8'],
    dyePalette: ['#ff297f', '#b03df2', '#5a16c8', '#28d8ca'],
    base: '#58148f',
    accent: '#ff4d9d',
  },
  lime: {
    name: 'Lime Fizz',
    palette: ['#dfff4f', '#7df38d', '#2ed49c', '#f6ffad', '#44b968'],
    dyePalette: ['#dfff4f', '#7df38d', '#2ed49c', '#44b968'],
    base: '#44b96d',
    accent: '#d8ff4d',
  },
  mango: {
    name: 'Mango Pop',
    palette: ['#ffd83f', '#ff9845', '#ff5d70', '#ffbd55', '#fff09a'],
    dyePalette: ['#ffd83f', '#ff9845', '#ff5d70', '#ffbd55'],
    base: '#f06a55',
    accent: '#ffd63f',
  },
  aqua: {
    name: 'Aqua Wobble',
    palette: ['#5ff9e6', '#23d0dc', '#2b91f0', '#b8fff4', '#5b63e7'],
    dyePalette: ['#5ff9e6', '#23d0dc', '#2b91f0', '#5b63e7'],
    base: '#2596c7',
    accent: '#56f6df',
  },
  galaxy: {
    name: 'Galaxy Grape',
    palette: ['#b96cff', '#713edc', '#ff78cf', '#36205f', '#80dfff'],
    dyePalette: ['#b96cff', '#713edc', '#ff78cf', '#36205f', '#80dfff'],
    base: '#382067',
    accent: '#c873ff',
  },
};

const state = {
  started: false,
  playMode: false,
  step: 'base',
  theme: 'berry',
  mixins: new Set(),
  muted: false,
  activePointers: new Map(),
  webglAvailable: true,
  splatCount: 0,
  stirCount: 0,
  interactionEnergy: 0,
  toppingWidth: 0,
  toppingHeight: 0,
  toppingDpr: 1,
  time: 0,
  lastTimestamp: 0,
  hintTimer: 0,
};

try {
  const saved = JSON.parse(localStorage.getItem('rye-ryes-slime-time-recipe') || '{}');
  if (themes[saved.theme]) state.theme = saved.theme;
  if (Array.isArray(saved.mixins)) {
    state.mixins = new Set(saved.mixins.filter((item) => ['sprinkles', 'stars', 'beads', 'glitter'].includes(item)));
  }
  state.muted = saved.muted === true;
} catch {
  // Storage is optional; the simulation must remain playable without it.
}

class SlimeAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.lastDragSound = 0;
    this.textureBurstCount = 0;
  }

  init() {
    if (state.muted) return;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.68;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoise();
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  createNoise() {
    const length = Math.floor(this.context.sampleRate * 0.4);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let smoothed = 0;
    for (let index = 0; index < length; index += 1) {
      smoothed = smoothed * 0.72 + (Math.random() * 2 - 1) * 0.28;
      data[index] = smoothed * (1 - index / length);
    }
    return buffer;
  }

  squelch(intensity = 0.5, pitch = 1) {
    this.init();
    if (!this.context || state.muted) return;
    const now = this.context.currentTime;
    const amount = clamp(intensity, 0.08, 1);
    const oscillator = this.context.createOscillator();
    const wobble = this.context.createOscillator();
    const wobbleGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const noise = this.context.createBufferSource();
    const noiseFilter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(145 * pitch, now);
    oscillator.frequency.exponentialRampToValueAtTime(48 * pitch, now + 0.28);
    wobble.type = 'sine';
    wobble.frequency.value = 19 + amount * 14;
    wobbleGain.gain.setValueAtTime(22 * amount, now);
    wobbleGain.gain.exponentialRampToValueAtTime(1, now + 0.25);
    wobble.connect(wobbleGain).connect(oscillator.frequency);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(680, now);
    filter.frequency.exponentialRampToValueAtTime(115, now + 0.3);
    filter.Q.value = 7;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12 * amount, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.31);

    noise.buffer = this.noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(270 + amount * 230, now);
    noiseFilter.Q.value = 1.2;
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.055 * amount, now + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);

    oscillator.connect(filter).connect(gain).connect(this.master);
    noise.connect(noiseFilter).connect(noiseGain).connect(this.master);
    oscillator.start(now);
    wobble.start(now);
    noise.start(now);
    oscillator.stop(now + 0.32);
    wobble.stop(now + 0.32);
    noise.stop(now + 0.2);
  }

  wetDrag(speed, touches = 1) {
    const nowMs = performance.now();
    if (nowMs - this.lastDragSound < 108) return;
    this.lastDragSound = nowMs;
    this.init();
    if (!this.context || state.muted) return;
    this.textureBurstCount += 1;
    const now = this.context.currentTime;
    const amount = clamp(speed / 30, 0.12, 0.72);
    const goosh = this.context.createBufferSource();
    const gooshFilter = this.context.createBiquadFilter();
    const gooshGain = this.context.createGain();
    const crunch = this.context.createBufferSource();
    const crunchFilter = this.context.createBiquadFilter();
    const crunchGain = this.context.createGain();

    goosh.buffer = this.noiseBuffer;
    goosh.playbackRate.value = 0.5 + amount * 0.42;
    gooshFilter.type = 'lowpass';
    gooshFilter.frequency.value = 165 + amount * 390 + touches * 24;
    gooshFilter.Q.value = 3.4;
    gooshGain.gain.setValueAtTime(0.0001, now);
    gooshGain.gain.exponentialRampToValueAtTime(0.018 + amount * 0.038, now + 0.014);
    gooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    crunch.buffer = this.noiseBuffer;
    crunch.playbackRate.value = 1.55 + Math.random() * 0.65 + amount * 0.4;
    crunchFilter.type = 'bandpass';
    crunchFilter.frequency.value = 980 + amount * 1250 + Math.random() * 360;
    crunchFilter.Q.value = 1.8 + touches * 0.25;
    crunchGain.gain.setValueAtTime(0.0001, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.008 + amount * 0.022, now + 0.005);
    crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.027);
    crunchGain.gain.setValueAtTime(0.0001, now + 0.038);
    crunchGain.gain.exponentialRampToValueAtTime(0.006 + amount * 0.016, now + 0.043);
    crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);

    goosh.connect(gooshFilter).connect(gooshGain).connect(this.master);
    crunch.connect(crunchFilter).connect(crunchGain).connect(this.master);
    goosh.start(now);
    crunch.start(now);
    goosh.stop(now + 0.15);
    crunch.stop(now + 0.08);
  }

  release(speed = 8) {
    this.init();
    if (!this.context || state.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(52 + speed * 1.4, now);
    oscillator.frequency.exponentialRampToValueAtTime(210 + speed * 3, now + 0.12);
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
  }

  sparkle() {
    this.init();
    if (!this.context || state.muted) return;
    [1, 1.24, 1.52].forEach((ratio, index) => {
      const now = this.context.currentTime + index * 0.045;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(430 * ratio, now);
      oscillator.frequency.exponentialRampToValueAtTime(860 * ratio, now + 0.08);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + 0.12);
    });
  }
}

class ToppingLayer {
  constructor(context) {
    this.context = context;
    this.particles = [];
    this.palette = themes[state.theme].palette;
    this.spawnBubbles();
  }

  resize() {
    const bounds = toppingCanvas.getBoundingClientRect();
    state.toppingWidth = Math.max(1, bounds.width);
    state.toppingHeight = Math.max(1, bounds.height);
    state.toppingDpr = Math.min(devicePixelRatio || 1, 2);
    toppingCanvas.width = Math.round(state.toppingWidth * state.toppingDpr);
    toppingCanvas.height = Math.round(state.toppingHeight * state.toppingDpr);
  }

  spawnBubbles() {
    this.particles = this.particles.filter((particle) => particle.type !== 'bubble');
    for (let index = 0; index < (isMobile ? 18 : 28); index += 1) {
      this.particles.push(this.makeParticle('bubble'));
    }
  }

  makeParticle(type) {
    return {
      type,
      x: Math.random(),
      y: Math.random(),
      vx: randomBetween(-0.00008, 0.00008),
      vy: randomBetween(-0.00008, 0.00008),
      angle: Math.random() * TAU,
      spin: randomBetween(-0.0018, 0.0018),
      size: randomBetween(0.65, 1.35),
      color: this.palette[Math.floor(Math.random() * this.palette.length)],
      phase: Math.random() * TAU,
    };
  }

  countFor(type) {
    const mobileCounts = { sprinkles: 54, stars: 14, beads: 28, glitter: 54 };
    const desktopCounts = { sprinkles: 82, stars: 20, beads: 42, glitter: 82 };
    return (isMobile ? mobileCounts : desktopCounts)[type] || 20;
  }

  syncMixins() {
    this.palette = themes[state.theme].palette;
    this.particles = this.particles.filter((particle) => particle.type === 'bubble' || state.mixins.has(particle.type));
    for (const type of state.mixins) {
      const existing = this.particles.filter((particle) => particle.type === type).length;
      const desired = this.countFor(type);
      for (let index = existing; index < desired; index += 1) this.particles.push(this.makeParticle(type));
    }
  }

  stir(x, y, dx, dy, force = 1) {
    const nx = x / state.toppingWidth;
    const ny = y / state.toppingHeight;
    const ndx = dx / state.toppingWidth;
    const ndy = dy / state.toppingHeight;
    const radius = 0.22;
    for (const particle of this.particles) {
      const offsetX = particle.x - nx;
      const offsetY = particle.y - ny;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > radius) continue;
      const influence = (1 - distance / radius) ** 2 * force;
      particle.vx += ndx * influence * 1.9 - offsetY * influence * 0.012;
      particle.vy += ndy * influence * 1.9 + offsetX * influence * 0.012;
      particle.spin += (ndx - ndy) * influence * 0.03;
    }
  }

  burst(type) {
    const centerX = randomBetween(0.25, 0.75);
    const centerY = randomBetween(0.2, 0.8);
    for (const particle of this.particles.filter((item) => item.type === type)) {
      if (Math.random() > 0.65) continue;
      const angle = Math.random() * TAU;
      particle.x = clamp(centerX + Math.cos(angle) * randomBetween(0.01, 0.16), 0.02, 0.98);
      particle.y = clamp(centerY + Math.sin(angle) * randomBetween(0.01, 0.16), 0.02, 0.98);
      particle.vx += Math.cos(angle) * randomBetween(0.0005, 0.0022);
      particle.vy += Math.sin(angle) * randomBetween(0.0005, 0.0022);
    }
  }

  update(milliseconds) {
    const frame = clamp(milliseconds / 16.6667, 0.2, 2.4);
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const ambient = prefersReducedMotion ? 0 : 0.0000025;
      particle.vx += Math.sin(state.time * 0.00034 + particle.phase + particle.y * 7) * ambient * frame;
      particle.vy += Math.cos(state.time * 0.00029 + particle.phase + particle.x * 8) * ambient * frame;
      particle.vx *= 0.982 ** frame;
      particle.vy *= 0.982 ** frame;
      particle.spin *= 0.992 ** frame;
      particle.x += particle.vx * frame;
      particle.y += particle.vy * frame;
      particle.angle += particle.spin * frame;
      if (particle.x < -0.03) particle.x = 1.03;
      if (particle.x > 1.03) particle.x = -0.03;
      if (particle.y < -0.03) particle.y = 1.03;
      if (particle.y > 1.03) particle.y = -0.03;
    }
  }

  drawStar(context, radius) {
    context.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const pointRadius = index % 2 === 0 ? radius : radius * 0.44;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const x = Math.cos(angle) * pointRadius;
      const y = Math.sin(angle) * pointRadius;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
  }

  render() {
    const context = this.context;
    const width = state.toppingWidth;
    const height = state.toppingHeight;
    if (!width || !height) return;
    context.setTransform(state.toppingDpr, 0, 0, state.toppingDpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const unit = Math.min(width, height) / 390;

    for (const particle of this.particles) {
      const x = particle.x * width;
      const y = particle.y * height;
      context.save();
      context.translate(x, y);
      context.rotate(particle.angle);
      context.globalAlpha = particle.type === 'bubble' ? 0.34 : 0.83;

      if (particle.type === 'bubble') {
        const radius = (3.2 + particle.size * 3.4) * unit;
        const gradient = context.createRadialGradient(-radius * 0.35, -radius * 0.38, 0, 0, 0, radius);
        gradient.addColorStop(0, 'rgba(255,255,255,.8)');
        gradient.addColorStop(0.25, 'rgba(255,255,255,.12)');
        gradient.addColorStop(0.72, 'rgba(35,0,70,.08)');
        gradient.addColorStop(1, 'rgba(255,255,255,.38)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.fill();
      } else if (particle.type === 'sprinkles') {
        const length = (8 + particle.size * 7) * unit;
        const thickness = (2.3 + particle.size * 1.5) * unit;
        context.shadowColor = 'rgba(50,0,70,.25)';
        context.shadowBlur = 4 * unit;
        context.shadowOffsetY = 2 * unit;
        context.fillStyle = particle.color;
        context.beginPath();
        context.roundRect(-length / 2, -thickness / 2, length, thickness, thickness);
        context.fill();
        context.globalAlpha = 0.34;
        context.fillStyle = '#fff';
        context.fillRect(-length * 0.28, -thickness * 0.26, length * 0.42, thickness * 0.2);
      } else if (particle.type === 'stars') {
        const radius = (6.5 + particle.size * 5.2) * unit;
        context.shadowColor = 'rgba(60,0,80,.28)';
        context.shadowBlur = 5 * unit;
        context.shadowOffsetY = 2 * unit;
        context.fillStyle = particle.color;
        this.drawStar(context, radius);
        context.fill();
      } else if (particle.type === 'beads') {
        const radius = (4.2 + particle.size * 3.6) * unit;
        const gradient = context.createRadialGradient(-radius * 0.4, -radius * 0.42, 0, 0, 0, radius);
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(0.18, particle.color);
        gradient.addColorStop(1, 'rgba(60,16,88,.72)');
        context.fillStyle = gradient;
        context.shadowColor = 'rgba(35,0,55,.25)';
        context.shadowBlur = 4 * unit;
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.fill();
      } else if (particle.type === 'glitter') {
        const radius = (2.2 + particle.size * 3.2) * unit * (0.8 + Math.sin(state.time * 0.006 + particle.phase) * 0.2);
        context.globalAlpha = 0.4 + Math.sin(state.time * 0.007 + particle.phase) * 0.3;
        context.fillStyle = Math.sin(particle.phase) > 0 ? '#fff6a8' : '#fff';
        this.drawStar(context, radius);
        context.fill();
      }
      context.restore();
    }
  }
}

const audio = new SlimeAudio();
const toppings = new ToppingLayer(toppingContext);
let fluid = null;
const seedTimers = new Set();

function clearSeedTimers() {
  seedTimers.forEach((timer) => clearTimeout(timer));
  seedTimers.clear();
}

function scheduleSeed(callback, delay) {
  const timer = window.setTimeout(() => {
    seedTimers.delete(timer);
    callback();
  }, delay);
  seedTimers.add(timer);
}

function haptic(pattern = 10) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function resetViewportOrigin() {
  window.scrollTo(0, 0);
  app.scrollTo(0, 0);
}

function fluidConfig() {
  const theme = themes[state.theme];
  return {
    simResolution: isMobile ? 128 : 196,
    dyeResolution: isMobile ? 512 : 1024,
    densityDissipation: 0.16,
    velocityDissipation: 3.1,
    pressure: 0.92,
    pressureIterations: isMobile ? 26 : 34,
    curl: prefersReducedMotion ? 2 : 10.5,
    splatRadius: isMobile ? 2.25 : 1.8,
    splatForce: isMobile ? 2900 : 3400,
    shading: true,
    colorful: true,
    colorUpdateSpeed: 0.45,
    colorPalette: theme.dyePalette,
    hover: false,
    backgroundColor: theme.base,
    transparent: false,
    brightness: 0.68,
    bloom: false,
    sunrays: false,
  };
}

function bindSlimeInput() {
  slimeCanvas.addEventListener('pointerdown', pointerDown, { passive: false });
  slimeCanvas.addEventListener('pointermove', pointerMove, { passive: false });
  slimeCanvas.addEventListener('pointerup', pointerUp);
  slimeCanvas.addEventListener('pointercancel', pointerUp);
  slimeCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
  slimeCanvas.tabIndex = 0;
  slimeCanvas.addEventListener('keydown', handleCanvasKey);
}

function replaceSlimeCanvas() {
  const replacement = document.createElement('canvas');
  replacement.id = 'slimeCanvas';
  replacement.setAttribute('aria-label', 'A screen-filling slime surface. Drag, swirl, and fold it to play.');
  slimeCanvas.replaceWith(replacement);
  slimeCanvas = replacement;
}

function initFluid({ replace = false, seedDelay = 100 } = {}) {
  try {
    clearSeedTimers();
    state.activePointers.clear();
    if (fluid) {
      const oldSimulation = fluid.simulation;
      fluid.stop();
      oldSimulation.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    if (replace) replaceSlimeCanvas();
    fluidStage.style.background = themes[state.theme].base;
    slimeCanvas.style.backgroundColor = themes[state.theme].base;
    fluidStage.classList.remove('fluid-fallback');
    fluid = new WebGLFluidEnhanced(fluidStage);
    fluid.setConfig(fluidConfig());
    fluid.start();
    const simulation = fluid.simulation;
    simulation.canvas.removeEventListener('mousedown', simulation.handleMouseDown);
    simulation.canvas.removeEventListener('mousemove', simulation.handleMouseMove);
    window.removeEventListener('mouseup', simulation.handleMouseUp);
    simulation.canvas.removeEventListener('touchstart', simulation.handleTouchStart, true);
    simulation.canvas.removeEventListener('touchmove', simulation.handleTouchMove, true);
    window.removeEventListener('touchend', simulation.handleTouchEnd);
    simulation.pointers.length = 0;
    bindSlimeInput();
    state.webglAvailable = true;
    scheduleSeed(() => seedSlime(10), seedDelay);
  } catch (error) {
    console.error('Fluid simulation unavailable; using animated fallback.', error);
    fluid = null;
    state.webglAvailable = false;
    fluidStage.classList.add('fluid-fallback');
    bindSlimeInput();
  }
}

function seedSlime(amount = 10) {
  if (!fluid) return;
  const theme = themes[state.theme];
  fluid.setConfig({ splatRadius: 18 });
  for (let index = 0; index < amount; index += 1) {
    const x = state.toppingWidth * (0.08 + ((index * 0.6180339 + 0.11) % 0.84));
    const y = state.toppingHeight * (0.08 + ((index * 0.4142135 + 0.17) % 0.84));
    const angle = index * 2.31;
    localFluidSplat(
      x,
      y,
      Math.cos(angle) * 12,
      Math.sin(angle) * 12,
      theme.dyePalette[index % theme.dyePalette.length],
      0.14,
      34,
    );
  }
  scheduleSeed(() => {
    fluid?.setConfig({ splatRadius: isMobile ? 2.25 : 1.8 });
    addSwirlGrid(state.playMode ? 12 : 10, 0.13);
  }, 80);
}

function normalizedFluidColor(hex, intensity = 0.18) {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  return { r: red * intensity, g: green * intensity, b: blue * intensity };
}

function localFluidSplat(x, y, dx, dy, color, intensity = 0.12, forceScale = 18) {
  if (!fluid || !state.toppingWidth || !state.toppingHeight) return;
  const palette = themes[state.theme].dyePalette;
  const selectedColor = color || palette[Math.floor(Math.random() * palette.length)];
  fluid.simulation.gl.disable(fluid.simulation.gl.BLEND);
  fluid.simulation.splat(
    clamp(x / state.toppingWidth, 0, 1),
    clamp(1 - y / state.toppingHeight, 0, 1),
    clamp(dx * forceScale, -1000, 1000),
    clamp(-dy * forceScale, -1000, 1000),
    normalizedFluidColor(selectedColor, intensity),
  );
  state.splatCount += 1;
}

function addSwirlGrid(count = 6, intensity = 0.06) {
  if (!fluid) return;
  const theme = themes[state.theme];
  for (let index = 0; index < count; index += 1) {
    const x = state.toppingWidth * (0.12 + ((index * 0.618) % 0.76));
    const y = state.toppingHeight * (0.13 + ((index * 0.414) % 0.74));
    const angle = index * 2.1;
    localFluidSplat(x, y, Math.cos(angle) * 32, Math.sin(angle) * 32, theme.dyePalette[index % theme.dyePalette.length], intensity, 34);
  }
}

function splashMix(type) {
  if (!fluid) return;
  const theme = themes[state.theme];
  const mixColors = {
    sprinkles: ['#ff4e98', '#36d9cf', '#ff9b36', '#8b45ed'],
    stars: ['#fff36e', '#ff76c5', theme.accent],
    beads: ['#75f4e6', '#ff8ebd', '#b283ff'],
    glitter: ['#ffd83f', '#ff63c3', theme.accent],
  };
  for (let index = 0; index < 6; index += 1) {
    const angle = index * TAU / 6 + Math.random() * 0.5;
    const x = state.toppingWidth * randomBetween(0.18, 0.82);
    const y = state.toppingHeight * randomBetween(0.18, 0.82);
    localFluidSplat(x, y, Math.cos(angle) * 24, Math.sin(angle) * 24, mixColors[type][index % mixColors[type].length], 0.065);
  }
}

function canvasPosition(event) {
  const bounds = slimeCanvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function pointerDown(event) {
  if (!state.started) return;
  event.preventDefault();
  audio.init();
  const position = canvasPosition(event);
  try { slimeCanvas.setPointerCapture?.(event.pointerId); } catch { /* Capture is optional. */ }
  const palette = themes[state.theme].dyePalette;
  const colorIndex = (state.splatCount + state.activePointers.size) % palette.length;
  state.activePointers.set(event.pointerId, {
    x: position.x,
    y: position.y,
    lastX: position.x,
    lastY: position.y,
    speed: 0,
    moveCount: 0,
    colorIndex,
    color: palette[colorIndex],
  });
  const nudge = event.pressure > 0 ? event.pressure * 8 : 4;
  localFluidSplat(position.x, position.y, nudge, -nudge * 0.4, palette[colorIndex], 0.025);
  toppings.stir(position.x, position.y, nudge, -nudge, 1.25);
  audio.squelch(0.44 + state.activePointers.size * 0.12, 1 - state.activePointers.size * 0.06);
  haptic(state.activePointers.size > 1 ? [8, 18, 10] : 9);
  hideHint();
}

function pointerMove(event) {
  const pointer = state.activePointers.get(event.pointerId);
  if (!pointer) return;
  event.preventDefault();
  const position = canvasPosition(event);
  const dx = position.x - pointer.lastX;
  const dy = position.y - pointer.lastY;
  const speed = Math.hypot(dx, dy);
  pointer.x = position.x;
  pointer.y = position.y;
  pointer.lastX = position.x;
  pointer.lastY = position.y;
  pointer.speed = speed;
  pointer.moveCount += 1;
  if (pointer.moveCount % 24 === 0) {
    const palette = themes[state.theme].dyePalette;
    pointer.colorIndex = (pointer.colorIndex + 1) % palette.length;
    pointer.color = palette[pointer.colorIndex];
  }
  const ribbonIntensity = pointer.moveCount % 6 === 0 ? 0.05 : 0;
  localFluidSplat(position.x, position.y, dx, dy, pointer.color, ribbonIntensity);
  toppings.stir(position.x, position.y, dx, dy, 1 + state.activePointers.size * 0.22);
  state.stirCount += 1;
  state.interactionEnergy = clamp(state.interactionEnergy + speed * 0.018, 0, 10);
  audio.wetDrag(speed, state.activePointers.size);
  if (speed > 13 && performance.now() % 130 < 18) haptic(3);
}

function pointerUp(event) {
  const pointer = state.activePointers.get(event.pointerId);
  if (!pointer) return;
  state.activePointers.delete(event.pointerId);
  audio.release(pointer.speed);
  haptic([4, 20, 7]);
}

function handleCanvasKey(event) {
  if (!state.started) return;
  const centerX = state.toppingWidth / 2;
  const centerY = state.toppingHeight / 2;
  const directions = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
  if (directions[event.key]) {
    event.preventDefault();
    const [dx, dy] = directions[event.key];
    localFluidSplat(centerX, centerY, dx, dy, themes[state.theme].dyePalette[0], 0);
    toppings.stir(centerX, centerY, dx, dy, 1.4);
    audio.wetDrag(24, 1);
  }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    addSwirlGrid(7, 0.05);
    audio.squelch(0.7, 0.86);
    haptic(10);
  }
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    if (state.playMode) exitPlayMode(); else enterPlayMode();
  }
}

function resizeToppings() {
  toppings.resize();
  toppings.render();
}

function frame(timestamp) {
  const dt = state.lastTimestamp ? clamp(timestamp - state.lastTimestamp, 8, 34) : 16.6667;
  state.lastTimestamp = timestamp;
  state.time += dt;
  state.interactionEnergy *= 0.982 ** (dt / 16.6667);
  if (state.activePointers.size) {
    let heldSpeed = 0;
    state.activePointers.forEach((pointer) => {
      heldSpeed += pointer.speed;
      pointer.speed *= 0.84 ** (dt / 16.6667);
    });
    audio.wetDrag(Math.max(3.5, heldSpeed / state.activePointers.size), state.activePointers.size);
  }
  toppings.update(dt);
  toppings.render();
  requestAnimationFrame(frame);
}

function saveRecipe() {
  try {
    localStorage.setItem('rye-ryes-slime-time-recipe', JSON.stringify({ theme: state.theme, mixins: [...state.mixins], muted: state.muted }));
  } catch {
    // Persistence is a convenience, never a requirement for play.
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
  audio.release(step === 'base' ? 5 : step === 'mix' ? 9 : 13);
  haptic(6);
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
  audio.squelch(0.68, 0.92);
  haptic([10, 24, 15]);
  state.started = true;
  welcomeCard.classList.add('hidden');
  welcomeCard.inert = true;
  welcomeCard.setAttribute('aria-hidden', 'true');
  makerPanel.classList.remove('before-start');
  makerPanel.inert = false;
  makerPanel.removeAttribute('aria-hidden');
  showHint('1 · Pick your slime!', 1800);
}

function enterPlayMode() {
  if (!state.started || state.playMode) return;
  state.playMode = true;
  app.classList.add('full-slime');
  resetViewportOrigin();
  playground.classList.add('play-mode');
  makerPanel.classList.add('play-mode');
  makerPanel.inert = true;
  makerPanel.setAttribute('aria-hidden', 'true');
  topbar.inert = true;
  topbar.setAttribute('aria-hidden', 'true');
  exitPlayButton.inert = false;
  audio.squelch(0.92, 0.72);
  haptic([14, 28, 20, 28, 25]);
  window.setTimeout(() => {
    resetViewportOrigin();
    resizeToppings();
    initFluid({ replace: true, seedDelay: 90 });
    toppings.syncMixins();
    showHint('Draw slow circles to fold the colors!', 2200);
  }, 470);
}

function exitPlayMode() {
  if (!state.playMode) return;
  state.playMode = false;
  app.classList.remove('full-slime');
  resetViewportOrigin();
  playground.classList.remove('play-mode');
  makerPanel.classList.remove('play-mode');
  makerPanel.inert = false;
  makerPanel.removeAttribute('aria-hidden');
  topbar.inert = false;
  topbar.removeAttribute('aria-hidden');
  exitPlayButton.inert = true;
  audio.release(7);
  haptic(7);
  window.setTimeout(() => {
    resizeToppings();
    initFluid({ replace: true, seedDelay: 90 });
  }, 470);
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
  audio.release(5);
}

function resetSlime() {
  initFluid({ replace: true, seedDelay: 120 });
  toppings.spawnBubbles();
  toppings.syncMixins();
  audio.squelch(0.75, 0.68);
  haptic([8, 20, 12]);
  showHint('Fresh slime!', 1100);
}

document.querySelector('#startButton').addEventListener('click', startMaking);
document.querySelector('#squishButton').addEventListener('click', enterPlayMode);
document.querySelector('#homeButton').addEventListener('click', goHome);
exitPlayButton.addEventListener('click', exitPlayMode);
resetButton.addEventListener('click', resetSlime);

soundButton.classList.toggle('sound-muted', state.muted);
soundButton.setAttribute('aria-pressed', String(!state.muted));
soundButton.setAttribute('aria-label', state.muted ? 'Turn sound on' : 'Turn sound off');
soundButton.addEventListener('click', () => {
  state.muted = !state.muted;
  soundButton.classList.toggle('sound-muted', state.muted);
  soundButton.setAttribute('aria-pressed', String(!state.muted));
  soundButton.setAttribute('aria-label', state.muted ? 'Turn sound on' : 'Turn sound off');
  if (!state.muted) audio.release(11);
  haptic(5);
  saveRecipe();
});

document.querySelectorAll('.step-tab').forEach((button) => button.addEventListener('click', () => setStep(button.dataset.step)));

document.querySelectorAll('.slime-choice').forEach((button) => {
  const selected = button.dataset.slime === state.theme;
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    state.theme = button.dataset.slime;
    document.querySelectorAll('.slime-choice').forEach((choice) => {
      const isSelected = choice === button;
      choice.classList.toggle('selected', isSelected);
      choice.setAttribute('aria-pressed', String(isSelected));
    });
    toppings.palette = themes[state.theme].palette;
    toppings.syncMixins();
    initFluid({ replace: true, seedDelay: 120 });
    audio.squelch(0.7, 0.78 + Math.random() * 0.25);
    haptic([7, 14, 9]);
    showHint(`${themes[state.theme].name}!`, 1100);
    saveRecipe();
  });
});

document.querySelectorAll('.mix-choice').forEach((button) => {
  const mix = button.dataset.mix;
  const selected = state.mixins.has(mix);
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    const enabled = !state.mixins.has(mix);
    if (enabled) state.mixins.add(mix); else state.mixins.delete(mix);
    button.classList.toggle('selected', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    toppings.syncMixins();
    if (enabled) {
      toppings.burst(mix);
      splashMix(mix);
      audio.sparkle();
      haptic([4, 16, 4, 16, 7]);
      showHint(mix === 'sprinkles' ? 'Sprinkle swirl!' : `${button.textContent.trim().replace(/\s+/g, ' ')}!`, 1100);
    } else {
      audio.release(6);
      haptic(4);
    }
    saveRecipe();
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.playMode) exitPlayMode();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audio.context?.state === 'suspended' && !state.muted) audio.context.resume();
});

new ResizeObserver(resizeToppings).observe(playground);
window.addEventListener('resize', resizeToppings);
resizeToppings();
toppings.syncMixins();
initFluid();
requestAnimationFrame(frame);

window.render_game_to_text = () => JSON.stringify({
  coordinateSystem: 'Canvas origin is top-left; x increases right; y increases down; units are CSS pixels.',
  mode: !state.started ? 'welcome' : state.playMode ? 'full-slime' : `making-${state.step}`,
  recipe: { theme: state.theme, themeName: themes[state.theme].name, mixins: [...state.mixins] },
  simulation: {
    engine: state.webglAvailable ? 'WebGL GPU Eulerian fluid with pressure, advection, curl, and dye mixing' : 'animated gradient fallback',
    coverage: 'full-stage',
    stage: { width: Math.round(state.toppingWidth), height: Math.round(state.toppingHeight) },
    splatCount: state.splatCount,
    stirCount: state.stirCount,
    interactionEnergy: Number(state.interactionEnergy.toFixed(2)),
    activeTouches: state.activePointers.size,
  },
  toppings: {
    total: toppings.particles.length,
    visibleMixins: [...state.mixins],
  },
  sound: state.muted ? 'off' : 'on',
  cloudSlimeTextureBursts: audio.textureBurstCount,
  hapticsAvailable: 'vibrate' in navigator,
});

window.advanceTime = (milliseconds) => {
  const steps = Math.max(1, Math.round(milliseconds / 16.6667));
  for (let index = 0; index < steps; index += 1) {
    state.time += 16.6667;
    state.interactionEnergy *= 0.982;
    toppings.update(16.6667);
  }
  toppings.render();
};
