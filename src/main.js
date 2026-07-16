import WebGLFluidEnhanced from 'webgl-fluid-enhanced';
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { StretchyPutty3DEngine } from './putty-3d-engine.js';
import { BingsuSlime3DEngine } from './bingsu-3d-engine.js';
import { SampleLoopAudio } from './sample-loop-audio.js';
import './style.css';

const app = document.querySelector('#app');
const topbar = document.querySelector('.topbar');
const playground = document.querySelector('#playground');
const fluidStage = document.querySelector('#fluidStage');
let slimeCanvas = document.querySelector('#slimeCanvas');
const toppingCanvas = document.querySelector('#toppingCanvas');
const toppingContext = toppingCanvas.getContext('2d');
const makerPanel = document.querySelector('#makerPanel');
const hintBubble = document.querySelector('#hintBubble');
const soundButton = document.querySelector('#soundButton');
const resetButton = document.querySelector('#resetButton');
const exitPlayButton = document.querySelector('#exitPlayButton');
const previousStepButton = document.querySelector('#previousStepButton');
const nextStepButton = document.querySelector('#nextStepButton');
const stepCount = document.querySelector('#stepCount');
const stepName = document.querySelector('#stepName');
const nextStepLabel = document.querySelector('#nextStepLabel');
const splashGate = document.querySelector('#splashGate');

exitPlayButton.inert = true;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// Desktop uses the same explicit press-and-drag contact model as touch.
// The former cursor-hover contact remains disabled because it was unreliable.
const desktopHoverEnabled = false;
const DESKTOP_HOVER_POINTER_ID = 'desktop-hover';
const TAU = Math.PI * 2;
const SLIME_TYPES = ['liquidy', 'cloud3d', 'bingsu', 'putty'];
const MIX_TYPES = ['sprinkles', 'animals', 'beads', 'glitter'];
const MIX_LABELS = { sprinkles: 'Sprinkles', animals: 'Animals', beads: 'Beads', glitter: 'Stars' };
const LIQUID_CONTRAST_PALETTES = {
  berry: ['#35f4dd', '#fff06a', '#ff4aab', '#72a5ff'],
  lime: ['#8f3dff', '#ff4da6', '#294cff', '#fff15c'],
  mango: ['#21e0dc', '#8045ff', '#18b7ff', '#ff3f93'],
  aqua: ['#ff6f3d', '#ff4bb7', '#dfff43', '#8d43ff'],
};
const MAX_MIX_BATCHES = 5;
const SLIME_TOUCH_LAG_MS = 315;
const SLIME_MAX_STEP_PER_FRAME = 4.2;
const INTERACTION_PROFILES = {
  liquidy: { lagMs: 285, maxStep: 4.6 },
  putty: { lagMs: 245, maxStep: 5.25 },
};
const interactionProfile = (type) => INTERACTION_PROFILES[type] || {
  lagMs: SLIME_TOUCH_LAG_MS,
  maxStep: SLIME_MAX_STEP_PER_FRAME,
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

const themes = {
  berry: {
    name: 'Berry',
    palette: ['#ff3f91', '#ff79c5', '#a74df4', '#6d24d6', '#ffd0e8'],
    dyePalette: ['#ff297f', '#b03df2', '#5a16c8', '#28d8ca'],
    base: '#58148f',
    accent: '#ff4d9d',
  },
  lime: {
    name: 'Lime',
    palette: ['#dfff4f', '#7df38d', '#2ed49c', '#f6ffad', '#44b968'],
    dyePalette: ['#dfff4f', '#7df38d', '#2ed49c', '#44b968'],
    base: '#44b96d',
    accent: '#d8ff4d',
  },
  mango: {
    name: 'Mango',
    palette: ['#ffd83f', '#ff9845', '#ff5d70', '#ffbd55', '#fff09a'],
    dyePalette: ['#ffd83f', '#ff9845', '#ff5d70', '#ffbd55'],
    base: '#f06a55',
    accent: '#ffd63f',
  },
  aqua: {
    name: 'Aqua',
    palette: ['#5ff9e6', '#23d0dc', '#2b91f0', '#b8fff4', '#5b63e7'],
    dyePalette: ['#5ff9e6', '#23d0dc', '#2b91f0', '#5b63e7'],
    base: '#2596c7',
    accent: '#56f6df',
  },
};

const state = {
  started: true,
  startupSplashVisible: true,
  startupSplashPhase: 'ready',
  playMode: false,
  step: 'type',
  typeChosen: false,
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
  liquidClickCount: 0,
  desktopHoverInside: false,
  desktopSpacePressed: false,
  desktopHoverMoves: 0,
  desktopPresses: 0,
  desktopPressFrames: 0,
};

const requestedSlimeType = new URLSearchParams(window.location.search).get('type');
if (SLIME_TYPES.includes(requestedSlimeType)) {
  state.slimeType = requestedSlimeType;
  state.typeChosen = true;
}

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
    this.compressor = null;
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
    this.placeholderPopCount = 0;
    this.shinySparkleCount = 0;
    this.lastCrunchSound = { wax: 0, bingsu: 0 };
    this.interactionEffectsEnabled = false;
  }

  init() {
    if (state.muted) return;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.master.gain.value = 0.62;
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.16;
      this.master.connect(this.compressor).connect(this.context.destination);
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
    if (!this.interactionEffectsEnabled) return false;
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
    const dragDelay = {
      liquidy: [82, 142],
      cloud3d: [92, 154],
      wax: [132, 205],
      bingsu: [68, 118],
      putty: [104, 168],
    }[state.slimeType] || [82, 148];
    this.nextDragDelay = randomBetween(...dragDelay);
    // Retain this cadence return value for haptics, but do not layer the old
    // synthesized drag sound over the uploaded sample loop.
    if (!this.interactionEffectsEnabled) return true;
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
    const suction = this.context.createBufferSource();
    const suctionFilter = this.context.createBiquadFilter();
    const suctionGain = this.context.createGain();

    const profile = {
      liquidy: { wet: 155, wetRange: 330, foam: 680, foamRange: 980, suction: 96 },
      cloud3d: { wet: 92, wetRange: 220, foam: 920, foamRange: 1250, suction: 72 },
      wax: { wet: 145, wetRange: 170, foam: 1450, foamRange: 850, suction: 88 },
      bingsu: { wet: 125, wetRange: 260, foam: 980, foamRange: 1650, suction: 84 },
      putty: { wet: 175, wetRange: 280, foam: 520, foamRange: 780, suction: 112 },
    }[state.slimeType];

    goosh.buffer = this.noiseBuffer;
    goosh.playbackRate.value = 0.4 + amount * 0.3;
    gooshFilter.type = 'lowpass';
    gooshFilter.frequency.value = profile.wet + amount * profile.wetRange + touches * 14;
    gooshFilter.Q.value = 0.9;
    gooshGain.gain.setValueAtTime(0.0001, now);
    gooshGain.gain.exponentialRampToValueAtTime(0.022 + amount * 0.045, now + 0.026);
    gooshGain.gain.setValueAtTime(0.019 + amount * 0.036, now + 0.09);
    gooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    foam.buffer = this.foamBuffer;
    foam.playbackRate.value = 0.9 + Math.random() * 0.55 + amount * 0.22;
    foamFilter.type = 'bandpass';
    foamFilter.frequency.value = profile.foam + amount * profile.foamRange + Math.random() * 260;
    foamFilter.Q.value = 0.75 + touches * 0.16;
    foamGain.gain.setValueAtTime(0.0001, now);
    foamGain.gain.exponentialRampToValueAtTime(0.012 + amount * 0.026, now + 0.012);
    foamGain.gain.setValueAtTime(0.01 + amount * 0.02, now + 0.07);
    foamGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    suction.buffer = this.noiseBuffer;
    suction.playbackRate.value = 0.22 + amount * 0.13;
    suctionFilter.type = 'bandpass';
    suctionFilter.frequency.setValueAtTime(profile.suction + amount * 42, now);
    suctionFilter.frequency.exponentialRampToValueAtTime(Math.max(48, profile.suction * 0.62), now + 0.24);
    suctionFilter.Q.value = 1.45;
    suctionGain.gain.setValueAtTime(0.0001, now);
    suctionGain.gain.exponentialRampToValueAtTime(0.014 + amount * 0.018, now + 0.035);
    suctionGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    goosh.connect(gooshFilter).connect(gooshGain).connect(this.master);
    foam.connect(foamFilter).connect(foamGain).connect(this.master);
    suction.connect(suctionFilter).connect(suctionGain).connect(this.master);
    goosh.start(now);
    foam.start(now + Math.random() * 0.018);
    suction.start(now + 0.006);
    goosh.stop(now + 0.22);
    foam.stop(now + 0.19);
    suction.stop(now + 0.27);
    if (state.slimeType === 'bingsu') this.crunchTexture('bingsu', amount * 1.08);
    return true;
  }

  crunchTexture(kind = 'bingsu', intensity = 0.7, { first = false, force = false } = {}) {
    if (!this.interactionEffectsEnabled) return false;
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
    if (!this.interactionEffectsEnabled) return false;
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

  sparkle(kind = 'sprinkles') {
    this.init();
    if (!this.context || state.muted) return;
    const sprinkle = kind === 'sprinkles';
    const notes = sprinkle ? [1046.5, 1396.9, 1760, 2349.3, 3136] : [987.8, 1318.5, 1760, 2217.5];
    notes.forEach((frequency, index) => {
      const now = this.context.currentTime + index * (sprinkle ? 0.038 : 0.046);
      const glint = this.context.createOscillator();
      const glintFilter = this.context.createBiquadFilter();
      const glintGain = this.context.createGain();
      const foam = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      glint.type = index % 2 === 0 ? 'sine' : 'triangle';
      glint.frequency.setValueAtTime(frequency * randomBetween(0.985, 1.018), now);
      glint.frequency.exponentialRampToValueAtTime(frequency * 1.035, now + 0.09);
      glintFilter.type = 'highpass';
      glintFilter.frequency.value = 760;
      glintGain.gain.setValueAtTime(0.0001, now);
      glintGain.gain.exponentialRampToValueAtTime(sprinkle ? 0.027 : 0.019, now + 0.006);
      glintGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13 + index * 0.008);
      foam.buffer = this.foamBuffer;
      foam.playbackRate.value = 1.8 + Math.random() * 1.4;
      filter.type = 'highpass';
      filter.frequency.value = 1800 + index * 310 + Math.random() * 240;
      filter.Q.value = 0.72;
      gain.gain.setValueAtTime(sprinkle ? 0.014 : 0.01, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      glint.connect(glintFilter).connect(glintGain).connect(this.master);
      foam.connect(filter).connect(gain).connect(this.master);
      glint.start(now);
      foam.start(now);
      glint.stop(now + 0.16 + index * 0.008);
      foam.stop(now + 0.085);
    });
    this.shinySparkleCount += notes.length;
    this.foamCrunchCount += notes.length;
  }

  pop() {
    this.init();
    if (!this.context || state.muted) return false;
    const now = this.context.currentTime;
    const bubble = this.context.createOscillator();
    const bubbleGain = this.context.createGain();
    const snap = this.context.createBufferSource();
    const snapFilter = this.context.createBiquadFilter();
    const snapGain = this.context.createGain();
    bubble.type = 'sine';
    bubble.frequency.setValueAtTime(210, now);
    bubble.frequency.exponentialRampToValueAtTime(72, now + 0.12);
    bubbleGain.gain.setValueAtTime(0.055, now);
    bubbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    snap.buffer = this.foamBuffer;
    snap.playbackRate.value = 2.4;
    snapFilter.type = 'highpass';
    snapFilter.frequency.value = 1250;
    snapGain.gain.setValueAtTime(0.024, now);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    bubble.connect(bubbleGain).connect(this.master);
    snap.connect(snapFilter).connect(snapGain).connect(this.master);
    bubble.start(now);
    snap.start(now);
    bubble.stop(now + 0.15);
    snap.stop(now + 0.065);
    this.placeholderPopCount += 1;
    return true;
  }
}

class ToppingLayer {
  constructor(context) {
    this.context = context;
    this.particles = [];
    this.palette = themes[state.theme].palette;
    this.anchoredRedistributions = 0;
    this.removedWithPuffs = 0;
    this.removedWithPuffByType = new Map();
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
    const particle = {
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
    if (type === 'animals') particle.animalKind = ['bear', 'bunny', 'cat', 'dog'][Math.floor(Math.random() * 4)];
    return particle;
  }

  countFor(type) {
    const mobileCounts = { sprinkles: 30, animals: 8, beads: 16, glitter: 32 };
    const desktopCounts = { sprinkles: 46, animals: 12, beads: 24, glitter: 48 };
    return (isMobile ? mobileCounts : desktopCounts)[type] || 20;
  }

  syncMixins({ recolor = false } = {}) {
    this.palette = themes[state.theme].palette;
    const baseTexture = this.particles.filter((particle) => particle.type === 'bubble');
    const syncedParticles = [...baseTexture];
    for (const type of MIX_TYPES) {
      const batches = state.mixins.get(type) || 0;
      if (batches === 0) this.removedWithPuffByType.delete(type);
      const desired = Math.max(0, this.countFor(type) * batches - (this.removedWithPuffByType.get(type) || 0));
      const existing = this.particles.filter((particle) => particle.type === type).slice(0, desired);
      syncedParticles.push(...existing);
      for (let index = existing.length; index < desired; index += 1) syncedParticles.push(this.makeParticle(type));
    }
    this.particles = syncedParticles;
    if (recolor) {
      this.particles.forEach((particle, index) => {
        particle.color = this.palette[(index * 3 + MIX_TYPES.indexOf(particle.type) + 1) % this.palette.length];
      });
    }
    this.attachToMaterial(this.particles);
  }

  addBatch(type) {
    const batch = [];
    for (let index = 0; index < this.countFor(type); index += 1) batch.push(this.makeParticle(type));
    this.particles.push(...batch);
    return batch;
  }

  removePuffParticles(particles) {
    const removable = particles.filter((particle) => particle.type !== 'bubble');
    if (!removable.length) return 0;
    const removalSet = new Set(removable);
    removable.forEach((particle) => {
      this.removedWithPuffs += 1;
      this.removedWithPuffByType.set(particle.type, (this.removedWithPuffByType.get(particle.type) || 0) + 1);
    });
    this.particles = this.particles.filter((particle) => !removalSet.has(particle));
    return removable.length;
  }

  removeForPuff(anchorIndex) {
    const removed = this.removePuffParticles(this.particles.filter((particle) => (
      particle.anchorKind === 'puffy' && particle.anchorIndex === anchorIndex
    )));
    if (removed) this.render();
    return removed;
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
      if (particle.anchorKind === 'cloud' && cloudSlime?.blobs?.length) {
        const targetX = clamp(particle.x + ndx * influence * 3.1, 0.02, 0.98);
        const targetY = clamp(particle.y + ndy * influence * 3.1, 0.02, 0.98);
        const nearest = cloudSlime.blobs
          .map((blob, index) => ({
            index,
            x: blob.x,
            y: 1 - blob.y,
            distance: Math.hypot(targetX - blob.x, targetY - (1 - blob.y)),
          }))
          .sort((first, second) => first.distance - second.distance)[0];
        particle.anchorIndex = nearest.index;
        particle.anchorOffsetX = clamp(targetX - nearest.x, -0.085, 0.085);
        particle.anchorOffsetY = clamp(targetY - nearest.y, -0.085, 0.085);
        particle.spin += (ndx - ndy) * influence * 0.012;
        this.anchoredRedistributions += 1;
        continue;
      }
      if (particle.anchorKind === 'putty' && puttySlime?.surfacePoint) {
        const current = puttySlime.surfacePoint(particle.anchorT, 0);
        const nearby = puttySlime.surfacePoint(clamp(particle.anchorT + 0.018, 0, 1), 0);
        if (current && nearby) {
          const tangentX = nearby.x - current.x;
          const tangentY = nearby.y - current.y;
          const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
          const unitX = tangentX / tangentLength;
          const unitY = tangentY / tangentLength;
          particle.anchorT = clamp(
            particle.anchorT + (ndx * unitX + ndy * unitY) * influence * 3.8,
            0.025,
            0.975,
          );
          particle.anchorSide = clamp(
            particle.anchorSide + (-ndx * unitY + ndy * unitX) * influence * 1.8,
            -0.075,
            0.075,
          );
          particle.spin += (ndx - ndy) * influence * 0.012;
          this.anchoredRedistributions += 1;
        }
        continue;
      }
      if (particle.anchorKind) continue;
      particle.vx += ndx * influence * 0.72 - offsetY * influence * 0.003;
      particle.vy += ndy * influence * 0.72 + offsetX * influence * 0.003;
      particle.spin += (ndx - ndy) * influence * 0.008;
    }
  }

  burst(type, particles = this.particles.filter((item) => item.type === type)) {
    if (state.slimeType === 'bingsu') {
      const cells = bingsuSlime?.activeCellIndices || [];
      if (!cells.length) {
        this.removePuffParticles(particles);
        return;
      }
      const start = Math.floor(Math.random() * cells.length);
      particles.forEach((particle, index) => {
        const anchorIndex = cells[(start + index * 11) % cells.length];
        const surface = bingsuSlime.surfacePoint(anchorIndex);
        if (!surface) return;
        const angle = index * 2.39996;
        const radius = randomBetween(0.006, 0.032);
        particle.x = surface.x + Math.cos(angle) * radius;
        particle.y = surface.y + Math.sin(angle) * radius;
        particle.preferredPuffIndex = anchorIndex;
      });
      this.attachToMaterial(particles);
      return;
    }
    if (state.slimeType === 'cloud3d' && cloudSlime?.blobs?.length) {
      const start = Math.floor(Math.random() * cloudSlime.blobs.length);
      particles.forEach((particle, index) => {
        const blob = cloudSlime.blobs[(start + index * 11) % cloudSlime.blobs.length];
        const angle = index * 2.39996 + Math.random() * 0.3;
        const radius = randomBetween(0.018, 0.075);
        particle.x = clamp(blob.x + Math.cos(angle) * radius, 0.02, 0.98);
        particle.y = clamp(1 - blob.y + Math.sin(angle) * radius, 0.02, 0.98);
      });
      this.attachToMaterial(particles);
      return;
    }
    if (state.slimeType === 'putty' && puttySlime?.surfacePoint) {
      particles.forEach((particle, index) => {
        const evenlySpaced = (index + 0.5) / particles.length;
        const amount = clamp(0.035 + evenlySpaced * 0.93 + randomBetween(-0.012, 0.012), 0.035, 0.965);
        const side = randomBetween(-0.064, 0.064);
        const surface = puttySlime.surfacePoint(amount, side);
        if (surface) {
          particle.x = surface.x;
          particle.y = surface.y;
          particle.preferredAnchorT = amount;
        }
      });
      this.attachToMaterial(particles);
      return;
    }
    const centerX = randomBetween(0.25, 0.75);
    const centerY = randomBetween(0.2, 0.8);
    for (const particle of particles) {
      const angle = Math.random() * TAU;
      particle.x = clamp(centerX + Math.cos(angle) * randomBetween(0.01, 0.16), 0.02, 0.98);
      particle.y = clamp(centerY + Math.sin(angle) * randomBetween(0.01, 0.16), 0.02, 0.98);
      particle.vx += Math.cos(angle) * randomBetween(0.0005, 0.0022);
      particle.vy += Math.sin(angle) * randomBetween(0.0005, 0.0022);
    }
    this.attachToMaterial(particles);
  }

  clearAnchor(particle) {
    delete particle.anchorKind;
    delete particle.anchorIndex;
    delete particle.anchorOffsetX;
    delete particle.anchorOffsetY;
    delete particle.anchorT;
    delete particle.anchorSide;
    delete particle.anchorAngle;
    delete particle.preferredPuffIndex;
    delete particle.removeWithPuff;
  }

  attachToMaterial(particles = this.particles) {
    const attachable = particles.filter((particle) => particle.type !== 'bubble');
    if (state.slimeType === 'bingsu') {
      const activeCells = bingsuSlime?.activeCellIndices || [];
      if (!activeCells.length) {
        this.removePuffParticles(attachable);
        return;
      }
      attachable.forEach((particle) => {
        const preferred = Number.isInteger(particle.preferredPuffIndex) && activeCells.includes(particle.preferredPuffIndex)
          ? particle.preferredPuffIndex
          : null;
        const nearest = preferred ?? activeCells
          .map((index) => ({ index, surface: bingsuSlime.surfacePoint(index) }))
          .filter(({ surface }) => surface)
          .sort((first, second) => (
            Math.hypot(particle.x - first.surface.x, particle.y - first.surface.y)
            - Math.hypot(particle.x - second.surface.x, particle.y - second.surface.y)
          ))[0]?.index;
        const surface = bingsuSlime.surfacePoint(nearest);
        if (!surface) {
          this.clearAnchor(particle);
          return;
        }
        particle.anchorKind = 'puffy';
        particle.anchorIndex = nearest;
        particle.anchorOffsetX = clamp(particle.x - surface.x, -0.04, 0.04);
        particle.anchorOffsetY = clamp(particle.y - surface.y, -0.035, 0.035);
        particle.vx = 0;
        particle.vy = 0;
        delete particle.preferredPuffIndex;
      });
      return;
    }
    if (state.slimeType === 'cloud3d' && cloudSlime?.blobs?.length) {
      attachable.forEach((particle) => {
        const nearest = cloudSlime.blobs
          .map((blob, index) => ({
            index,
            x: blob.x,
            y: 1 - blob.y,
            distance: Math.hypot(particle.x - blob.x, particle.y - (1 - blob.y)),
          }))
          .sort((first, second) => first.distance - second.distance)[0];
        particle.anchorKind = 'cloud';
        particle.anchorIndex = nearest.index;
        particle.anchorOffsetX = clamp(particle.x - nearest.x, -0.065, 0.065);
        particle.anchorOffsetY = clamp(particle.y - nearest.y, -0.065, 0.065);
        particle.vx = 0;
        particle.vy = 0;
      });
      return;
    }
    if (state.slimeType === 'putty' && puttySlime?.metrics?.endpoints?.length === 2) {
      const [start, finish] = puttySlime.metrics.endpoints;
      const lineX = finish.x - start.x;
      const lineY = finish.y - start.y;
      const lineLengthSquared = Math.max(0.0001, lineX * lineX + lineY * lineY);
      attachable.forEach((particle) => {
        const projectedAmount = ((particle.x - start.x) * lineX + (particle.y - start.y) * lineY) / lineLengthSquared;
        const amount = clamp(
          Number.isFinite(particle.preferredAnchorT) ? particle.preferredAnchorT : projectedAmount,
          0.035,
          0.965,
        );
        delete particle.preferredAnchorT;
        const center = puttySlime.surfacePoint?.(amount, 0);
        const nearby = puttySlime.surfacePoint?.(clamp(amount + 0.018, 0, 1), 0);
        if (!center || !nearby) {
          this.clearAnchor(particle);
          return;
        }
        const tangentX = nearby.x - center.x;
        const tangentY = nearby.y - center.y;
        const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
        const perpendicularX = -tangentY / tangentLength;
        const perpendicularY = tangentX / tangentLength;
        const distanceFromCurve = Math.hypot(particle.x - center.x, particle.y - center.y);
        particle.anchorKind = 'putty';
        particle.anchorT = amount;
        particle.anchorSide = distanceFromCurve > 0.11
          ? randomBetween(-0.045, 0.045)
          : clamp((particle.x - center.x) * perpendicularX + (particle.y - center.y) * perpendicularY, -0.055, 0.055);
        particle.anchorAngle = particle.angle - center.angle;
        const surface = puttySlime.surfacePoint(amount, particle.anchorSide);
        particle.x = surface.x;
        particle.y = surface.y;
        particle.vx = 0;
        particle.vy = 0;
      });
      return;
    }
    attachable.forEach((particle) => this.clearAnchor(particle));
  }

  reanchorAll() {
    this.attachToMaterial(this.particles);
  }

  get distributionMetrics() {
    const decorated = this.particles.filter((particle) => particle.type !== 'bubble');
    const cloudAnchors = new Set(
      decorated.filter((particle) => particle.anchorKind === 'cloud').map((particle) => particle.anchorIndex),
    );
    const puttyAmounts = decorated
      .filter((particle) => particle.anchorKind === 'putty')
      .map((particle) => particle.anchorT);
    const puffyAnchorCounts = decorated
      .filter((particle) => particle.anchorKind === 'puffy')
      .reduce((counts, particle) => counts.set(particle.anchorIndex, (counts.get(particle.anchorIndex) || 0) + 1), new Map());
    return {
      cloudAnchorsUsed: cloudAnchors.size,
      puffyAnchorsUsed: new Set(decorated.filter((particle) => particle.anchorKind === 'puffy').map((particle) => particle.anchorIndex)).size,
      puffyAnchors: [...puffyAnchorCounts].map(([index, count]) => ({ index, count, ...bingsuSlime?.surfacePoint?.(index) })),
      removedWithPuffs: this.removedWithPuffs,
      puttySpan: puttyAmounts.length
        ? Number((Math.max(...puttyAmounts) - Math.min(...puttyAmounts)).toFixed(3))
        : 0,
      redistributions: this.anchoredRedistributions,
    };
  }

  updateAnchor(particle, frame) {
    if (particle.anchorKind === 'puffy' && state.slimeType === 'bingsu' && bingsuSlime?.surfacePoint) {
      const surface = bingsuSlime.surfacePoint(particle.anchorIndex);
      if (!surface || surface.state !== 'active') {
        particle.removeWithPuff = true;
        return true;
      }
      const follow = 1 - 0.12 ** frame;
      particle.x += (surface.x + particle.anchorOffsetX - particle.x) * follow;
      particle.y += (surface.y + particle.anchorOffsetY - particle.y) * follow;
      particle.vx = 0;
      particle.vy = 0;
      return true;
    }
    if (particle.anchorKind === 'cloud' && state.slimeType === 'cloud3d' && cloudSlime?.blobs?.[particle.anchorIndex]) {
      const blob = cloudSlime.blobs[particle.anchorIndex];
      const targetX = blob.x + particle.anchorOffsetX;
      const targetY = 1 - blob.y + particle.anchorOffsetY;
      const follow = 1 - 0.18 ** frame;
      particle.x += (targetX - particle.x) * follow;
      particle.y += (targetY - particle.y) * follow;
      particle.vx = 0;
      particle.vy = 0;
      particle.angle += particle.spin * frame * 0.12;
      return true;
    }
    if (particle.anchorKind === 'putty' && state.slimeType === 'putty' && puttySlime?.surfacePoint) {
      const surface = puttySlime.surfacePoint(particle.anchorT, particle.anchorSide);
      if (surface) {
        const follow = 1 - 0.12 ** frame;
        particle.x += (surface.x - particle.x) * follow;
        particle.y += (surface.y - particle.y) * follow;
        particle.angle = surface.angle + particle.anchorAngle;
        particle.vx = 0;
        particle.vy = 0;
        return true;
      }
    }
    if (particle.anchorKind) this.clearAnchor(particle);
    return false;
  }

  update(milliseconds) {
    const frame = clamp(milliseconds / 16.6667, 0.2, 2.4);
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (this.updateAnchor(particle, frame)) continue;
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
    const removed = this.particles.filter((particle) => particle.removeWithPuff);
    if (removed.length) this.removePuffParticles(removed);
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

  drawAnimalFace(context, radius, kind, color) {
    context.save();
    context.fillStyle = color;
    context.strokeStyle = 'rgba(48,21,55,.42)';
    context.lineWidth = Math.max(1, radius * 0.1);
    if (kind === 'bunny') {
      for (const side of [-1, 1]) {
        context.beginPath();
        context.ellipse(side * radius * 0.42, -radius * 0.88, radius * 0.28, radius * 0.58, side * 0.12, 0, TAU);
        context.fill();
        context.stroke();
      }
    } else if (kind === 'cat') {
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(side * radius * 0.72, -radius * 0.38);
        context.lineTo(side * radius * 0.56, -radius * 1.02);
        context.lineTo(side * radius * 0.1, -radius * 0.62);
        context.closePath();
        context.fill();
        context.stroke();
      }
    } else {
      for (const side of [-1, 1]) {
        context.beginPath();
        const earY = kind === 'dog' ? -radius * 0.35 : -radius * 0.65;
        context.ellipse(side * radius * 0.67, earY, radius * (kind === 'dog' ? 0.34 : 0.3), radius * (kind === 'dog' ? 0.5 : 0.3), side * 0.18, 0, TAU);
        context.fill();
        context.stroke();
      }
    }
    context.beginPath();
    context.arc(0, 0, radius, 0, TAU);
    context.fill();
    context.stroke();
    context.fillStyle = '#302239';
    for (const side of [-1, 1]) {
      context.beginPath();
      context.arc(side * radius * 0.34, -radius * 0.15, radius * 0.09, 0, TAU);
      context.fill();
    }
    context.beginPath();
    context.arc(0, radius * 0.18, radius * 0.13, 0, TAU);
    context.fill();
    context.strokeStyle = '#302239';
    context.lineWidth = Math.max(1, radius * 0.08);
    context.beginPath();
    context.arc(0, radius * 0.16, radius * 0.34, 0.18, Math.PI - 0.18);
    context.stroke();
    context.restore();
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
      if (particle.type === 'bubble' && state.slimeType !== 'liquidy') continue;
      const x = particle.x * width;
      const y = particle.y * height;
      context.save();
      context.translate(x, y);
      context.rotate(particle.angle);
      context.globalAlpha = particle.type === 'bubble' ? 0.3 : particle.type === 'animals' ? 1 : 0.83;

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
      } else if (particle.type === 'animals') {
        const radius = (6.5 + particle.size * 5.2) * unit;
        context.shadowColor = 'rgba(60,0,80,.28)';
        context.shadowBlur = 5 * unit;
        context.shadowOffsetY = 2 * unit;
        this.drawAnimalFace(context, radius, particle.animalKind || 'bear', particle.color);
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
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
    this.baseScale = new THREE.Vector3(1, 1, 1);
    this.targetScale = new THREE.Vector3(1, 1, 1);
    this.hasResized = false;
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
    this.blobs = this.createBlobs();
    this.grabs = new Map();
    this.touchFolds = [];
    this.rebuildElapsed = 0;
    this.rebuildInterval = isMobile ? 40 : 1000 / 30;
    this.dirty = true;
    this.rebuildCount = 0;
    this.setTheme();
    this.rebuildVolume();
  }

  createBlobs() {
    const columns = 5;
    const rows = 6;
    return Array.from({ length: columns * rows }, (_, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const phase = index * 1.913;
      return {
        x: 0.13 + column * 0.185 + Math.sin(phase) * 0.009,
        y: 0.09 + row * 0.164 + Math.cos(phase * 1.17) * 0.009,
        colorIndex: column + row * 2,
        strength: 0.56 + ((index * 7) % 5) * 0.012,
      };
    });
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
    this.baseScale.set(Math.max(1.68, aspect * 2), 2.48 * tallFill, 0.92);
    this.updateTargetScale();
    if (!this.hasResized) this.group.scale.copy(this.targetScale);
    this.hasResized = true;
  }

  updateTargetScale() {
    const spread = this.stackMetrics.spreadRadius;
    const compactness = clamp((0.31 - spread) / 0.2, 0, 1);
    this.targetScale.set(
      THREE.MathUtils.lerp(this.baseScale.x, 2.26, compactness),
      THREE.MathUtils.lerp(this.baseScale.y, 2.26, compactness),
      THREE.MathUtils.lerp(this.baseScale.z, 1.34, compactness),
    );
  }

  touch(x, y, dx, dy, pointerId = 'pointer', isStart = false) {
    const width = Math.max(1, state.toppingWidth);
    const height = Math.max(1, state.toppingHeight);
    const normalizedX = clamp(x / width, 0.04, 0.96);
    const normalizedY = clamp(1 - y / height, 0.04, 0.96);
    if (isStart || !this.grabs.has(pointerId)) {
      if (isStart) {
        const claimed = new Set([...this.grabs.values()].flatMap((grab) => grab.indices));
        const nearest = this.blobs
          .map((blob, index) => ({ index, distance: Math.hypot(blob.x - normalizedX, blob.y - normalizedY) }))
          .filter(({ index }) => !claimed.has(index))
          .sort((a, b) => a.distance - b.distance);
        const local = nearest.filter(({ distance }) => distance < 0.25);
        this.grabs.set(pointerId, {
          indices: (local.length >= 4 ? local : nearest).slice(0, isMobile ? 8 : 7).map(({ index }) => index),
          lastX: normalizedX,
          lastY: normalizedY,
        });
      }
    }
    const grab = this.grabs.get(pointerId);
    if (grab) {
      grab.lastX = normalizedX;
      grab.lastY = normalizedY;
      const moveX = clamp(dx / width * 1.45, -0.055, 0.055);
      const moveY = clamp(-dy / height * 1.45, -0.055, 0.055);
      const grabbed = new Set(grab.indices);
      grab.indices.forEach((index) => {
        const blob = this.blobs[index];
        blob.x = clamp(blob.x + moveX, 0.045, 0.955);
        blob.y = clamp(blob.y + moveY, 0.045, 0.955);
        const compact = Math.hypot(moveX, moveY) > 0.0001 ? 0.022 : 0.006;
        blob.x += (normalizedX - blob.x) * compact;
        blob.y += (normalizedY - blob.y) * compact;
      });
      this.blobs.forEach((blob, index) => {
        if (grabbed.has(index)) return;
        const distance = Math.hypot(blob.x - normalizedX, blob.y - normalizedY);
        if (distance < 0.16) {
          const influence = (1 - distance / 0.16) ** 2 * 0.2;
          blob.x = clamp(blob.x + moveX * influence, 0.045, 0.955);
          blob.y = clamp(blob.y + moveY * influence, 0.045, 0.955);
        }
      });
    }
    const fold = {
      x: normalizedX,
      y: normalizedY,
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

  release(pointerId) {
    const grab = this.grabs.get(pointerId);
    if (grab) {
      grab.indices.forEach((index) => {
        const blob = this.blobs[index];
        blob.x = clamp(blob.x + (grab.lastX - blob.x) * 0.48, 0.045, 0.955);
        blob.y = clamp(blob.y + (grab.lastY - blob.y) * 0.48, 0.045, 0.955);
      });
      this.dirty = true;
    }
    this.grabs.delete(pointerId);
  }

  foldWeight(fold) {
    return fold.strength * Math.max(0, 1 - fold.age / fold.life) ** 2;
  }

  addBaseMass() {
    this.blobs.forEach((blob, index) => {
        let blobX = blob.x;
        let blobY = blob.y;
        const nearby = this.blobs.reduce((count, neighbor, neighborIndex) => (
          neighborIndex !== index && Math.hypot(neighbor.x - blob.x, neighbor.y - blob.y) < 0.145 ? count + 1 : count
        ), 0);
        let blobZ = 0.485 + Math.min(0.19, nearby * 0.026);
        for (const fold of this.touchFolds) {
          const fade = this.foldWeight(fold);
          const distanceSquared = (blob.x - fold.x) ** 2 + (blob.y - fold.y) ** 2;
          const influence = Math.exp(-distanceSquared / 0.025) * fade;
          blobX += fold.pullX * influence * 0.34;
          blobY += fold.pullY * influence * 0.34;
          blobZ -= influence * 0.045 * fold.pressure;
        }
        this.volume.addBall(
          clamp(blobX, 0.045, 0.955),
          clamp(blobY, 0.045, 0.955),
          blobZ,
          blob.strength + Math.min(0.1, nearby * 0.012),
          12,
          this.palette[blob.colorIndex % this.palette.length],
        );
    });
  }

  get stackMetrics() {
    const center = this.blobs.reduce((sum, blob) => ({ x: sum.x + blob.x, y: sum.y + blob.y }), { x: 0, y: 0 });
    center.x /= this.blobs.length;
    center.y /= this.blobs.length;
    const spreadRadius = this.blobs.reduce((sum, blob) => sum + Math.hypot(blob.x - center.x, blob.y - center.y), 0) / this.blobs.length;
    const stackedBlobs = this.blobs.filter((blob, index) => this.blobs.some((other, otherIndex) => (
      otherIndex !== index && Math.hypot(other.x - blob.x, other.y - blob.y) < 0.075
    ))).length;
    return {
      center: { x: Number(center.x.toFixed(2)), y: Number((1 - center.y).toFixed(2)) },
      spreadRadius: Number(spreadRadius.toFixed(2)),
      stackedBlobs,
      activeGrabs: this.grabs.size,
    };
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
    this.blobs.forEach((blob, index) => {
      const nearby = this.blobs.filter((other, otherIndex) => (
        otherIndex !== index && Math.hypot(other.x - blob.x, other.y - blob.y) < 0.145
      )).length;
      for (let fiber = 0; fiber < 2; fiber += 1) {
        const angle = index * 1.73 + fiber * Math.PI;
        this.volume.addBall(
          clamp(blob.x + Math.cos(angle) * 0.026, 0.035, 0.965),
          clamp(blob.y + Math.sin(angle) * 0.022, 0.035, 0.965),
          0.575 + Math.min(0.17, nearby * 0.024),
          0.058 + (index % 3) * 0.004,
          14.2,
          this.palette[(blob.colorIndex + fiber) % this.palette.length],
        );
      }
    });
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
    this.updateTargetScale();
    this.group.scale.lerp(this.targetScale, 1 - Math.exp(-dt / 360));
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

class LegacyBingsuSlimeEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.beads = [];
    this.folds = [];
    this.dyeTrails = [];
    this.lastTrail = null;
    this.trailCanvas = document.createElement('canvas');
    this.trailCanvas.width = 512;
    this.trailCanvas.height = 512;
    this.trailContext = this.trailCanvas.getContext('2d');
    this.flowX = 0;
    this.flowY = 0;
    this.flowTwist = 0;
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
    this.flowX = clamp(this.flowX + dx * 0.82, -this.width * 0.38, this.width * 0.38);
    this.flowY = clamp(this.flowY + dy * 0.82, -this.height * 0.38, this.height * 0.38);
    this.flowTwist = clamp(this.flowTwist + (ndx - ndy) * 3.2, -1.4, 1.4);
    const now = performance.now();
    if (!this.lastTrail || now - this.lastTrail.createdAt > 45 || Math.hypot(this.lastTrail.x - nx, this.lastTrail.y - ny) > 0.035) {
      const trail = {
        x: nx,
        y: ny,
        fromX: clamp(nx - ndx * 3.6, 0, 1),
        fromY: clamp(ny - ndy * 3.6, 0, 1),
        colorIndex: (this.dyeTrails.length * 2 + Math.round(nx * 7) + Math.round(ny * 5)) % themes[state.theme].dyePalette.length,
        size: clamp(0.11 + Math.hypot(dx, dy) / Math.min(this.width, this.height) * 0.8, 0.11, 0.22),
        createdAt: now,
      };
      this.dyeTrails.push(trail);
      this.lastTrail = trail;
      this.stampTrail(trail);
    }
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

  stampTrail(trail) {
    const context = this.trailContext;
    const size = this.trailCanvas.width;
    const palette = themes[state.theme].dyePalette;
    const startX = trail.fromX * size;
    const startY = trail.fromY * size;
    const endX = trail.x * size;
    const endY = trail.y * size;
    context.save();
    // Store one stable colored mark per interaction instead of repeatedly
    // screen-blending the offscreen texture toward white as trails accumulate.
    context.globalCompositeOperation = 'source-over';
    context.lineCap = 'round';
    context.globalAlpha = 0.32;
    context.strokeStyle = palette[trail.colorIndex % palette.length];
    context.lineWidth = size * trail.size;
    context.shadowColor = palette[(trail.colorIndex + 1) % palette.length];
    context.shadowBlur = size * 0.04;
    context.beginPath();
    context.moveTo(startX, startY);
    context.quadraticCurveTo(
      (startX + endX) / 2 + this.flowTwist * 18,
      (startY + endY) / 2 - this.flowTwist * 16,
      endX,
      endY,
    );
    context.stroke();
    context.shadowBlur = 0;
    const bloom = context.createRadialGradient(endX, endY, 0, endX, endY, size * trail.size * 0.75);
    bloom.addColorStop(0, palette[(trail.colorIndex + 2) % palette.length]);
    bloom.addColorStop(1, 'rgba(255,255,255,0)');
    context.globalAlpha = 0.22;
    context.fillStyle = bloom;
    context.beginPath();
    context.arc(endX, endY, size * trail.size * 0.75, 0, TAU);
    context.fill();
    context.restore();
  }

  update(dt) {
    const frameScale = dt / 16.6667;
    this.renderElapsed += dt;
    this.compression *= 0.9 ** frameScale;
    this.flowX *= 0.996 ** frameScale;
    this.flowY *= 0.996 ** frameScale;
    this.flowTwist *= 0.994 ** frameScale;
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
    const base = context.createLinearGradient(
      -width * 0.18 + this.flowX,
      -height * 0.14 + this.flowY,
      width * 1.18 + this.flowX,
      height * 1.14 + this.flowY,
    );
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
      const ribbonFlowX = this.flowX * (0.12 + ribbon * 0.035);
      const ribbonFlowY = this.flowY * (0.1 + ribbon * 0.03);
      const twist = this.flowTwist * height * (0.035 + ribbon * 0.008);
      context.beginPath();
      context.moveTo(-width * 0.1 + ribbonFlowX, height * (0.12 + ribbon * 0.24) + ribbonFlowY - twist);
      context.bezierCurveTo(
        width * 0.22 + ribbonFlowX * 1.8,
        height * (0.32 + ribbon * 0.14) + ribbonFlowY + twist,
        width * 0.73 + ribbonFlowX * 0.7,
        height * (0.02 + ribbon * 0.24) + ribbonFlowY - twist,
        width * 1.1 + ribbonFlowX,
        height * (0.2 + ribbon * 0.22) + ribbonFlowY + twist,
      );
      context.stroke();
    }

    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 1;
    context.drawImage(this.trailCanvas, 0, 0, width, height);

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
const sampleLoops = new SampleLoopAudio({ mode: state.slimeType, muted: state.muted });
const toppings = new ToppingLayer(toppingContext);

function renderMixPreviews() {
  const palette = themes[state.theme].palette;
  document.querySelectorAll('.mix-preview').forEach((canvas) => {
    const context = canvas.getContext('2d');
    const { width, height } = canvas;
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, themes[state.theme].base);
    background.addColorStop(1, themes[state.theme].accent);
    context.clearRect(0, 0, width, height);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const positions = [
      [28, 28], [72, 23], [119, 28], [154, 21],
      [45, 61], [92, 58], [139, 63],
      [25, 94], [72, 91], [119, 96], [158, 88],
    ];
    positions.forEach(([x, y], index) => {
      const color = palette[index % palette.length];
      context.save();
      context.translate(x, y);
      context.rotate((index % 5 - 2) * 0.34);
      if (canvas.dataset.preview === 'sprinkles') {
        const length = 25 + (index % 3) * 3;
        const thickness = 7;
        context.shadowColor = 'rgba(50,0,70,.28)';
        context.shadowBlur = 4;
        context.shadowOffsetY = 2;
        context.fillStyle = color;
        context.beginPath();
        context.roundRect(-length / 2, -thickness / 2, length, thickness, thickness);
        context.fill();
        context.globalAlpha = 0.34;
        context.fillStyle = '#fff';
        context.fillRect(-length * 0.28, -thickness * 0.26, length * 0.42, thickness * 0.2);
      } else if (canvas.dataset.preview === 'animals' && index < 4) {
        toppings.drawAnimalFace(context, 15, ['bear', 'bunny', 'cat', 'dog'][index], color);
      } else if (canvas.dataset.preview === 'beads') {
        const radius = 10 + (index % 3);
        const bead = context.createRadialGradient(-radius * 0.4, -radius * 0.42, 0, 0, 0, radius);
        bead.addColorStop(0, '#fff');
        bead.addColorStop(0.18, color);
        bead.addColorStop(1, 'rgba(60,16,88,.72)');
        context.fillStyle = bead;
        context.shadowColor = 'rgba(35,0,55,.28)';
        context.shadowBlur = 4;
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.fill();
      } else if (canvas.dataset.preview === 'glitter') {
        context.fillStyle = index % 2 ? '#fff' : '#fff6a8';
        toppings.drawStar(context, 9 + (index % 3) * 2);
        context.fill();
      }
      context.restore();
    });
  });
}

renderMixPreviews();
let fluid = null;
let cloudSlime = null;
let puttySlime = null;
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
    brightness: 0.8,
    bloom: false,
    sunrays: false,
  };
}

function bindSlimeInput() {
  slimeCanvas.addEventListener('pointerdown', pointerDown, { passive: false });
  slimeCanvas.addEventListener('pointermove', pointerMove, { passive: false });
  slimeCanvas.addEventListener('pointerenter', desktopPointerEnter);
  slimeCanvas.addEventListener('pointerleave', desktopPointerLeave);
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
    state.desktopHoverInside = false;
    state.desktopSpacePressed = false;
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
    bingsuSlime?.dispose();
    bingsuSlime = null;
    if (replace) replaceSlimeCanvas();
    fluidStage.style.background = themes[state.theme].base;
    slimeCanvas.style.backgroundColor = themes[state.theme].base;
    fluidStage.classList.remove('fluid-fallback');
    fluidStage.classList.toggle('cloud-volume', state.slimeType === 'cloud3d');
    playground.classList.toggle('cloud-volume', state.slimeType === 'cloud3d');
    fluidStage.classList.toggle('putty-mode', state.slimeType === 'putty');
    fluidStage.classList.toggle('bingsu-mode', state.slimeType === 'bingsu');
    resizeToppings();
    if (state.slimeType === 'cloud3d') {
      cloudSlime = new CloudSlimeEngine(slimeCanvas);
      cloudSlime.resize(state.toppingWidth, state.toppingHeight);
      toppings.reanchorAll();
      bindSlimeInput();
      state.webglAvailable = true;
      return;
    }
    if (state.slimeType === 'putty') {
      puttySlime = new StretchyPutty3DEngine(slimeCanvas, {
        getTheme: () => themes[state.theme],
        isMobile,
      });
      puttySlime.resize(state.toppingWidth, state.toppingHeight);
      toppings.reanchorAll();
      bindSlimeInput();
      state.webglAvailable = true;
      return;
    }
    if (state.slimeType === 'bingsu') {
      bingsuSlime = new BingsuSlime3DEngine(slimeCanvas, {
        getTheme: () => themes[state.theme],
        isMobile,
      });
      bingsuSlime.resize(state.toppingWidth, state.toppingHeight);
      toppings.reanchorAll();
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
    toppings.reanchorAll();
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

function smooshLiquid(x, y) {
  if (!fluid) return null;
  const contrast = LIQUID_CONTRAST_PALETTES[state.theme] || themes[state.theme].dyePalette;
  const clickIndex = state.liquidClickCount;
  const centerColor = contrast[clickIndex % contrast.length];
  const ringRadius = Math.min(state.toppingWidth, state.toppingHeight) * (isMobile ? 0.1 : 0.086);
  fluid.setConfig({ splatRadius: isMobile ? 4.9 : 4.25 });
  localFluidSplat(x, y, 0, -2.5, centerColor, 0.085, 9);
  for (let index = 0; index < 4; index += 1) {
    const angle = clickIndex * 1.17 + index * TAU / 4;
    const color = contrast[(clickIndex + index + 1) % contrast.length];
    const offsetX = Math.cos(angle) * ringRadius;
    const offsetY = Math.sin(angle) * ringRadius;
    localFluidSplat(
      x + offsetX,
      y + offsetY,
      -Math.cos(angle) * 21,
      -Math.sin(angle) * 21,
      color,
      index % 2 === 0 ? 0.04 : 0.03,
      10,
    );
  }
  state.liquidClickCount += 1;
  scheduleSeed(() => fluid?.setConfig({ splatRadius: isMobile ? 4.2 : 3.6 }), 145);
  return centerColor;
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
    animals: ['#fff36e', '#ff76c5', theme.accent],
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

function isDesktopHoverEvent(event) {
  return desktopHoverEnabled && event.pointerType === 'mouse';
}

function createDesktopHoverPointer(position) {
  const palette = state.slimeType === 'liquidy'
    ? (LIQUID_CONTRAST_PALETTES[state.theme] || themes[state.theme].dyePalette)
    : themes[state.theme].dyePalette;
  const colorIndex = (state.splatCount + state.desktopHoverMoves) % palette.length;
  const pointer = {
    id: DESKTOP_HOVER_POINTER_ID,
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
    desktopHover: true,
    pressing: false,
    pressFrameCount: 0,
  };
  state.activePointers.set(DESKTOP_HOVER_POINTER_ID, pointer);
  return pointer;
}

function ensureDesktopHoverPointer(position) {
  state.settlingPointers = state.settlingPointers.filter((pointer) => pointer.id !== DESKTOP_HOVER_POINTER_ID);
  return state.activePointers.get(DESKTOP_HOVER_POINTER_ID) || createDesktopHoverPointer(position);
}

function desktopPointerEnter(event) {
  if (!state.started || !isDesktopHoverEvent(event)) return;
  state.desktopHoverInside = true;
  ensureDesktopHoverPointer(canvasPosition(event));
}

function updateDesktopHover(event) {
  const position = canvasPosition(event);
  state.desktopHoverInside = true;
  const pointer = ensureDesktopHoverPointer(position);
  const dx = position.x - pointer.lastX;
  const dy = position.y - pointer.lastY;
  const speed = Math.hypot(dx, dy);
  pointer.x = position.x;
  pointer.y = position.y;
  pointer.lastX = position.x;
  pointer.lastY = position.y;
  pointer.speed = speed;
  if (speed > 0.05) {
    state.desktopHoverMoves += 1;
    state.interactionEnergy = clamp(state.interactionEnergy + speed * 0.018, 0, 10);
  }
}

function beginDesktopPress() {
  if (!desktopHoverEnabled || !state.started || !state.desktopHoverInside || state.desktopSpacePressed) return false;
  const pointer = state.activePointers.get(DESKTOP_HOVER_POINTER_ID);
  if (!pointer) return false;
  state.desktopSpacePressed = true;
  state.desktopPresses += 1;
  pointer.pressing = true;
  pointer.pressFrameCount = 0;
  // A deliberate press lands at the visible cursor, not at the lagging trail
  // that gives ordinary hover movement its thick, resistant feel.
  pointer.slimeX = pointer.x;
  pointer.slimeY = pointer.y;
  audio.init();
  sampleLoops.start(state.slimeType);
  sampleLoops.press(1);

  if (state.slimeType === 'liquidy') {
    const contrastColor = smooshLiquid(pointer.x, pointer.y);
    if (contrastColor) pointer.color = contrastColor;
  } else if (state.slimeType === 'cloud3d') {
    cloudSlime?.touch(pointer.x, pointer.y, 0, 0, pointer.id, true);
  } else if (state.slimeType === 'putty') {
    puttySlime?.touch(pointer.x, pointer.y, 0, 0, pointer.id, true);
  } else {
    bingsuSlime?.touch(pointer.x, pointer.y, 0, 0);
  }
  toppings.stir(pointer.x, pointer.y, 0, 0, 0.72);
  audio.squelch(0.72, state.slimeType === 'bingsu' ? 1.02 : 0.82);
  return true;
}

function endDesktopPress({ sound = true } = {}) {
  const pointer = state.activePointers.get(DESKTOP_HOVER_POINTER_ID);
  if (!state.desktopSpacePressed && !pointer?.pressing) return false;
  state.desktopSpacePressed = false;
  if (pointer) pointer.pressing = false;
  cloudSlime?.release?.(DESKTOP_HOVER_POINTER_ID);
  puttySlime?.release?.(DESKTOP_HOVER_POINTER_ID);
  if (sound) audio.release(pointer?.speed || 5);
  return true;
}

function clearDesktopHoverContact({ sound = true } = {}) {
  endDesktopPress({ sound });
  cloudSlime?.release?.(DESKTOP_HOVER_POINTER_ID);
  puttySlime?.release?.(DESKTOP_HOVER_POINTER_ID);
  state.desktopHoverInside = false;
  state.activePointers.delete(DESKTOP_HOVER_POINTER_ID);
  state.settlingPointers = state.settlingPointers.filter((pointer) => pointer.id !== DESKTOP_HOVER_POINTER_ID);
}

function desktopPointerLeave(event) {
  if (!isDesktopHoverEvent(event)) return;
  clearDesktopHoverContact();
}

function pointerDown(event) {
  if (!state.started || state.startupSplashVisible) return;
  event.preventDefault();
  if (isDesktopHoverEvent(event)) {
    state.desktopHoverInside = true;
    ensureDesktopHoverPointer(canvasPosition(event));
    slimeCanvas.focus({ preventScroll: true });
    audio.init();
    hideHint();
    return;
  }
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
    desktopHover: false,
    pressing: true,
  });
  const nudge = event.pressure > 0 ? event.pressure * 8 : 4;
  let completedPuffyPop = false;
  if (state.slimeType === 'liquidy') {
    const contrastColor = smooshLiquid(position.x, position.y);
    if (contrastColor) state.activePointers.get(event.pointerId).color = contrastColor;
  }
  else if (state.slimeType === 'cloud3d') cloudSlime?.touch(position.x, position.y, 0, 0, event.pointerId, true);
  else if (state.slimeType === 'putty') puttySlime?.touch(position.x, position.y, 0, 0, event.pointerId, true);
  else {
    const popResult = bingsuSlime?.touch(position.x, position.y, nudge, -nudge * 0.4, true);
    if (popResult?.popped) {
      completedPuffyPop = true;
      toppings.removeForPuff(popResult.index);
    }
  }
  if (completedPuffyPop) {
    if (state.activePointers.size === 1) sampleLoops.silenceInteraction();
    sampleLoops.playPop(() => audio.pop());
    haptic([18, 22, 32], 1.45);
  } else {
    sampleLoops.start(state.slimeType);
    sampleLoops.press(state.slimeType === 'bingsu' ? 1 : 0.82);
  }
  toppings.stir(position.x, position.y, nudge, -nudge, 0.35);
  if (!completedPuffyPop) {
    if (state.slimeType === 'bingsu') {
      audio.squelch(0.48 + state.activePointers.size * 0.1, 0.9);
      audio.crunchTexture('bingsu', 0.94, { force: true });
    } else {
      audio.squelch(0.44 + state.activePointers.size * 0.12, 1 - state.activePointers.size * 0.06);
    }
    const pressPattern = state.slimeType === 'bingsu'
      ? [13, 6, 10, 6, 8]
      : state.activePointers.size > 1 ? [18, 14, 16] : [16, 11, 13];
    haptic(pressPattern, 1.3);
  }
  hideHint();
}

function pointerMove(event) {
  if (state.started && isDesktopHoverEvent(event)) {
    event.preventDefault();
    updateDesktopHover(event);
    return;
  }
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
  if (isDesktopHoverEvent(event)) return;
  const pointer = state.activePointers.get(event.pointerId);
  if (!pointer) return;
  state.activePointers.delete(event.pointerId);
  if (state.activePointers.size === 0) sampleLoops.silenceInteraction();
  const structuralDrop = state.slimeType === 'cloud3d' || state.slimeType === 'putty';
  const lag = Math.hypot(pointer.x - pointer.slimeX, pointer.y - pointer.slimeY);
  const profile = interactionProfile(state.slimeType);
  pointer.settleRemaining = structuralDrop
    ? clamp(lag / profile.maxStep * 16.6667 + 180, 420, 1800)
    : 340;
  pointer.releaseEngineGrab = structuralDrop;
  state.settlingPointers.push(pointer);
  audio.release(pointer.speed);
  haptic([13, 20, 18], 1.28);
}

function handleCanvasKey(event) {
  if (!state.started) return;
  if (event.code === 'Space' && desktopHoverEnabled) {
    if (state.playMode || state.desktopHoverInside) event.preventDefault();
    beginDesktopPress();
    return;
  }
  const centerX = state.toppingWidth / 2;
  const centerY = state.toppingHeight / 2;
  const directions = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
  if (directions[event.key]) {
    event.preventDefault();
    const [dx, dy] = directions[event.key];
    if (state.slimeType === 'liquidy') localFluidSplat(centerX, centerY, dx, dy, themes[state.theme].dyePalette[0], 0);
    else if (state.slimeType === 'cloud3d') {
      cloudSlime?.touch(centerX, centerY, dx, dy, 'keyboard', true);
      cloudSlime?.release('keyboard');
    } else if (state.slimeType === 'putty') {
      puttySlime?.touch(centerX, centerY, dx, dy, 'keyboard', true);
      puttySlime?.release('keyboard');
    } else bingsuSlime?.touch(centerX, centerY, dx, dy);
    toppings.stir(centerX, centerY, dx, dy, 0.7);
    audio.wetDrag(24, 1);
  }
  if ((!desktopHoverEnabled && event.key === ' ') || event.key === 'Enter') {
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
  bingsuSlime?.resize(state.toppingWidth, state.toppingHeight);
  toppings.render();
}

function applyDesktopPressFrame(pointer, dt, lag) {
  if (!pointer.desktopHover || !pointer.pressing) return;
  pointer.pressFrameCount += 1;
  state.desktopPressFrames += 1;
  const pressX = pointer.x;
  const pressY = pointer.y;

  if (lag < 0.08) {
    if (state.slimeType === 'liquidy') {
      if (pointer.pressFrameCount % 7 === 1) {
        const angle = pointer.pressFrameCount * 0.47;
        localFluidSplat(pressX, pressY, Math.cos(angle) * 3.2, Math.sin(angle) * 3.2, pointer.color, 0, 11);
      }
    } else if (state.slimeType === 'cloud3d') {
      cloudSlime?.touch(pressX, pressY, 0, 0, pointer.id);
    } else if (state.slimeType === 'putty') {
      puttySlime?.touch(pressX, pressY, 0, 0, pointer.id);
    } else {
      bingsuSlime?.touch(pressX, pressY, 0, 0);
    }
  }

  if (pointer.pressFrameCount % 5 === 0) {
    const direction = pointer.pressFrameCount * 0.31;
    toppings.stir(pressX, pressY, Math.cos(direction) * 0.45, Math.sin(direction) * 0.45, 0.86);
  }
}

function updatePointerPhysics(dt) {
  const touchCount = state.activePointers.size;
  const draggingPointers = [...state.activePointers.values(), ...state.settlingPointers];
  if (!draggingPointers.length) {
    state.averagePointerLag = 0;
    return;
  }

  const frameScale = dt / 16.6667;
  const profile = interactionProfile(state.slimeType);
  const followAmount = 1 - Math.exp(-dt / profile.lagMs);
  const maxStep = profile.maxStep * frameScale;
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
    if (isActive) applyDesktopPressFrame(pointer, dt, lag);
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
    const colorChangeCadence = state.slimeType === 'liquidy' ? 18 : 36;
    if (pointer.moveCount % colorChangeCadence === 0) {
      const palette = state.slimeType === 'liquidy'
        ? (LIQUID_CONTRAST_PALETTES[state.theme] || themes[state.theme].dyePalette)
        : themes[state.theme].dyePalette;
      pointer.colorIndex = (pointer.colorIndex + 1) % palette.length;
      pointer.color = palette[pointer.colorIndex];
    }

    const ribbonIntensity = state.slimeType === 'liquidy'
      ? (pointer.moveCount % 5 === 0 ? 0.06 : 0)
      : (pointer.moveCount % 12 === 0 ? 0.032 : 0);
    if (state.slimeType === 'liquidy') localFluidSplat(pointer.slimeX, pointer.slimeY, moveX, moveY, pointer.color, ribbonIntensity, 6);
    else if (state.slimeType === 'cloud3d') cloudSlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY, pointer.id);
    else if (state.slimeType === 'putty') {
      if (pointer.desktopHover && !pointer.pressing) puttySlime?.hover?.(pointer.slimeX, pointer.slimeY, moveX, moveY);
      else puttySlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY, pointer.id);
    }
    else bingsuSlime?.touch(pointer.slimeX, pointer.slimeY, moveX, moveY);
    toppings.stir(pointer.slimeX, pointer.slimeY, moveX, moveY, 0.48 + Math.max(1, touchCount) * 0.07);
    state.stirCount += 1;
  });

  state.settlingPointers = state.settlingPointers.filter((pointer) => {
    pointer.settleRemaining -= dt;
    const keepSettling = pointer.settleRemaining > 0 && Math.hypot(pointer.x - pointer.slimeX, pointer.y - pointer.slimeY) > 0.35;
    if (!keepSettling && pointer.releaseEngineGrab) {
      cloudSlime?.release?.(pointer.id);
      puttySlime?.release?.(pointer.id);
    }
    return keepSettling;
  });
  state.averagePointerLag = touchCount ? totalLag / touchCount : 0;
  const soundingPointers = [...state.activePointers.values()].filter((pointer) => (
    !pointer.desktopHover || pointer.pressing || pointer.speed > 0.4 || Math.hypot(pointer.x - pointer.slimeX, pointer.y - pointer.slimeY) > 0.35
  ));
  if (soundingPointers.length) {
    const averageSpeed = Math.max(3.5, heldSpeed / Math.max(1, soundingPointers.length));
    if (audio.wetDrag(averageSpeed, soundingPointers.length)) {
      textureHaptic(averageSpeed, state.averagePointerLag, soundingPointers.length);
    }
  }
}

function updateGame(dt) {
  state.time += dt;
  state.interactionEnergy *= 0.982 ** (dt / 16.6667);
  updatePointerPhysics(dt);
  const activeContacts = [...state.activePointers.values()];
  const contactSpeed = activeContacts.reduce((sum, pointer) => sum + pointer.speed, 0);
  const contactLag = activeContacts.reduce(
    (sum, pointer) => sum + Math.hypot(pointer.x - pointer.slimeX, pointer.y - pointer.slimeY),
    0,
  );
  const touchHeld = activeContacts.some((pointer) => !pointer.desktopHover && pointer.pressing);
  const hoverFloor = state.desktopHoverInside && activeContacts.length ? 0.07 : 0;
  const touchFloor = touchHeld ? 0.22 : 0;
  const pressBoost = state.desktopSpacePressed ? 0.4 : touchHeld ? 0.26 : 0;
  const motionActivity = activeContacts.length
    ? contactSpeed / (activeContacts.length * 32) + contactLag / (activeContacts.length * 190)
    : 0;
  sampleLoops.update(dt, clamp(hoverFloor + touchFloor + pressBoost + motionActivity, 0, 1));
  cloudSlime?.update(dt);
  puttySlime?.update(dt);
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
  mix: { name: 'ADD TOPPINGS', shortName: 'add toppings', hint: '3 · Add your toppings!' },
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
  nextStepButton.hidden = stepIndex === stepOrder.length - 1;
  nextStepButton.disabled = stepIndex === stepOrder.length - 1;
  nextStepLabel.textContent = step === 'type' ? 'COLORS' : step === 'base' ? 'TOPPINGS' : step === 'mix' ? 'FILL SCREEN' : 'DONE';
  previousStepButton.setAttribute('aria-label', stepIndex === 0 ? 'No previous step' : `Back to ${stepDetails[stepOrder[stepIndex - 1]].shortName}`);
  nextStepButton.setAttribute('aria-label', stepIndex === stepOrder.length - 1 ? 'All steps complete' : `Next step: ${stepDetails[stepOrder[stepIndex + 1]].shortName}`);
  if (feedback) {
    audio.release(step === 'base' ? 5 : step === 'mix' ? 9 : 13);
    haptic(6);
    showHint(stepDetails[step].hint, 1200);
  }
}

function moveStep(direction) {
  if (direction > 0 && state.step === 'mix') {
    enterPlayMode();
    return;
  }
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

function enterPlayMode() {
  if (!state.started || state.playMode) return;
  sampleLoops.selectMode(state.slimeType);
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
    if (state.slimeType === 'liquidy') initFluid({ replace: true, seedDelay: 90 });
    toppings.syncMixins();
    showHint(
      desktopHoverEnabled ? 'Move your mouse • hold Space to press!' : 'Draw slow circles to fold the colors!',
      2200,
    );
  }, 470);
}

function exitPlayMode() {
  if (!state.playMode) return;
  clearDesktopHoverContact({ sound: false });
  sampleLoops.setActivity(0);
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
    if (state.slimeType === 'liquidy') initFluid({ replace: true, seedDelay: 90 });
  }, 470);
}

function goHome() {
  if (state.playMode) exitPlayMode();
  clearDesktopHoverContact({ sound: false });
  sampleLoops.stop();
  state.started = true;
  state.typeChosen = false;
  document.querySelectorAll('.type-choice').forEach((choice) => {
    choice.classList.remove('selected');
    choice.setAttribute('aria-pressed', 'false');
  });
  clearMixins();
  setStep('type', { feedback: false });
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

function dismissStartupSplash(event) {
  if (!state.startupSplashVisible) return;
  event?.preventDefault();
  event?.stopPropagation();
  // Keep audio startup inside this first trusted gesture for mobile browsers.
  audio.init();
  sampleLoops.playTypeSelection();
  haptic([5, 16, 7], 1.1);
  state.startupSplashVisible = false;
  state.startupSplashPhase = 'fading';
  splashGate.classList.add('is-fading');
  splashGate.inert = true;
  splashGate.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    splashGate.hidden = true;
    state.startupSplashPhase = 'hidden';
  }, prefersReducedMotion ? 0 : 1100);
}

previousStepButton.addEventListener('click', () => moveStep(-1));
nextStepButton.addEventListener('click', () => moveStep(1));
document.querySelector('#homeButton').addEventListener('click', goHome);
splashGate.addEventListener('click', dismissStartupSplash, { once: true });
exitPlayButton.addEventListener('click', exitPlayMode);
resetButton.addEventListener('click', resetSlime);

soundButton.classList.toggle('sound-muted', state.muted);
soundButton.setAttribute('aria-pressed', String(!state.muted));
soundButton.setAttribute('aria-label', state.muted ? 'Turn sound on' : 'Turn sound off');
soundButton.addEventListener('click', () => {
  state.muted = !state.muted;
  sampleLoops.setMuted(state.muted);
  soundButton.classList.toggle('sound-muted', state.muted);
  soundButton.setAttribute('aria-pressed', String(!state.muted));
  soundButton.setAttribute('aria-label', state.muted ? 'Turn sound on' : 'Turn sound off');
  if (!state.muted) {
    audio.release(11);
    sampleLoops.silenceInteraction();
  }
  haptic(5);
  saveRecipe();
});

document.querySelectorAll('.type-choice').forEach((button) => {
  const selected = state.typeChosen && button.dataset.slimeType === state.slimeType;
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => {
    state.slimeType = button.dataset.slimeType;
    state.typeChosen = true;
    document.querySelectorAll('.type-choice').forEach((choice) => {
      const isSelected = choice === button;
      choice.classList.toggle('selected', isSelected);
      choice.setAttribute('aria-pressed', String(isSelected));
    });
    initFluid({ replace: true, seedDelay: 100 });
    sampleLoops.selectMode(state.slimeType);
    sampleLoops.playTypeSelection();
    haptic([18, 14, 20, 12, 24]);
    const names = {
      liquidy: 'Glowy',
      cloud3d: 'Blobby',
      bingsu: 'Puffy-Pop',
      putty: 'Stretchy',
    };
    setStep('type', { feedback: false });
    showHint(`${names[state.slimeType]}! Tap the arrow for colors`, 1200);
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
    toppings.syncMixins({ recolor: true });
    renderMixPreviews();
    initFluid({ replace: true, seedDelay: 120 });
    sampleLoops.playColorSelection();
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
      state.mixins.set(mix, 0);
      updateMixChoice(button);
      toppings.syncMixins();
      showHint(`${MIX_LABELS[mix]} cleared!`, 1100);
      haptic([7, 20, 7]);
      saveRecipe();
      return;
    }
    const nextCount = count + 1;
    state.mixins.set(mix, nextCount);
    updateMixChoice(button);
    const batch = toppings.addBatch(mix);
    toppings.burst(mix, batch);
    splashMix(mix);
    audio.sparkle(mix);
    haptic([4, 16, 4, 16, 7]);
    showHint(`${MIX_LABELS[mix]} · ${nextCount} of ${MAX_MIX_BATCHES}!`, 1100);
    saveRecipe();
  });
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && desktopHoverEnabled && state.started) {
    if (state.playMode || state.desktopHoverInside) event.preventDefault();
    if (state.desktopHoverInside) beginDesktopPress();
  }
  if (event.key === 'Escape' && state.playMode) exitPlayMode();
});

document.addEventListener('keyup', (event) => {
  if (event.code !== 'Space' || !desktopHoverEnabled) return;
  if (state.playMode || state.desktopSpacePressed) event.preventDefault();
  endDesktopPress();
});

window.addEventListener('blur', () => clearDesktopHoverContact({ sound: false }));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearDesktopHoverContact({ sound: false });
    sampleLoops.setActivity(0);
  }
  if (!document.hidden && audio.context?.state === 'suspended' && !state.muted) audio.context.resume();
});

new ResizeObserver(resizeToppings).observe(playground);
window.addEventListener('resize', resizeToppings);
setStep('type', { feedback: false });
resizeToppings();
toppings.syncMixins();
initFluid();
requestAnimationFrame(frame);

window.render_game_to_text = () => JSON.stringify({
  coordinateSystem: 'Canvas origin is top-left; x increases right; y increases down; units are CSS pixels.',
  mode: state.startupSplashVisible ? 'startup-splash' : !state.started ? 'welcome' : state.playMode ? 'full-slime' : `making-${state.step}`,
  recipe: { slimeType: state.slimeType, theme: state.theme, themeName: themes[state.theme].name, mixinBatches: Object.fromEntries(state.mixins) },
  simulation: {
    engine: !state.webglAvailable ? 'animated gradient fallback' : ({
      liquidy: 'WebGL Fluid Enhanced Eulerian solver',
      cloud3d: 'Three.js Marching Cubes closed volumetric metaball surface with physical lighting',
      bingsu: 'Three.js layered 3D bingsu bed with compressible raised cells and embedded beads',
      putty: 'Three.js Catmull-Rom TubeGeometry with two independently grabbable 3D ends',
    })[state.slimeType],
    coverage: 'full-stage',
    stage: { width: Math.round(state.toppingWidth), height: Math.round(state.toppingHeight) },
    splatCount: state.splatCount,
    stirCount: state.stirCount,
    interactionEnergy: Number(state.interactionEnergy.toFixed(2)),
    averagePointerLag: Number(state.averagePointerLag.toFixed(1)),
    motionProfile: `extra thick: ${interactionProfile(state.slimeType).lagMs}ms touch lag, ${interactionProfile(state.slimeType).maxStep}px capped step, broad low-force impulses`,
    activeTouches: [...state.activePointers.values()].filter((pointer) => !pointer.desktopHover).length,
    activeContacts: state.activePointers.size,
    settlingDrags: state.settlingPointers.length,
    liquidContrastSmooshes: state.liquidClickCount,
  },
  input: {
    desktopHoverEnabled,
    desktopHoverInside: state.desktopHoverInside,
    desktopHoverContactActive: state.activePointers.has(DESKTOP_HOVER_POINTER_ID),
    spacePressed: state.desktopSpacePressed,
    hoverMoves: state.desktopHoverMoves,
    presses: state.desktopPresses,
    pressFrames: state.desktopPressFrames,
  },
  navigation: {
    startupSplashVisible: state.startupSplashVisible,
    startupSplashPhase: state.startupSplashPhase,
    typeChosen: state.typeChosen,
    nextArrowVisible: !nextStepButton.hidden,
    nextArrowEnabled: !nextStepButton.disabled,
    finalArrowAction: 'fill the screen',
  },
  toppings: {
    total: toppings.particles.length,
    anchoredToMaterial: toppings.particles.filter((particle) => ['cloud', 'puffy', 'putty'].includes(particle.anchorKind)).length,
    distribution: toppings.distributionMetrics,
    visibleMixins: MIX_TYPES.filter((type) => (state.mixins.get(type) || 0) > 0).map((type) => ({
      type,
      batches: state.mixins.get(type),
      particles: toppings.particles.filter((particle) => particle.type === type).length,
      colors: [...new Set(toppings.particles.filter((particle) => particle.type === type).map((particle) => particle.color))],
    })),
  },
  structuralTexture: state.slimeType === 'cloud3d' ? {
    kind: 'persistent grabbable and stackable volumetric snow-slime chunks',
    geometryRebuilds: cloudSlime?.rebuildCount || 0,
    activeFolds: cloudSlime?.touchFolds.length || 0,
    stack: cloudSlime?.stackMetrics || null,
    rebuildCadence: isMobile ? 'fixed 25fps while deforming; frozen while idle' : 'fixed 30fps while deforming; frozen while idle',
  } : state.slimeType === 'bingsu' ? {
    kind: 'layered 3D bingsu chunks that compress downward under pressure',
    heightLevels: bingsuSlime?.levelCount || 0,
    beadCount: bingsuSlime?.beads.length || 0,
    compression: Number((bingsuSlime?.compression || 0).toFixed(2)),
    pops: bingsuSlime?.popMetrics || null,
    dyeTrails: bingsuSlime?.dyeTrails.length || 0,
    trailPersistence: 'permanent until reset or a new slime is chosen',
    flowOffset: {
      x: Number((bingsuSlime?.flowX || 0).toFixed(1)),
      y: Number((bingsuSlime?.flowY || 0).toFixed(1)),
      twist: Number((bingsuSlime?.flowTwist || 0).toFixed(2)),
    },
  } : state.slimeType === 'putty' ? {
    kind: 'two-ended 3D stretchy putty tube',
    ...(puttySlime?.metrics || {}),
  } : null,
  sound: state.muted ? 'off' : 'on',
  soundProfile: state.slimeType === 'bingsu'
      ? 'alternating soft compression loops, then one tightly cropped real pop in two subtle pitches'
      : state.slimeType === 'putty'
        ? 'deep tacky pulls, low suction, soft rubbery foam texture'
        : state.slimeType === 'cloud3d'
          ? 'deep mushy squelch, low suction, airy irregular foam crackle'
          : 'layered wet squelch, low suction, irregular soft foam texture',
  legacyProceduralInteractionAudio: 'disabled; uploaded sample loop only',
  sampleLoop: sampleLoops.metrics,
  cloudSlimeTextureBursts: audio.textureBurstCount,
  mushBursts: audio.mushBurstCount,
  foamCrunchBursts: audio.foamCrunchCount,
  bingsuCrunchGrains: audio.bingsuCrunchCount,
  trappedAirPops: audio.airPopCount,
  placeholderPopSounds: audio.placeholderPopCount,
  shinySparkleNotes: audio.shinySparkleCount,
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
