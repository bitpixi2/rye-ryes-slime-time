import WebGLFluidEnhanced from 'webgl-fluid-enhanced';
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import Matter from 'matter-js';
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
const previousStepButton = document.querySelector('#previousStepButton');
const nextStepButton = document.querySelector('#nextStepButton');
const stepCount = document.querySelector('#stepCount');
const stepName = document.querySelector('#stepName');
const nextStepLabel = document.querySelector('#nextStepLabel');

exitPlayButton.inert = true;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const TAU = Math.PI * 2;
const SLIME_TYPES = ['liquidy', 'cloud3d', 'wax', 'bingsu', 'putty'];
const MIX_TYPES = ['sprinkles', 'stars', 'beads', 'glitter'];
const MIX_LABELS = { sprinkles: 'Candy Sprinkles', stars: 'Jelly Stars', beads: 'Bubble Beads', glitter: 'Cosmic Glitter' };
const MAX_MIX_BATCHES = 5;
const SLIME_TOUCH_LAG_MS = 315;
const SLIME_MAX_STEP_PER_FRAME = 4.2;
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
  step: 'type',
  slimeType: 'liquidy',
  theme: 'berry',
  mixins: new Map(MIX_TYPES.map((type) => [type, 0])),
  muted: false,
  activePointers: new Map(),
  settlingPointers: [],
  webglAvailable: true,
  splatCount: 0,
  stirCount: 0,
  interactionEnergy: 0,
  averagePointerLag: 0,
  toppingWidth: 0,
  toppingHeight: 0,
  toppingDpr: 1,
  time: 0,
  lastTimestamp: 0,
  lastToppingRenderTime: 0,
  hintTimer: 0,
  hapticCueCount: 0,
  textureHapticCount: 0,
};

const requestedSlimeType = new URLSearchParams(window.location.search).get('type');
if (SLIME_TYPES.includes(requestedSlimeType)) state.slimeType = requestedSlimeType;

try {
  const saved = JSON.parse(localStorage.getItem('rye-ryes-slime-time-recipe') || '{}');
  if (themes[saved.theme]) state.theme = saved.theme;
  state.muted = saved.muted === true;
} catch {
  // Storage is optional; the simulation must remain playable without it.
}

class SlimeAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.foamBuffer = null;
    this.lastDragSound = 0;
    this.nextDragDelay = 96;
    this.textureBurstCount = 0;
    this.mushBurstCount = 0;
    this.foamCrunchCount = 0;
    this.waxCrackleCount = 0;
    this.bingsuCrunchCount = 0;
    this.airPopCount = 0;
    this.lastCrunchSound = { wax: 0, bingsu: 0 };
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
      this.foamBuffer = this.createFoamCrackle();
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

  createFoamCrackle() {
    const length = Math.floor(this.context.sampleRate * 0.45);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let crackle = 0;
    for (let index = 0; index < length; index += 1) {
      if (Math.random() < 0.018) crackle = randomBetween(-1, 1) * randomBetween(0.35, 1);
      else crackle *= 0.84;
      const softNoise = (Math.random() * 2 - 1) * 0.1;
      data[index] = (crackle + softNoise) * (1 - index / length);
    }
    return buffer;
  }

  squelch(intensity = 0.5, pitch = 1) {
    this.init();
    if (!this.context || state.muted) return;
    const now = this.context.currentTime;
    const amount = clamp(intensity, 0.08, 1);
    this.mushBurstCount += 1;
    const wet = this.context.createBufferSource();
    const wetFilter = this.context.createBiquadFilter();
    const wetGain = this.context.createGain();
    const foam = this.context.createBufferSource();
    const foamFilter = this.context.createBiquadFilter();
    const foamGain = this.context.createGain();

    wet.buffer = this.noiseBuffer;
    wet.playbackRate.value = 0.34 + amount * 0.18;
    wetFilter.type = 'lowpass';
    wetFilter.frequency.setValueAtTime(520 * pitch + amount * 140, now);
    wetFilter.frequency.exponentialRampToValueAtTime(92 + amount * 55, now + 0.38);
    wetFilter.Q.value = 1.15;
    wetGain.gain.setValueAtTime(0.0001, now);
    wetGain.gain.exponentialRampToValueAtTime(0.075 * amount, now + 0.035);
    wetGain.gain.setValueAtTime(0.065 * amount, now + 0.11);
    wetGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    foam.buffer = this.foamBuffer;
    foam.playbackRate.value = 0.82 + Math.random() * 0.24;
    foamFilter.type = 'bandpass';
    foamFilter.frequency.value = 520 + amount * 460;
    foamFilter.Q.value = 0.7;
    foamGain.gain.setValueAtTime(0.0001, now);
    foamGain.gain.exponentialRampToValueAtTime(0.035 * amount, now + 0.018);
    foamGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    wet.connect(wetFilter).connect(wetGain).connect(this.master);
    foam.connect(foamFilter).connect(foamGain).connect(this.master);
    wet.start(now);
    foam.start(now + 0.015);
    wet.stop(now + 0.42);
    foam.stop(now + 0.32);
  }

  wetDrag(speed, touches = 1) {
    const nowMs = performance.now();
    if (nowMs - this.lastDragSound < this.nextDragDelay) return false;
    this.lastDragSound = nowMs;
    this.nextDragDelay = randomBetween(82, 148);
    this.init();
    if (!this.context || state.muted) return false;
    this.textureBurstCount += 1;
    this.foamCrunchCount += 1;
    const now = this.context.currentTime;
    const amount = clamp(speed / 26, 0.14, 0.82);
    const goosh = this.context.createBufferSource();
    const gooshFilter = this.context.createBiquadFilter();
    const gooshGain = this.context.createGain();
    const foam = this.context.createBufferSource();
    const foamFilter = this.context.createBiquadFilter();
    const foamGain = this.context.createGain();

    goosh.buffer = this.noiseBuffer;
    goosh.playbackRate.value = 0.4 + amount * 0.3;
    gooshFilter.type = 'lowpass';
    gooshFilter.frequency.value = 125 + amount * 310 + touches * 18;
    gooshFilter.Q.value = 0.9;
    gooshGain.gain.setValueAtTime(0.0001, now);
    gooshGain.gain.exponentialRampToValueAtTime(0.022 + amount * 0.045, now + 0.026);
    gooshGain.gain.setValueAtTime(0.019 + amount * 0.036, now + 0.09);
    gooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    foam.buffer = this.foamBuffer;
    foam.playbackRate.value = 0.9 + Math.random() * 0.55 + amount * 0.22;
    foamFilter.type = 'bandpass';
    foamFilter.frequency.value = 610 + amount * 1020 + Math.random() * 280;
    foamFilter.Q.value = 0.75 + touches * 0.16;
    foamGain.gain.setValueAtTime(0.0001, now);
    foamGain.gain.exponentialRampToValueAtTime(0.012 + amount * 0.026, now + 0.012);
    foamGain.gain.setValueAtTime(0.01 + amount * 0.02, now + 0.07);
    foamGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    goosh.connect(gooshFilter).connect(gooshGain).connect(this.master);
    foam.connect(foamFilter).connect(foamGain).connect(this.master);
    goosh.start(now);
    foam.start(now + Math.random() * 0.018);
    goosh.stop(now + 0.22);
    foam.stop(now + 0.19);
    if (state.slimeType === 'wax') this.crunchTexture('wax', amount * 0.72);
    if (state.slimeType === 'bingsu') this.crunchTexture('bingsu', amount * 1.08);
    return true;
  }

  crunchTexture(kind = 'bingsu', intensity = 0.7, { first = false, force = false } = {}) {
    const nowMs = performance.now();
    const minimumDelay = kind === 'wax' ? 58 : 72;
    if (!force && nowMs - this.lastCrunchSound[kind] < minimumDelay) return false;
    this.lastCrunchSound[kind] = nowMs;
    this.init();
    if (!this.context || state.muted) return false;

    const amount = clamp(intensity, 0.18, 1.15);
    const now = this.context.currentTime;
    const grainCount = kind === 'wax'
      ? (first ? 9 : 4 + Math.round(amount * 2))
      : 6 + Math.round(amount * 3);

    for (let index = 0; index < grainCount; index += 1) {
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      const startAt = now + index * randomBetween(0.006, kind === 'wax' ? 0.013 : 0.018) + Math.random() * 0.012;
      const duration = kind === 'wax' ? randomBetween(0.025, 0.065) : randomBetween(0.045, 0.105);
      source.buffer = this.foamBuffer;
      source.playbackRate.value = kind === 'wax'
        ? randomBetween(1.55, 2.65)
        : randomBetween(0.95, 1.85);
      filter.type = kind === 'wax' ? 'highpass' : 'bandpass';
      filter.frequency.value = kind === 'wax'
        ? randomBetween(1650, 4100)
        : randomBetween(720, 2650);
      filter.Q.value = kind === 'wax' ? randomBetween(0.7, 1.4) : randomBetween(0.55, 1.05);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime((kind === 'wax' ? 0.026 : 0.021) * amount, startAt + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(startAt);
      source.stop(startAt + duration + 0.015);
    }

    const body = this.context.createBufferSource();
    const bodyFilter = this.context.createBiquadFilter();
    const bodyGain = this.context.createGain();
    body.buffer = this.noiseBuffer;
    body.playbackRate.value = kind === 'wax' ? 0.72 : 0.46;
    bodyFilter.type = 'bandpass';
    bodyFilter.frequency.value = kind === 'wax' ? (first ? 780 : 1050) : 520 + amount * 330;
    bodyFilter.Q.value = kind === 'wax' ? 1.6 : 0.78;
    bodyGain.gain.setValueAtTime((kind === 'wax' ? 0.032 : 0.041) * amount, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'wax' ? 0.12 : 0.19));
    body.connect(bodyFilter).connect(bodyGain).connect(this.master);
    body.start(now);
    body.stop(now + 0.21);

    if (kind === 'wax') this.waxCrackleCount += grainCount;
    else {
      this.bingsuCrunchCount += grainCount;
      if (amount > 0.72 && Math.random() < 0.28) {
        this.airPopCount += 1;
        const pop = this.context.createBufferSource();
        const popFilter = this.context.createBiquadFilter();
        const popGain = this.context.createGain();
        pop.buffer = this.foamBuffer;
        pop.playbackRate.value = randomBetween(1.7, 2.3);
        popFilter.type = 'bandpass';
        popFilter.frequency.value = randomBetween(1100, 1900);
        popFilter.Q.value = 2.1;
        popGain.gain.setValueAtTime(0.025 * amount, now + 0.035);
        popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
        pop.connect(popFilter).connect(popGain).connect(this.master);
        pop.start(now + 0.035);
        pop.stop(now + 0.09);
      }
    }
    return true;
  }

  release(speed = 8) {
    this.init();
    if (!this.context || state.muted) return;
    const now = this.context.currentTime;
    this.mushBurstCount += 1;
    const wet = this.context.createBufferSource();
    const wetFilter = this.context.createBiquadFilter();
    const wetGain = this.context.createGain();
    const foam = this.context.createBufferSource();
    const foamFilter = this.context.createBiquadFilter();
    const foamGain = this.context.createGain();
    wet.buffer = this.noiseBuffer;
    wet.playbackRate.value = 0.38 + clamp(speed / 80, 0, 0.28);
    wetFilter.type = 'lowpass';
    wetFilter.frequency.setValueAtTime(340 + speed * 4, now);
    wetFilter.frequency.exponentialRampToValueAtTime(82, now + 0.28);
    wetFilter.Q.value = 0.8;
    wetGain.gain.setValueAtTime(0.048, now);
    wetGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    foam.buffer = this.foamBuffer;
    foam.playbackRate.value = 1.05 + Math.random() * 0.4;
    foamFilter.type = 'highpass';
    foamFilter.frequency.value = 720;
    foamGain.gain.setValueAtTime(0.018, now);
    foamGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    wet.connect(wetFilter).connect(wetGain).connect(this.master);
    foam.connect(foamFilter).connect(foamGain).connect(this.master);
    wet.start(now);
    foam.start(now + 0.02);
    wet.stop(now + 0.31);
    foam.stop(now + 0.15);
  }

  sparkle() {
    this.init();
    if (!this.context || state.muted) return;
    [0, 1, 2, 3].forEach((index) => {
      const now = this.context.currentTime + index * 0.045;
      const foam = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      foam.buffer = this.foamBuffer;
      foam.playbackRate.value = 1.1 + Math.random() * 0.8;
      filter.type = 'bandpass';
      filter.frequency.value = 850 + index * 260 + Math.random() * 180;
      filter.Q.value = 0.9;
      gain.gain.setValueAtTime(0.022, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      foam.connect(filter).connect(gain).connect(this.master);
      foam.start(now);
      foam.stop(now + 0.11);
    });
    this.foamCrunchCount += 4;
  }
}

class ToppingLayer {
  constructor(context) {
    this.context = context;
    this.particles = [];
    this.palette = themes[state.theme].palette;
    this.spawnBaseTexture();
  }

  resize() {
    const bounds = toppingCanvas.getBoundingClientRect();
    state.toppingWidth = Math.max(1, bounds.width);
    state.toppingHeight = Math.max(1, bounds.height);
    state.toppingDpr = Math.min(devicePixelRatio || 1, isMobile ? 1.35 : 1.6);
    toppingCanvas.width = Math.round(state.toppingWidth * state.toppingDpr);
    toppingCanvas.height = Math.round(state.toppingHeight * state.toppingDpr);
  }

  spawnBaseTexture() {
    this.particles = this.particles.filter((particle) => particle.type !== 'bubble');
    for (let index = 0; index < (isMobile ? 11 : 16); index += 1) {
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
    const mobileCounts = { sprinkles: 30, stars: 8, beads: 16, glitter: 32 };
    const desktopCounts = { sprinkles: 46, stars: 12, beads: 24, glitter: 48 };
    return (isMobile ? mobileCounts : desktopCounts)[type] || 20;
  }

  syncMixins() {
    this.palette = themes[state.theme].palette;
    const baseTexture = this.particles.filter((particle) => particle.type === 'bubble');
    const syncedParticles = [...baseTexture];
    for (const type of MIX_TYPES) {
      const desired = this.countFor(type) * (state.mixins.get(type) || 0);
      const existing = this.particles.filter((particle) => particle.type === type).slice(0, desired);
      syncedParticles.push(...existing);
      for (let index = existing.length; index < desired; index += 1) syncedParticles.push(this.makeParticle(type));
    }
    this.particles = syncedParticles;
  }

  addBatch(type) {
    const batch = [];
    for (let index = 0; index < this.countFor(type); index += 1) batch.push(this.makeParticle(type));
    this.particles.push(...batch);
    return batch;
  }

  stir(x, y, dx, dy, force = 1) {
    const nx = x / state.toppingWidth;
    const ny = y / state.toppingHeight;
    const ndx = dx / state.toppingWidth;
    const ndy = dy / state.toppingHeight;
    const radius = 0.15;
    for (const particle of this.particles) {
      const offsetX = particle.x - nx;
      const offsetY = particle.y - ny;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > radius) continue;
      const influence = (1 - distance / radius) ** 2 * force;
      particle.vx += ndx * influence * 0.72 - offsetY * influence * 0.003;
      particle.vy += ndy * influence * 0.72 + offsetX * influence * 0.003;
      particle.spin += (ndx - ndy) * influence * 0.008;
    }
  }

  burst(type, particles = this.particles.filter((item) => item.type === type)) {
    const centerX = randomBetween(0.25, 0.75);
    const centerY = randomBetween(0.2, 0.8);
    for (const particle of particles) {
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
      const ambient = prefersReducedMotion ? 0 : 0.00000035;
      particle.vx += Math.sin(state.time * 0.00034 + particle.phase + particle.y * 7) * ambient * frame;
      particle.vy += Math.cos(state.time * 0.00029 + particle.phase + particle.x * 8) * ambient * frame;
      particle.vx *= 0.91 ** frame;
      particle.vy *= 0.91 ** frame;
      particle.spin *= 0.94 ** frame;
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
      if (particle.type === 'bubble' && (state.slimeType === 'wax' || state.slimeType === 'bingsu')) continue;
      const x = particle.x * width;
      const y = particle.y * height;
      context.save();
      context.translate(x, y);
      context.rotate(particle.angle);
      context.globalAlpha = particle.type === 'bubble' ? 0.3 : 0.83;

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

class CloudSlimeEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.15 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.1, 20);
    this.camera.position.set(0, -3.15, 4.7);
    this.camera.lookAt(0, 0.05, -0.12);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      clearcoat: 0.025,
      clearcoatRoughness: 0.95,
      sheen: 0.32,
      sheenRoughness: 0.92,
      sheenColor: 0xffffff,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float snowFiber = sin(vViewPosition.x * 27.0 + vViewPosition.y * 8.0 + sin(vViewPosition.y * 17.0))
          * sin(vViewPosition.y * 23.0 + vViewPosition.z * 13.0);
        vec2 snowSlope = clamp(vec2(dFdx(snowFiber), dFdy(snowFiber)), vec2(-0.12), vec2(0.12));
        normal = normalize(normal + vec3(snowSlope * 0.16, 0.0));`,
      );
    };
    this.volume = new MarchingCubes(isMobile ? 28 : 34, this.material, false, true, isMobile ? 20000 : 30000);
    this.volume.isolation = 74;
    this.volume.castShadow = true;
    this.volume.receiveShadow = true;
    this.group.add(this.volume);

    this.floorMaterial = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), this.floorMaterial);
    this.floor.position.z = -0.53;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    const hemisphere = new THREE.HemisphereLight(0xfff6ff, 0x24142f, 1.55);
    this.scene.add(hemisphere);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
    this.keyLight.position.set(-2.8, -3.6, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024);
    Object.assign(this.keyLight.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 14 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.00035;
    this.keyLight.shadow.normalBias = 0.022;
    this.scene.add(this.keyLight);
    const rimLight = new THREE.DirectionalLight(0xbfdcff, 1.1);
    rimLight.position.set(3.4, 2.4, 3.5);
    this.scene.add(rimLight);

    this.palette = [];
    this.touchFolds = [];
    this.rebuildElapsed = 0;
    this.rebuildInterval = isMobile ? 40 : 1000 / 30;
    this.dirty = true;
    this.rebuildCount = 0;
    this.setTheme();
    this.rebuildVolume();
  }

  setTheme() {
    const palette = themes[state.theme].dyePalette;
    this.palette = palette.map((color) => new THREE.Color(color).multiplyScalar(0.43));
    const tableColor = new THREE.Color(themes[state.theme].base).lerp(new THREE.Color(0x25192c), 0.28);
    this.scene.background = tableColor;
    this.floorMaterial.color.copy(tableColor);
    this.material.sheenColor.set(themes[state.theme].accent);
    this.dirty = true;
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const tallFill = clamp(0.75 / Math.max(0.35, aspect), 1, 1.15);
    this.group.scale.set(Math.max(1.48, aspect * 1.9), 2.12 * tallFill, 0.92);
  }

  touch(x, y, dx, dy) {
    const width = Math.max(1, state.toppingWidth);
    const height = Math.max(1, state.toppingHeight);
    const fold = {
      x: clamp(x / width, 0.055, 0.945),
      y: clamp(1 - y / height, 0.055, 0.945),
      pullX: clamp(dx / width * 17, -0.15, 0.15),
      pullY: clamp(-dy / height * 17, -0.15, 0.15),
      age: 0,
      life: 3.8,
      pressure: clamp(0.72 + Math.hypot(dx, dy) * 0.045, 0.72, 1.2),
    };
    const newest = this.touchFolds[0];
    if (newest && newest.age < 0.09 && Math.hypot(newest.x - fold.x, newest.y - fold.y) < 0.08) {
      newest.x += (fold.x - newest.x) * 0.34;
      newest.y += (fold.y - newest.y) * 0.34;
      newest.pullX += (fold.pullX - newest.pullX) * 0.3;
      newest.pullY += (fold.pullY - newest.pullY) * 0.3;
      newest.pressure += (fold.pressure - newest.pressure) * 0.28;
      newest.age = 0;
    } else {
      fold.strength = 0.14;
      this.touchFolds.unshift(fold);
      this.touchFolds.length = Math.min(this.touchFolds.length, 11);
    }
    this.dirty = true;
  }

  foldWeight(fold) {
    return fold.strength * Math.max(0, 1 - fold.age / fold.life) ** 2;
  }

  addBaseMass() {
    const columns = 5;
    const rows = 6;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const phase = index * 1.913;
        const baseX = 0.13 + column * 0.185 + Math.sin(phase) * 0.009;
        const baseY = 0.09 + row * 0.164 + Math.cos(phase * 1.17) * 0.009;
        let blobX = baseX;
        let blobY = baseY;
        let blobZ = 0.485;
        for (const fold of this.touchFolds) {
          const fade = this.foldWeight(fold);
          const distanceSquared = (baseX - fold.x) ** 2 + (baseY - fold.y) ** 2;
          const influence = Math.exp(-distanceSquared / 0.025) * fade;
          blobX += fold.pullX * influence * 0.34;
          blobY += fold.pullY * influence * 0.34;
          blobZ -= influence * 0.045 * fold.pressure;
        }
        this.volume.addBall(
          clamp(blobX, 0.045, 0.955),
          clamp(blobY, 0.045, 0.955),
          blobZ,
          0.56 + ((index * 7) % 5) * 0.012,
          12,
          this.palette[(column + row * 2) % this.palette.length],
        );
      }
    }
  }

  addFibrousFolds() {
    this.touchFolds.forEach((fold, foldIndex) => {
      const fade = this.foldWeight(fold);
      if (fade < 0.01) return;
      const paletteColor = this.palette[(foldIndex + 1) % this.palette.length];
      const directionLength = Math.max(0.04, Math.hypot(fold.pullX, fold.pullY));
      const directionX = fold.pullX || Math.sin(foldIndex * 2.4) * 0.035;
      const directionY = fold.pullY || Math.cos(foldIndex * 2.1) * 0.035;

      for (let point = 0; point < 5; point += 1) {
        const amount = point / 4;
        const strandX = clamp(fold.x - directionX * amount * (1.2 + directionLength * 2), 0.035, 0.965);
        const strandY = clamp(fold.y - directionY * amount * (1.2 + directionLength * 2), 0.035, 0.965);
        const strandZ = 0.565 + Math.sin(amount * Math.PI) * 0.055 * fade - point * 0.004;
        this.volume.addBall(strandX, strandY, strandZ, (0.14 - amount * 0.026) * fade + 0.035, 13.2, paletteColor);
      }

      const ringRadius = 0.052 + fold.pressure * 0.012;
      for (let point = 0; point < 5; point += 1) {
        const angle = point * TAU / 5 + foldIndex * 0.31;
        this.volume.addBall(
          fold.x + Math.cos(angle) * ringRadius,
          fold.y + Math.sin(angle) * ringRadius,
          0.57,
          0.1 * fade + 0.025,
          13.5,
          this.palette[(foldIndex + point) % this.palette.length],
        );
      }
      this.volume.addBall(fold.x, fold.y, 0.625, -0.028 * fade * fold.pressure, 12.8, paletteColor);
    });
  }

  addSnowyRidges() {
    for (let ridge = 0; ridge < 5; ridge += 1) {
      for (let point = 0; point < 14; point += 1) {
        const amount = point / 13;
        const x = 0.075 + amount * 0.85;
        const y = 0.15 + ridge * 0.17
          + Math.sin(amount * TAU * (1.05 + ridge * 0.08) + ridge * 1.4) * 0.028;
        const z = 0.585 + Math.sin(amount * Math.PI + ridge) * 0.018;
        this.volume.addBall(x, y, z, 0.054 + (point % 3) * 0.004, 14.2, this.palette[(ridge + point) % this.palette.length]);
      }
    }
  }

  rebuildVolume() {
    this.volume.reset();
    const paletteFloor = this.palette[0].clone().lerp(this.palette[1] || this.palette[0], 0.5).multiplyScalar(0.24);
    for (let index = 0; index < this.volume.palette.length; index += 3) {
      this.volume.palette[index] = paletteFloor.r;
      this.volume.palette[index + 1] = paletteFloor.g;
      this.volume.palette[index + 2] = paletteFloor.b;
    }
    this.addBaseMass();
    this.addSnowyRidges();
    this.addFibrousFolds();
    this.volume.update();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = false;
    this.rebuildCount += 1;
  }

  update(dt) {
    const seconds = dt / 1000;
    this.rebuildElapsed += dt;
    const hadFolds = this.touchFolds.length > 0;
    this.touchFolds.forEach((fold) => {
      fold.age += seconds;
      fold.strength += (1 - fold.strength) * (1 - Math.exp(-dt / 125));
    });
    this.touchFolds = this.touchFolds.filter((fold) => fold.age < fold.life);
    if (hadFolds) this.dirty = true;
    if (this.dirty && this.rebuildElapsed >= this.rebuildInterval) {
      this.rebuildVolume();
      this.rebuildElapsed %= this.rebuildInterval;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.volume.geometry.dispose();
    this.material.dispose();
    this.floor.geometry.dispose();
    this.floorMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

class PuttyEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    this.nodes = [];
    this.constraints = [];
    this.width = 1;
    this.height = 1;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.2 : 1.5);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    Matter.Composite.clear(this.engine.world, false, true);
    this.nodes = [];
    this.constraints = [];
    const columns = isMobile ? 12 : 16;
    const rows = isMobile ? 9 : 11;
    const gapX = this.width / (columns - 1);
    const gapY = this.height / (rows - 1);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const body = Matter.Bodies.circle(column * gapX, row * gapY, Math.min(gapX, gapY) * 0.34, {
          isStatic: row === 0 || column === 0 || row === rows - 1 || column === columns - 1,
          frictionAir: 0.16,
          restitution: 0,
          density: 0.002,
        });
        body.homeX = column * gapX;
        body.homeY = row * gapY;
        body.colorIndex = (column + row * 2) % themes[state.theme].dyePalette.length;
        this.nodes.push(body);
      }
    }
    const link = (a, b, stiffness = 0.24) => {
      const constraint = Matter.Constraint.create({ bodyA: a, bodyB: b, stiffness, damping: 0.12, length: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) });
      this.constraints.push(constraint);
    };
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (column < columns - 1) link(this.nodes[index], this.nodes[index + 1]);
        if (row < rows - 1) link(this.nodes[index], this.nodes[index + columns]);
        if (column < columns - 1 && row < rows - 1 && (column + row) % 2 === 0) link(this.nodes[index], this.nodes[index + columns + 1], 0.15);
      }
    }
    Matter.Composite.add(this.engine.world, [...this.nodes, ...this.constraints]);
  }

  touch(x, y, dx, dy) {
    const radius = Math.min(this.width, this.height) * 0.28;
    this.nodes.forEach((body) => {
      if (body.isStatic) return;
      const ox = body.position.x - x;
      const oy = body.position.y - y;
      const distance = Math.hypot(ox, oy);
      if (distance > radius) return;
      const influence = (1 - distance / radius) ** 2;
      Matter.Body.applyForce(body, body.position, { x: dx * 0.000035 * influence, y: dy * 0.000035 * influence });
    });
  }

  update(dt) {
    this.nodes.forEach((body) => {
      if (body.isStatic) return;
      Matter.Body.applyForce(body, body.position, {
        x: (body.homeX - body.position.x) * 0.00000065,
        y: (body.homeY - body.position.y) * 0.00000065,
      });
    });
    const substeps = Math.max(1, Math.ceil(dt / 16.6667));
    for (let index = 0; index < substeps; index += 1) Matter.Engine.update(this.engine, dt / substeps);
    this.render();
  }

  render() {
    const context = this.context;
    const palette = themes[state.theme].dyePalette;
    const background = context.createLinearGradient(0, 0, this.width, this.height);
    background.addColorStop(0, palette[0]);
    background.addColorStop(0.48, palette[1]);
    background.addColorStop(1, palette[2]);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.fillStyle = background;
    context.fillRect(0, 0, this.width, this.height);
    context.lineCap = 'round';
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.26;
    context.lineWidth = Math.min(this.width, this.height) * 0.055;
    this.constraints.forEach((constraint, index) => {
      context.strokeStyle = palette[index % palette.length];
      context.beginPath();
      context.moveTo(constraint.bodyA.position.x, constraint.bodyA.position.y);
      context.lineTo(constraint.bodyB.position.x, constraint.bodyB.position.y);
      context.stroke();
    });
    context.globalCompositeOperation = 'overlay';
    context.globalAlpha = 0.5;
    const radius = Math.min(this.width, this.height) * (isMobile ? 0.06 : 0.05);
    this.nodes.forEach((body) => {
      context.fillStyle = palette[body.colorIndex % palette.length];
      context.beginPath();
      context.arc(body.position.x, body.position.y, radius, 0, TAU);
      context.fill();
    });
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
  }

  dispose() {
    Matter.Composite.clear(this.engine.world, false, true);
    Matter.Engine.clear(this.engine);
  }
}

class WaxCrackleEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.shellCanvas = document.createElement('canvas');
    this.shellContext = this.shellCanvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.cracks = [];
    this.chips = [];
    this.folds = [];
    this.fractureBursts = 0;
    this.lastCrackAt = 0;
    this.lastCrackX = -1;
    this.lastCrackY = -1;
    this.renderElapsed = 1000;
    this.shellDirty = true;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.25 : 1.55);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.shellCanvas.width = Math.round(this.width * this.dpr);
    this.shellCanvas.height = Math.round(this.height * this.dpr);
    this.shellContext.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.shellDirty = true;
    this.render();
  }

  touch(x, y, dx, dy) {
    const nx = clamp(x / this.width, 0, 1);
    const ny = clamp(y / this.height, 0, 1);
    const speed = Math.hypot(dx, dy);
    const newest = this.folds[0];
    if (newest && newest.age < 0.11 && Math.hypot(newest.x - nx, newest.y - ny) < 0.09) {
      newest.x += (nx - newest.x) * 0.38;
      newest.y += (ny - newest.y) * 0.38;
      newest.pullX += (dx / this.width - newest.pullX) * 0.28;
      newest.pullY += (dy / this.height - newest.pullY) * 0.28;
      newest.age = 0;
    } else {
      this.folds.unshift({ x: nx, y: ny, pullX: dx / this.width, pullY: dy / this.height, age: 0 });
      this.folds.length = Math.min(this.folds.length, 8);
    }

    const now = performance.now();
    const distance = Math.hypot(nx - this.lastCrackX, ny - this.lastCrackY);
    const first = this.fractureBursts === 0;
    if (first || (now - this.lastCrackAt > 72 && (distance > 0.035 || speed > 2.4))) {
      this.fracture(nx, ny, clamp(0.55 + speed * 0.055, 0.55, 1.15));
    }
  }

  fracture(x, y, pressure) {
    const first = this.fractureBursts === 0;
    const rays = first ? 11 : 5 + Math.round(pressure * 2);
    const minDimension = Math.min(this.width, this.height);
    const baseAngle = Math.random() * TAU;
    for (let ray = 0; ray < rays; ray += 1) {
      let angle = baseAngle + ray * TAU / rays + randomBetween(-0.18, 0.18);
      let fromX = x;
      let fromY = y;
      const segments = first ? 4 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 3);
      for (let segment = 0; segment < segments; segment += 1) {
        angle += randomBetween(-0.24, 0.24);
        const length = minDimension * randomBetween(first ? 0.04 : 0.027, first ? 0.085 : 0.062) * (1 - segment * 0.055);
        const toX = clamp(fromX + Math.cos(angle) * length / this.width, -0.02, 1.02);
        const toY = clamp(fromY + Math.sin(angle) * length / this.height, -0.02, 1.02);
        this.cracks.push({ x1: fromX, y1: fromY, x2: toX, y2: toY, width: randomBetween(1.5, first ? 4.2 : 3.2) });
        if (segment > 0 && Math.random() < 0.24) {
          const branchAngle = angle + randomBetween(-1, 1);
          const branchLength = length * randomBetween(0.38, 0.65);
          this.cracks.push({
            x1: fromX,
            y1: fromY,
            x2: clamp(fromX + Math.cos(branchAngle) * branchLength / this.width, 0, 1),
            y2: clamp(fromY + Math.sin(branchAngle) * branchLength / this.height, 0, 1),
            width: randomBetween(0.9, 2.1),
          });
        }
        fromX = toX;
        fromY = toY;
      }
    }
    const chipCount = first ? 5 : 2 + Math.round(pressure * 2);
    for (let index = 0; index < chipCount; index += 1) {
      const angle = Math.random() * TAU;
      const radius = minDimension * randomBetween(0.008, first ? 0.028 : 0.019);
      this.chips.push({
        x: clamp(x + Math.cos(angle) * radius * 1.8 / this.width, 0, 1),
        y: clamp(y + Math.sin(angle) * radius * 1.8 / this.height, 0, 1),
        radius,
        sides: 3 + Math.floor(Math.random() * 3),
        phase: Math.random() * TAU,
      });
    }
    this.cracks = this.cracks.slice(-360);
    this.chips = this.chips.slice(-90);
    this.fractureBursts += 1;
    this.lastCrackAt = performance.now();
    this.lastCrackX = x;
    this.lastCrackY = y;
    this.shellDirty = true;
    audio.crunchTexture('wax', first ? 1.1 : 0.58 + pressure * 0.26, { first, force: first });
    haptic(first ? [28, 11, 18, 8, 13] : [13, 6, 10], first ? 1.42 : 1.28);
  }

  drawBase() {
    const context = this.context;
    const palette = themes[state.theme].dyePalette;
    const width = this.width;
    const height = this.height;
    const unit = Math.min(width, height) / 390;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, palette[0]);
    base.addColorStop(0.34, palette[2] || palette[1]);
    base.addColorStop(0.68, palette[1]);
    base.addColorStop(1, palette[3] || palette[0]);
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.26;
    context.lineCap = 'round';
    for (let ribbon = 0; ribbon < 4; ribbon += 1) {
      context.strokeStyle = palette[(ribbon + 1) % palette.length];
      context.lineWidth = Math.min(width, height) * (0.17 + ribbon * 0.012);
      context.beginPath();
      context.moveTo(-width * 0.08, height * (0.16 + ribbon * 0.23));
      context.bezierCurveTo(
        width * 0.25, height * (0.02 + ribbon * 0.25),
        width * 0.68, height * (0.32 + ribbon * 0.14),
        width * 1.08, height * (0.14 + ribbon * 0.22),
      );
      context.stroke();
    }

    context.globalCompositeOperation = 'overlay';
    this.folds.forEach((fold, index) => {
      const fade = Math.max(0, 1 - fold.age / 2.7);
      const radius = Math.min(width, height) * (0.12 + index * 0.008);
      const gradient = context.createRadialGradient(fold.x * width, fold.y * height, 0, fold.x * width, fold.y * height, radius);
      gradient.addColorStop(0, `rgba(20,0,40,${0.34 * fade})`);
      gradient.addColorStop(0.46, `rgba(255,255,255,${0.2 * fade})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.globalAlpha = 1;
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(fold.x * width, fold.y * height, radius, 0, TAU);
      context.fill();
    });

    context.globalCompositeOperation = 'source-over';
    const glaze = context.createLinearGradient(0, 0, 0, height);
    glaze.addColorStop(0, 'rgba(255,255,255,.28)');
    glaze.addColorStop(0.28, 'rgba(255,255,255,.04)');
    glaze.addColorStop(1, 'rgba(30,0,55,.18)');
    context.fillStyle = glaze;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
    context.lineWidth = unit;
  }

  rebuildShell() {
    const context = this.shellContext;
    const theme = themes[state.theme];
    const width = this.width;
    const height = this.height;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    const wax = context.createLinearGradient(0, 0, width, height);
    wax.addColorStop(0, '#fff9ed');
    wax.addColorStop(0.28, theme.palette[4] || '#ffe7f5');
    wax.addColorStop(0.62, '#f8dff2');
    wax.addColorStop(1, '#e8c8ed');
    context.fillStyle = wax;
    context.fillRect(0, 0, width, height);

    context.globalAlpha = 0.2;
    context.strokeStyle = theme.accent;
    context.lineWidth = Math.max(12, Math.min(width, height) * 0.055);
    context.lineCap = 'round';
    for (let row = 0; row < 6; row += 1) {
      context.beginPath();
      context.moveTo(-width * 0.08, height * (0.08 + row * 0.19));
      context.bezierCurveTo(width * 0.28, height * (0.02 + row * 0.2), width * 0.64, height * (0.23 + row * 0.15), width * 1.08, height * (0.09 + row * 0.18));
      context.stroke();
    }

    context.globalCompositeOperation = 'destination-out';
    context.globalAlpha = 1;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    this.cracks.forEach((crack) => {
      context.lineWidth = crack.width;
      context.beginPath();
      context.moveTo(crack.x1 * width, crack.y1 * height);
      context.lineTo(crack.x2 * width, crack.y2 * height);
      context.stroke();
    });
    this.chips.forEach((chip) => {
      context.beginPath();
      for (let point = 0; point < chip.sides; point += 1) {
        const angle = chip.phase + point * TAU / chip.sides;
        const px = chip.x * width + Math.cos(angle) * chip.radius;
        const py = chip.y * height + Math.sin(angle) * chip.radius;
        if (point === 0) context.moveTo(px, py); else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    });
    context.globalCompositeOperation = 'source-over';
    this.shellDirty = false;
  }

  drawCrackDepth() {
    const context = this.context;
    context.save();
    context.globalCompositeOperation = 'multiply';
    context.globalAlpha = 0.18;
    context.strokeStyle = '#281326';
    context.lineCap = 'round';
    this.cracks.forEach((crack) => {
      context.lineWidth = crack.width * 1.55;
      context.beginPath();
      context.moveTo(crack.x1 * this.width + 1.4, crack.y1 * this.height + 1.8);
      context.lineTo(crack.x2 * this.width + 1.4, crack.y2 * this.height + 1.8);
      context.stroke();
    });
    context.restore();
  }

  render() {
    this.drawBase();
    this.drawCrackDepth();
    if (this.shellDirty) this.rebuildShell();
    this.context.drawImage(this.shellCanvas, 0, 0, this.width, this.height);
  }

  update(dt) {
    this.renderElapsed += dt;
    this.folds.forEach((fold) => { fold.age += dt / 1000; });
    this.folds = this.folds.filter((fold) => fold.age < 2.7);
    if (this.renderElapsed >= 1000 / 30) {
      this.render();
      this.renderElapsed %= 1000 / 30;
    }
  }

  get shellIntegrity() {
    return Number(clamp(1 - (this.cracks.length + this.chips.length * 2) / 390, 0, 1).toFixed(2));
  }

  dispose() {}
}

class BingsuSlimeEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.beads = [];
    this.folds = [];
    this.compression = 0;
    this.renderElapsed = 1000;
    this.createBeads();
  }

  createBeads() {
    const count = isMobile ? 220 : 320;
    const beadColors = ['#c9fffb', '#63f2d7', '#ff8ce5', '#fff05e', '#879cff', '#ff70b6'];
    this.beads = Array.from({ length: count }, (_, index) => {
      const x = Math.random();
      const y = Math.random();
      return {
        x,
        y,
        homeX: x,
        homeY: y,
        vx: 0,
        vy: 0,
        angle: Math.random() * TAU,
        spin: 0,
        size: randomBetween(0.72, 1.38),
        color: beadColors[index % beadColors.length],
      };
    });
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.25 : 1.55);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  touch(x, y, dx, dy) {
    const nx = clamp(x / this.width, 0, 1);
    const ny = clamp(y / this.height, 0, 1);
    const ndx = dx / this.width;
    const ndy = dy / this.height;
    const radius = 0.19;
    let compressed = 0;
    this.beads.forEach((bead) => {
      const offsetX = bead.x - nx;
      const offsetY = bead.y - ny;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > radius) return;
      const influence = (1 - distance / radius) ** 2;
      bead.vx += ndx * influence * 0.48 - offsetY * influence * 0.0018;
      bead.vy += ndy * influence * 0.48 + offsetX * influence * 0.0018;
      bead.spin += (ndx - ndy) * influence * 0.24;
      compressed += 1;
    });
    this.compression = Math.max(this.compression, compressed / Math.max(1, this.beads.length));
    const newest = this.folds[0];
    if (newest && newest.age < 0.1 && Math.hypot(newest.x - nx, newest.y - ny) < 0.1) {
      newest.x += (nx - newest.x) * 0.35;
      newest.y += (ny - newest.y) * 0.35;
      newest.age = 0;
      newest.strength = Math.min(1, newest.strength + 0.08);
    } else {
      this.folds.unshift({ x: nx, y: ny, age: 0, strength: 0.55 });
      this.folds.length = Math.min(this.folds.length, 7);
    }
  }

  update(dt) {
    const frameScale = dt / 16.6667;
    this.renderElapsed += dt;
    this.compression *= 0.9 ** frameScale;
    this.folds.forEach((fold) => { fold.age += dt / 1000; });
    this.folds = this.folds.filter((fold) => fold.age < 2.5);
    this.beads.forEach((bead) => {
      bead.vx += (bead.homeX - bead.x) * 0.00055 * frameScale;
      bead.vy += (bead.homeY - bead.y) * 0.00055 * frameScale;
      bead.vx *= 0.84 ** frameScale;
      bead.vy *= 0.84 ** frameScale;
      bead.spin *= 0.8 ** frameScale;
      bead.x += bead.vx * frameScale;
      bead.y += bead.vy * frameScale;
      bead.angle += bead.spin * frameScale;
      if (bead.x < 0.005 || bead.x > 0.995) { bead.x = clamp(bead.x, 0.005, 0.995); bead.vx *= -0.42; }
      if (bead.y < 0.005 || bead.y > 0.995) { bead.y = clamp(bead.y, 0.005, 0.995); bead.vy *= -0.42; }
    });
    if (this.renderElapsed >= 1000 / 30) {
      this.render();
      this.renderElapsed %= 1000 / 30;
    }
  }

  render() {
    const context = this.context;
    const theme = themes[state.theme];
    const palette = theme.dyePalette;
    const width = this.width;
    const height = this.height;
    const unit = Math.min(width, height) / 390;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, theme.base);
    base.addColorStop(0.28, palette[0]);
    base.addColorStop(0.58, palette[2] || palette[1]);
    base.addColorStop(1, palette[1]);
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.22;
    context.lineCap = 'round';
    for (let ribbon = 0; ribbon < 4; ribbon += 1) {
      context.strokeStyle = palette[(ribbon + 1) % palette.length];
      context.lineWidth = Math.min(width, height) * (0.2 + ribbon * 0.018);
      context.beginPath();
      context.moveTo(-width * 0.1, height * (0.12 + ribbon * 0.24));
      context.bezierCurveTo(width * 0.22, height * (0.32 + ribbon * 0.14), width * 0.73, height * (0.02 + ribbon * 0.24), width * 1.1, height * (0.2 + ribbon * 0.22));
      context.stroke();
    }

    context.globalCompositeOperation = 'overlay';
    this.folds.forEach((fold) => {
      const fade = Math.max(0, 1 - fold.age / 2.5) * fold.strength;
      const radius = Math.min(width, height) * 0.17;
      const gradient = context.createRadialGradient(fold.x * width, fold.y * height, radius * 0.08, fold.x * width, fold.y * height, radius);
      gradient.addColorStop(0, `rgba(20,0,45,${0.42 * fade})`);
      gradient.addColorStop(0.38, `rgba(255,255,255,${0.3 * fade})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.globalAlpha = 1;
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(fold.x * width, fold.y * height, radius, 0, TAU);
      context.fill();
    });

    context.globalCompositeOperation = 'source-over';
    this.beads.forEach((bead) => {
      const length = (6.4 + bead.size * 5.6) * unit;
      const thickness = (2.35 + bead.size * 1.75) * unit;
      context.save();
      context.translate(bead.x * width, bead.y * height);
      context.rotate(bead.angle);
      context.globalAlpha = 0.8;
      context.fillStyle = bead.color;
      context.beginPath();
      context.roundRect(-length / 2, -thickness / 2, length, thickness, thickness * 0.5);
      context.fill();
      context.globalAlpha = 0.36;
      context.strokeStyle = '#fff';
      context.lineWidth = Math.max(0.55, unit * 0.8);
      context.stroke();
      context.globalAlpha = 0.26;
      context.fillStyle = '#281747';
      context.beginPath();
      context.roundRect(-length * 0.27, -thickness * 0.16, length * 0.54, thickness * 0.32, thickness * 0.16);
      context.fill();
      context.globalAlpha = 0.62;
      context.strokeStyle = '#fff';
      context.lineWidth = Math.max(0.45, unit * 0.55);
      context.beginPath();
      context.moveTo(-length * 0.31, -thickness * 0.19);
      context.lineTo(length * 0.2, -thickness * 0.19);
      context.stroke();
      context.restore();
    });

    const glaze = context.createLinearGradient(0, 0, width, height);
    glaze.addColorStop(0, 'rgba(255,255,255,.34)');
    glaze.addColorStop(0.32, 'rgba(255,255,255,.03)');
    glaze.addColorStop(0.72, 'rgba(255,255,255,.12)');
    glaze.addColorStop(1, 'rgba(32,0,58,.2)');
    context.globalAlpha = 1;
    context.fillStyle = glaze;
    context.fillRect(0, 0, width, height);
  }

  dispose() {}
}

const audio = new SlimeAudio();
const toppings = new ToppingLayer(toppingContext);
let fluid = null;
let cloudSlime = null;
let puttySlime = null;
let waxSlime = null;
let bingsuSlime = null;
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

let lastTextureHaptic = 0;

function haptic(pattern = 10, weight = 1.35) {
  if (!('vibrate' in navigator)) return false;
  const weightedPattern = Array.isArray(pattern)
    ? pattern.map((duration, index) => index % 2 === 0 ? Math.round(duration * weight) : duration)
    : Math.round(pattern * weight);
  navigator.vibrate(weightedPattern);
  state.hapticCueCount += 1;
  return true;
}

function textureHaptic(speed, lag, touches) {
  const now = performance.now();
  if (now - lastTextureHaptic < 88 + Math.random() * 42) return;
  lastTextureHaptic = now;
  const strength = clamp(speed / 24 + lag / 90 + touches * 0.12, 0.2, 1.2);
  const pattern = strength > 0.78 ? [15, 9, 11] : strength > 0.42 ? [10, 7, 7] : 7;
  if (haptic(pattern, 1.25)) state.textureHapticCount += 1;
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
    densityDissipation: 0.1,
    velocityDissipation: 6.4,
    pressure: 0.96,
    pressureIterations: isMobile ? 34 : 42,
    curl: prefersReducedMotion ? 0.7 : 2.2,
    splatRadius: isMobile ? 4.2 : 3.6,
    splatForce: isMobile ? 1300 : 1550,
    shading: true,
    colorful: true,
    colorUpdateSpeed: 0.45,
    colorPalette: theme.dyePalette,
    hover: false,
    backgroundColor: theme.base,
    transparent: false,
    brightness: 0.86,
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
    state.settlingPointers = [];
    state.averagePointerLag = 0;
    if (fluid) {
      const oldSimulation = fluid.simulation;
      fluid.stop();
      oldSimulation.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    fluid = null;
    cloudSlime?.dispose();
    cloudSlime = null;
    puttySlime?.dispose();
    puttySlime = null;
    waxSlime?.dispose();
    waxSlime = null;
    bingsuSlime?.dispose();
    bingsuSlime = null;
    if (replace) replaceSlimeCanvas();
    fluidStage.style.background = themes[state.theme].base;
    slimeCanvas.style.backgroundColor = themes[state.theme].base;
    fluidStage.classList.remove('fluid-fallback');
    fluidStage.classList.toggle('cloud-volume', state.slimeType === 'cloud3d');
    fluidStage.classList.toggle('putty-mode', state.slimeType === 'putty');
    fluidStage.classList.toggle('wax-mode', state.slimeType === 'wax');
    fluidStage.classList.toggle('bingsu-mode', state.slimeType === 'bingsu');
    if (state.slimeType === 'cloud3d') {
      cloudSlime = new CloudSlimeEngine(slimeCanvas);
      cloudSlime.resize(state.toppingWidth, state.toppingHeight);
      bindSlimeInput();
      state.webglAvailable = true;
      return;
    }
    if (state.slimeType === 'putty') {
      puttySlime = new PuttyEngine(slimeCanvas);
      puttySlime.resize(state.toppingWidth, state.toppingHeight);
      bindSlimeInput();
      state.webglAvailable = true;
      return;
    }
    if (state.slimeType === 'wax') {
      waxSlime = new WaxCrackleEngine(slimeCanvas);
      waxSlime.resize(state.toppingWidth, state.toppingHeight);
      bindSlimeInput();
      state.webglAvailable = true;
      return;
    }
    if (state.slimeType === 'bingsu') {
      bingsuSlime = new BingsuSlimeEngine(slimeCanvas);
      bingsuSlime.resize(state.toppingWidth, state.toppingHeight);
      bindSlimeInput();
      state.webglAvailable = true;
      return;
    }
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
      14,
    );
  }
  scheduleSeed(() => {
    fluid?.setConfig({ splatRadius: isMobile ? 2.6 : 2.2 });
    addSwirlGrid(state.playMode ? 12 : 10, 0.13);
    scheduleSeed(() => fluid?.setConfig({ splatRadius: isMobile ? 4.2 : 3.6 }), 90);
  }, 80);
  scheduleSeed(addMarblingVeins, 360);
}

function normalizedFluidColor(hex, intensity = 0.18) {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  return { r: red * intensity, g: green * intensity, b: blue * intensity };
}

function localFluidSplat(x, y, dx, dy, color, intensity = 0.12, forceScale = 7.5) {
  if (!fluid || !state.toppingWidth || !state.toppingHeight) return;
  const palette = themes[state.theme].dyePalette;
  const selectedColor = color || palette[Math.floor(Math.random() * palette.length)];
  fluid.simulation.gl.disable(fluid.simulation.gl.BLEND);
  fluid.simulation.splat(
    clamp(x / state.toppingWidth, 0, 1),
    clamp(1 - y / state.toppingHeight, 0, 1),
    clamp(dx * forceScale, -420, 420),
    clamp(-dy * forceScale, -420, 420),
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
    localFluidSplat(x, y, Math.cos(angle) * 32, Math.sin(angle) * 32, theme.dyePalette[index % theme.dyePalette.length], intensity, 14);
  }
}

function addMarblingVeins() {
  if (!fluid) return;
  const theme = themes[state.theme];
  const veinColors = [0, 3, 1];
  fluid.setConfig({ splatRadius: isMobile ? 1.8 : 1.55 });
  for (let band = 0; band < 3; band += 1) {
    const color = theme.dyePalette[veinColors[band] % theme.dyePalette.length];
    for (let point = 0; point < 32; point += 1) {
      const t = point / 31;
      const phase = band * 1.7;
      const x = state.toppingWidth * (0.035 + t * 0.93);
      const y = state.toppingHeight * (
        0.18 + band * 0.31 + Math.sin(t * TAU * (1.35 + band * 0.2) + phase) * (0.055 + band * 0.008)
      );
      const tangentY = Math.cos(t * TAU * (1.35 + band * 0.2) + phase) * 0.8;
      localFluidSplat(x, y, 0.7, tangentY * 0.5, color, 0.075, 1.2);
    }
  }
  scheduleSeed(() => fluid?.setConfig({ splatRadius: isMobile ? 4.2 : 3.6 }), 70);
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
  state.settlingPointers = state.settlingPointers.filter((pointer) => pointer.id !== event.pointerId);
  state.activePointers.set(event.pointerId, {
    id: event.pointerId,
    x: position.x,
    y: position.y,
    slimeX: position.x,
    slimeY: position.y,
    lastX: position.x,
    lastY: position.y,
    speed: 0,
    moveCount: 0,
    colorIndex,
    color: palette[colorIndex],
  });
  const nudge = event.pressure > 0 ? event.pressure * 8 : 4;
  if (state.slimeType === 'liquidy') localFluidSplat(position.x, position.y, nudge, -nudge * 0.4, palette[colorIndex], 0.02, 4);
  else if (state.slimeType === 'cloud3d') cloudSlime?.touch(position.x, position.y, nudge, -nudge * 0.4);
  else if (state.slimeType === 'putty') puttySlime?.touch(position.x, position.y, nudge, -nudge * 0.4);
  else if (state.slimeType === 'wax') waxSlime?.touch(position.x, position.y, nudge, -nudge * 0.4);
  else bingsuSlime?.touch(position.x, position.y, nudge, -nudge * 0.4);
  toppings.stir(position.x, position.y, nudge, -nudge, 0.35);
  if (state.slimeType === 'bingsu') {
    audio.squelch(0.48 + state.activePointers.size * 0.1, 0.9);
    audio.crunchTexture('bingsu', 0.94, { force: true });
  } else {
    audio.squelch(state.slimeType === 'wax' ? 0.28 : 0.44 + state.activePointers.size * 0.12, state.slimeType === 'wax' ? 0.78 : 1 - state.activePointers.size * 0.06);
  }
  if (state.slimeType !== 'wax') {
    const pressPattern = state.slimeType === 'bingsu'
      ? [13, 6, 10, 6, 8]
      : state.activePointers.size > 1 ? [18, 14, 16] : [16, 11, 13];
    haptic(pressPattern, 1.3);
  }
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
  state.interactionEnergy = clamp(state.interactionEnergy + speed * 0.018, 0, 10);
}

function pointerUp(event) {
  const pointer = state.activePointers.get(event.pointerId);
  if (!pointer) return;
  state.activePointers.delete(event.pointerId);
  pointer.settleRemaining = 340;
  state.settlingPointers.push(pointer);
  audio.release(pointer.speed);
  haptic([13, 20, 18], 1.28);
}

function handleCanvasKey(event) {
  if (!state.started) return;
  const centerX = state.toppingWidth / 2;
  const centerY = state.toppingHeight / 2;
  const directions = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
  if (directions[event.key]) {
    event.preventDefault();
    const [dx, dy] = directions[event.key];
    if (state.slimeType === 'liquidy') localFluidSplat(centerX, centerY, dx, dy, themes[state.theme].dyePalette[0], 0);
    else if (state.slimeType === 'cloud3d') cloudSlime?.touch(centerX, centerY, dx, dy);
    else if (state.slimeType === 'putty') puttySlime?.touch(centerX, centerY, dx, dy);
    else if (state.slimeType === 'wax') waxSlime?.touch(centerX, centerY, dx, dy);
    else bingsuSlime?.touch(centerX, centerY, dx, dy);
    toppings.stir(centerX, centerY, dx, dy, 0.7);
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
  cloudSlime?.resize(state.toppingWidth, state.toppingHeight);
  puttySlime?.resize(state.toppingWidth, state.toppingHeight);
  waxSlime?.resize(state.toppingWidth, state.toppingHeight);
  bingsuSlime?.resize(state.toppingWidth, state.toppingHeight);
  toppings.render();
}

function updatePointerPhysics(dt) {
  const touchCount = state.activePointers.size;
  const draggingPointers = [...state.activePointers.values(), ...state.settlingPointers];
  if (!draggingPointers.length) {
    state.averagePointerLag = 0;
    return;
  }

  const frameScale = dt / 16.6667;
  const followAmount = 1 - Math.exp(-dt / SLIME_TOUCH_LAG_MS);
  const maxStep = SLIME_MAX_STEP_PER_FRAME * frameScale;
  let heldSpeed = 0;
  let totalLag = 0;

  draggingPointers.forEach((pointer) => {
    const isActive = state.activePointers.has(pointer.id);
    if (isActive) heldSpeed += pointer.speed;
    pointer.speed *= 0.84 ** frameScale;

    const offsetX = pointer.x - pointer.slimeX;
    const offsetY = pointer.y - pointer.slimeY;
    const lag = Math.hypot(offsetX, offsetY);
    if (isActive) totalLag += lag;
    if (lag < 0.08) return;

    let moveX = offsetX * followAmount;
    let moveY = offsetY * followAmount;
    const requestedStep = Math.hypot(moveX, moveY);
    if (requestedStep > maxStep) {
      const limit = maxStep / requestedStep;
      moveX *= limit;
      moveY *= limit;
    }

    pointer.slimeX += moveX;
    pointer.slimeY += moveY;
    pointer.moveCount += 1;
    if (pointer.moveCount % 36 === 0) {
      const palette = themes[state.theme].dyePalette;
      pointer.colorIndex = (pointer.colorIndex + 1) % palette.length;
      pointer.color = palette[pointer.colorIndex];
    }

    const ribbonIntensity = pointer.moveCount % 12 === 0 ? 0.032 : 0;
    if (state.slimeType === 'liquidy') localFluidSplat(pointer.slimeX, pointer.slimeY, moveX, moveY, pointer.color, ribbonIntensity, 6);
    else if (state.slimeType === 'cloud3d') cloudSlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY);
    else if (state.slimeType === 'putty') puttySlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY);
    else if (state.slimeType === 'wax') waxSlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY);
    else bingsuSlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY);
    toppings.stir(pointer.slimeX, pointer.slimeY, moveX, moveY, 0.48 + Math.max(1, touchCount) * 0.07);
    state.stirCount += 1;
  });

  state.settlingPointers = state.settlingPointers.filter((pointer) => {
    pointer.settleRemaining -= dt;
    return pointer.settleRemaining > 0 && Math.hypot(pointer.x - pointer.slimeX, pointer.y - pointer.slimeY) > 0.35;
  });
  state.averagePointerLag = touchCount ? totalLag / touchCount : 0;
  if (touchCount) {
    const averageSpeed = Math.max(3.5, heldSpeed / touchCount);
    if (audio.wetDrag(averageSpeed, touchCount)) textureHaptic(averageSpeed, state.averagePointerLag, touchCount);
  }
}

function updateGame(dt) {
  state.time += dt;
  state.interactionEnergy *= 0.982 ** (dt / 16.6667);
  updatePointerPhysics(dt);
  cloudSlime?.update(dt);
  puttySlime?.update(dt);
  waxSlime?.update(dt);
  bingsuSlime?.update(dt);
  toppings.update(dt);
}

function frame(timestamp) {
  const dt = state.lastTimestamp ? clamp(timestamp - state.lastTimestamp, 8, 34) : 16.6667;
  state.lastTimestamp = timestamp;
  updateGame(dt);
  if (timestamp - state.lastToppingRenderTime >= 30) {
    toppings.render();
    state.lastToppingRenderTime = timestamp;
  }
  requestAnimationFrame(frame);
}

function saveRecipe() {
  try {
    localStorage.setItem('rye-ryes-slime-time-recipe', JSON.stringify({ theme: state.theme, muted: state.muted }));
  } catch {
    // Persistence is a convenience, never a requirement for play.
  }
}

function updateMixChoice(button) {
  const type = button.dataset.mix;
  const count = state.mixins.get(type) || 0;
  button.dataset.count = String(count);
  button.classList.toggle('added', count > 0);
  button.classList.toggle('maxed', count === MAX_MIX_BATCHES);
  button.querySelector('.mix-count').textContent = `${count}/${MAX_MIX_BATCHES}`;
  button.setAttribute('aria-label', `${MIX_LABELS[type]}, ${count} of ${MAX_MIX_BATCHES} batches added`);
}

function clearMixins() {
  MIX_TYPES.forEach((type) => state.mixins.set(type, 0));
  document.querySelectorAll('.mix-choice').forEach(updateMixChoice);
  toppings.syncMixins();
}

const stepOrder = ['type', 'base', 'mix', 'squish'];
const stepDetails = {
  type: { name: 'CHOOSE A TYPE', shortName: 'choose a slime type', hint: '1 · Pick how it feels!' },
  base: { name: 'CHOOSE A COLOR', shortName: 'choose slime color', hint: '2 · Choose your colors!' },
  mix: { name: 'ADD MIX-INS', shortName: 'add mix-ins', hint: '3 · Add your mix-ins!' },
  squish: { name: 'READY TO SQUISH', shortName: 'squish your slime', hint: '4 · Ready to squish!' },
};

function setStep(step, { feedback = true } = {}) {
  const stepIndex = stepOrder.indexOf(step);
  if (stepIndex < 0) return;
  state.step = step;
  document.querySelectorAll('.step-content').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === step));
  stepCount.textContent = `STEP ${stepIndex + 1} OF ${stepOrder.length}`;
  stepName.textContent = stepDetails[step].name;
  previousStepButton.disabled = stepIndex === 0;
  nextStepButton.disabled = stepIndex === stepOrder.length - 1;
  nextStepLabel.textContent = step === 'type' ? 'COLORS' : step === 'base' ? 'MIX-INS' : step === 'mix' ? 'SQUISH' : 'DONE';
  previousStepButton.setAttribute('aria-label', stepIndex === 0 ? 'No previous step' : `Back to ${stepDetails[stepOrder[stepIndex - 1]].shortName}`);
  nextStepButton.setAttribute('aria-label', stepIndex === stepOrder.length - 1 ? 'All steps complete' : `Next step: ${stepDetails[stepOrder[stepIndex + 1]].shortName}`);
  if (feedback) {
    audio.release(step === 'base' ? 5 : step === 'mix' ? 9 : 13);
    haptic(6);
    showHint(stepDetails[step].hint, 1200);
  }
}

function moveStep(direction) {
  const nextIndex = clamp(stepOrder.indexOf(state.step) + direction, 0, stepOrder.length - 1);
  if (stepOrder[nextIndex] !== state.step) setStep(stepOrder[nextIndex]);
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
  showHint(stepDetails[state.step].hint, 1800);
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
    if (state.slimeType !== 'wax' && state.slimeType !== 'bingsu') initFluid({ replace: true, seedDelay: 90 });
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
    if (state.slimeType !== 'wax' && state.slimeType !== 'bingsu') initFluid({ replace: true, seedDelay: 90 });
  }, 470);
}

function goHome() {
  if (state.playMode) exitPlayMode();
  state.started = false;
  clearMixins();
  setStep('type', { feedback: false });
  welcomeCard.classList.remove('hidden');
  welcomeCard.inert = false;
  welcomeCard.removeAttribute('aria-hidden');
  makerPanel.classList.remove('play-mode');
  makerPanel.inert = false;
  makerPanel.removeAttribute('aria-hidden');
  hideHint();
  audio.release(5);
}

function resetSlime() {
  initFluid({ replace: true, seedDelay: 120 });
  clearMixins();
  toppings.spawnBaseTexture();
  toppings.syncMixins();
  audio.squelch(0.75, 0.68);
  haptic([8, 20, 12]);
  showHint('Fresh slime!', 1100);
}

document.querySelector('#startButton').addEventListener('click', startMaking);
makerPanel.addEventListener('click', () => {
  if (!state.started) startMaking();
}, { capture: true });
previousStepButton.addEventListener('click', () => moveStep(-1));
nextStepButton.addEventListener('click', () => moveStep(1));
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

document.querySelectorAll('.type-choice').forEach((button) => {
  const selected = button.dataset.slimeType === state.slimeType;
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    state.slimeType = button.dataset.slimeType;
    document.querySelectorAll('.type-choice').forEach((choice) => {
      const isSelected = choice === button;
      choice.classList.toggle('selected', isSelected);
      choice.setAttribute('aria-pressed', String(isSelected));
    });
    initFluid({ replace: true, seedDelay: 100 });
    const previewPitch = state.slimeType === 'cloud3d' ? 0.72
      : state.slimeType === 'putty' ? 0.88
        : state.slimeType === 'wax' ? 0.8
          : state.slimeType === 'bingsu' ? 1.05
            : 1;
    audio.squelch(state.slimeType === 'wax' ? 0.58 : 0.82, previewPitch);
    haptic([18, 14, 20, 12, 24]);
    const names = {
      liquidy: 'Liquidy Swirl',
      cloud3d: 'Cloud Slime 3D',
      wax: 'Crackle Shell',
      bingsu: 'Bingsu Crunch',
      putty: 'Stretchy Putty',
    };
    showHint(`${names[state.slimeType]}! Now pick colors`, 900);
    window.setTimeout(() => {
      if (state.step === 'type' && state.slimeType === button.dataset.slimeType) setStep('base');
    }, 260);
  });
});

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
  updateMixChoice(button);
  button.addEventListener('click', () => {
    const count = state.mixins.get(mix) || 0;
    if (count >= MAX_MIX_BATCHES) {
      showHint(`${MIX_LABELS[mix]} is full at 5!`, 1100);
      audio.release(6);
      haptic([4, 18, 4]);
      return;
    }
    const nextCount = count + 1;
    state.mixins.set(mix, nextCount);
    updateMixChoice(button);
    const batch = toppings.addBatch(mix);
    toppings.burst(mix, batch);
    splashMix(mix);
    audio.sparkle();
    haptic([4, 16, 4, 16, 7]);
    showHint(`${MIX_LABELS[mix]} · ${nextCount} of ${MAX_MIX_BATCHES}!`, 1100);
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
  recipe: { slimeType: state.slimeType, theme: state.theme, themeName: themes[state.theme].name, mixinBatches: Object.fromEntries(state.mixins) },
  simulation: {
    engine: !state.webglAvailable ? 'animated gradient fallback' : ({
      liquidy: 'WebGL Fluid Enhanced Eulerian solver',
      cloud3d: 'Three.js Marching Cubes closed volumetric metaball surface with physical lighting',
      wax: 'Canvas2D persistent brittle-shell fracture over a thick slime field',
      bingsu: 'Canvas2D damped structural tube-bead field in translucent thick slime',
      putty: 'Matter.js constrained soft-body spring lattice',
    })[state.slimeType],
    coverage: 'full-stage',
    stage: { width: Math.round(state.toppingWidth), height: Math.round(state.toppingHeight) },
    splatCount: state.splatCount,
    stirCount: state.stirCount,
    interactionEnergy: Number(state.interactionEnergy.toFixed(2)),
    averagePointerLag: Number(state.averagePointerLag.toFixed(1)),
    motionProfile: 'extra thick: 315ms touch lag, broad low-force impulses, very strong velocity damping, low curl',
    activeTouches: state.activePointers.size,
    settlingDrags: state.settlingPointers.length,
  },
  toppings: {
    total: toppings.particles.length,
    visibleMixins: MIX_TYPES.filter((type) => (state.mixins.get(type) || 0) > 0).map((type) => ({
      type,
      batches: state.mixins.get(type),
      particles: toppings.particles.filter((particle) => particle.type === type).length,
    })),
  },
  structuralTexture: state.slimeType === 'cloud3d' ? {
    kind: 'stable volumetric snow-slime folds',
    geometryRebuilds: cloudSlime?.rebuildCount || 0,
    activeFolds: cloudSlime?.touchFolds.length || 0,
    rebuildCadence: isMobile ? 'fixed 25fps while deforming; frozen while idle' : 'fixed 30fps while deforming; frozen while idle',
  } : state.slimeType === 'wax' ? {
    kind: 'hardened wax shell',
    fractureBursts: waxSlime?.fractureBursts || 0,
    crackSegments: waxSlime?.cracks.length || 0,
    shellIntegrity: waxSlime?.shellIntegrity ?? 1,
  } : state.slimeType === 'bingsu' ? {
    kind: 'intrinsic iridescent tube beads',
    beadCount: bingsuSlime?.beads.length || 0,
    compression: Number((bingsuSlime?.compression || 0).toFixed(2)),
  } : null,
  sound: state.muted ? 'off' : 'on',
  soundProfile: state.slimeType === 'wax'
    ? 'one-time brittle wax snap, persistent dry crackles, soft slime underneath'
    : state.slimeType === 'bingsu'
      ? 'dense randomized plastic crunch grains, wet thick squish, occasional trapped-air pops'
      : 'soft wet squelch, airy foam crackle, irregular crunchy mush',
  cloudSlimeTextureBursts: audio.textureBurstCount,
  mushBursts: audio.mushBurstCount,
  foamCrunchBursts: audio.foamCrunchCount,
  waxCrackleGrains: audio.waxCrackleCount,
  bingsuCrunchGrains: audio.bingsuCrunchCount,
  trappedAirPops: audio.airPopCount,
  hapticsAvailable: 'vibrate' in navigator,
  hapticCues: state.hapticCueCount,
  textureHapticPulses: state.textureHapticCount,
});

window.advanceTime = (milliseconds) => {
  const steps = Math.max(1, Math.round(milliseconds / 16.6667));
  for (let index = 0; index < steps; index += 1) {
    updateGame(16.6667);
  }
  toppings.render();
};
