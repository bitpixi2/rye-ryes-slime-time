import WebGLFluidEnhanced from 'webgl-fluid-enhanced';
import * as THREE from 'three';
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

exitPlayButton.inert = true;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const TAU = Math.PI * 2;
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.25 : 1.6));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 3;
    this.touches = Array.from({ length: 5 }, () => new THREE.Vector4(-2, -2, 0, 0.08));
    this.uniforms = {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color() },
      uColorB: { value: new THREE.Color() },
      uColorC: { value: new THREE.Color() },
      uColorD: { value: new THREE.Color() },
      uTouches: { value: this.touches },
    };
    this.geometry = new THREE.PlaneGeometry(2, 2, isMobile ? 48 : 72, isMobile ? 36 : 54);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform float uTime;
        uniform vec4 uTouches[5];
        varying vec2 vUv;
        varying float vHeight;
        float heightAt(vec2 uv) {
          float h = 0.16 * sin(uv.x * 8.0 + uTime * 0.34) * sin(uv.y * 6.2 - uTime * 0.26);
          h += 0.09 * sin((uv.x + uv.y) * 15.0 - uTime * 0.18);
          for (int i = 0; i < 5; i++) {
            vec2 delta = uv - uTouches[i].xy;
            h -= uTouches[i].z * exp(-dot(delta, delta) / max(0.002, uTouches[i].w));
          }
          return h;
        }
        void main() {
          vUv = uv;
          vHeight = heightAt(uv);
          vec3 displaced = position;
          displaced.z += vHeight * 0.72;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        uniform vec3 uColorD;
        uniform vec4 uTouches[5];
        varying vec2 vUv;
        varying float vHeight;
        float heightAt(vec2 uv) {
          float h = 0.16 * sin(uv.x * 8.0 + uTime * 0.34) * sin(uv.y * 6.2 - uTime * 0.26);
          h += 0.09 * sin((uv.x + uv.y) * 15.0 - uTime * 0.18);
          for (int i = 0; i < 5; i++) {
            vec2 delta = uv - uTouches[i].xy;
            h -= uTouches[i].z * exp(-dot(delta, delta) / max(0.002, uTouches[i].w));
          }
          return h;
        }
        void main() {
          float eps = 0.006;
          float hx = heightAt(vUv + vec2(eps, 0.0));
          float hy = heightAt(vUv + vec2(0.0, eps));
          vec3 normal = normalize(vec3((vHeight - hx) * 6.0, (vHeight - hy) * 6.0, 1.0));
          vec3 lightDir = normalize(vec3(-0.45, 0.55, 1.0));
          float diffuse = 0.58 + max(0.0, dot(normal, lightDir)) * 0.58;
          float specular = pow(max(0.0, dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0))), 22.0);
          float a = 0.5 + 0.5 * sin(vUv.x * 9.0 + vUv.y * 2.5 + uTime * 0.22 + vHeight * 5.0);
          float b = 0.5 + 0.5 * sin(vUv.y * 10.5 - vUv.x * 3.2 - uTime * 0.18);
          float c = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 8.0 + uTime * 0.13);
          vec3 color = mix(uColorA, uColorB, smoothstep(0.18, 0.82, a));
          color = mix(color, uColorC, smoothstep(0.35, 0.88, b) * 0.72);
          color = mix(color, uColorD, smoothstep(0.58, 0.96, c) * 0.46);
          color = clamp((color - 0.5) * 1.28 + 0.5, 0.0, 1.0);
          color *= diffuse;
          color += specular * 0.38 + smoothstep(0.04, 0.24, vHeight) * 0.08;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);
    this.setTheme();
  }

  setTheme() {
    const palette = themes[state.theme].dyePalette;
    this.uniforms.uColorA.value.set(palette[0]);
    this.uniforms.uColorB.value.set(palette[1]);
    this.uniforms.uColorC.value.set(palette[2]);
    this.uniforms.uColorD.value.set(palette[3] || palette[0]);
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(1, height);
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
    this.mesh.scale.set(aspect * 1.12, 1.12, 1);
  }

  touch(x, y, dx, dy) {
    this.touches.pop();
    this.touches.unshift(new THREE.Vector4(
      clamp(x / state.toppingWidth, 0, 1),
      clamp(1 - y / state.toppingHeight, 0, 1),
      clamp(0.18 + Math.hypot(dx, dy) * 0.018, 0.18, 0.55),
      0.024 + Math.min(0.035, Math.hypot(dx, dy) * 0.0015),
    ));
    this.uniforms.uTouches.value = this.touches;
  }

  update(dt) {
    this.uniforms.uTime.value += dt / 1000;
    this.touches.forEach((touch) => { touch.z *= 0.955 ** (dt / 16.6667); });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
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

const audio = new SlimeAudio();
const toppings = new ToppingLayer(toppingContext);
let fluid = null;
let cloudSlime = null;
let puttySlime = null;
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
    if (replace) replaceSlimeCanvas();
    fluidStage.style.background = themes[state.theme].base;
    slimeCanvas.style.backgroundColor = themes[state.theme].base;
    fluidStage.classList.remove('fluid-fallback');
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
  else puttySlime?.touch(position.x, position.y, nudge, -nudge * 0.4);
  toppings.stir(position.x, position.y, nudge, -nudge, 0.35);
  audio.squelch(0.44 + state.activePointers.size * 0.12, 1 - state.activePointers.size * 0.06);
  haptic(state.activePointers.size > 1 ? [18, 14, 16] : [16, 11, 13], 1.3);
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
    else puttySlime?.touch(centerX, centerY, dx, dy);
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
    else puttySlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY);
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
    audio.squelch(0.82, state.slimeType === 'cloud3d' ? 0.72 : state.slimeType === 'putty' ? 0.88 : 1);
    haptic([18, 14, 20, 12, 24]);
    const names = { liquidy: 'Liquidy Swirl', cloud3d: 'Cloud Slime 3D', putty: 'Stretchy Putty' };
    showHint(`${names[state.slimeType]}!`, 1200);
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
    engine: !state.webglAvailable ? 'animated gradient fallback' : state.slimeType === 'liquidy'
      ? 'WebGL Fluid Enhanced Eulerian solver'
      : state.slimeType === 'cloud3d'
        ? 'Three.js displaced 3D mesh with custom GPU lighting shader'
        : 'Matter.js constrained soft-body spring lattice',
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
  sound: state.muted ? 'off' : 'on',
  soundProfile: 'soft wet squelch, airy foam crackle, irregular crunchy mush',
  cloudSlimeTextureBursts: audio.textureBurstCount,
  mushBursts: audio.mushBurstCount,
  foamCrunchBursts: audio.foamCrunchCount,
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
