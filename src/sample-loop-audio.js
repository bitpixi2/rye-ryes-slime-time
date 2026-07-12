const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export const SAMPLE_LOOP_PROFILES = Object.freeze({
  liquidy: Object.freeze({
    file: '/audio/bingsu-crunch-loop.mp3',
    volumeCap: 0.24,
    pressFile: '/audio/bingsu-press-crunch.mp3',
    pressVolumeCap: 0.14,
  }),
  cloud3d: Object.freeze({
    file: '/audio/cloud-slime.mp3',
    volumeCap: 0.145,
  }),
  bingsu: Object.freeze({
    file: '/audio/putty-slosh-loop.mp3',
    volumeCap: 0.095,
  }),
  putty: Object.freeze({
    file: '/audio/liquidy-gel-slime.mp3',
    volumeCap: 0.14,
  }),
});

export const DISCOVERY_SAMPLE = Object.freeze({
  file: '/audio/ui-discovery.mp3',
  volumeCap: 0.035,
});

const round = (value) => Number(value.toFixed(3));

/**
 * Activity-driven slime samples layered under the synthesized sound effects.
 * Call start() from a pointer/keyboard gesture, then setActivity() and update()
 * from the game loop. Every base sample loops silently while activity is zero.
 */
export class SampleLoopAudio {
  constructor({
    mode = 'liquidy',
    muted = false,
    audioFactory,
    fadeInMs = 150,
    fadeOutMs = 260,
  } = {}) {
    this.audioFactory = audioFactory || ((source) => {
      if (typeof Audio === 'undefined') return null;
      return new Audio(source);
    });
    this.fadeInMs = Math.max(24, fadeInMs);
    this.fadeOutMs = Math.max(40, fadeOutMs);
    this.mode = SAMPLE_LOOP_PROFILES[mode] ? mode : 'liquidy';
    this.profile = SAMPLE_LOOP_PROFILES[this.mode];
    this.muted = Boolean(muted);
    this.base = null;
    this.accent = null;
    this.discoveryTrack = null;
    this.started = false;
    this.unlocked = false;
    this.disposed = false;
    this.activity = 0;
    this.currentVolume = 0;
    this.targetVolume = 0;
    this.pressBoost = 0;
    this.pressBoostRemaining = 0;
    this.lastPressAt = -Infinity;
    this.startCount = 0;
    this.pressAccentCount = 0;
    this.discoveryCueCount = 0;
    this.playbackErrors = 0;
    this.prepareModeTracks();
  }

  createTrack(source, { loop = false } = {}) {
    const track = this.audioFactory(source);
    if (!track) return null;
    track.preload = 'auto';
    track.loop = loop;
    track.volume = 0;
    track.setAttribute?.('playsinline', '');
    return track;
  }

  prepareModeTracks() {
    this.base = this.createTrack(this.profile.file, { loop: true });
    this.accent = this.profile.pressFile
      ? this.createTrack(this.profile.pressFile)
      : null;
  }

  releaseTrack(track) {
    if (!track) return;
    track.pause?.();
    try {
      track.currentTime = 0;
    } catch {
      // Some test doubles and not-yet-ready media elements reject seeking.
    }
    track.removeAttribute?.('src');
    track.load?.();
  }

  playTrack(track, { unlockBase = false } = {}) {
    if (!track || this.disposed) return false;
    try {
      const result = track.play?.();
      if (result?.then) {
        result.then(() => {
          if (unlockBase) this.unlocked = true;
        }).catch(() => {
          this.playbackErrors += 1;
        });
      } else if (unlockBase) {
        this.unlocked = true;
      }
      return true;
    } catch {
      this.playbackErrors += 1;
      return false;
    }
  }

  selectMode(mode) {
    if (!SAMPLE_LOOP_PROFILES[mode] || this.disposed) return false;
    if (mode === this.mode) return true;
    this.releaseTrack(this.base);
    this.releaseTrack(this.accent);
    this.mode = mode;
    this.profile = SAMPLE_LOOP_PROFILES[mode];
    this.base = null;
    this.accent = null;
    this.started = false;
    this.unlocked = false;
    this.activity = 0;
    this.currentVolume = 0;
    this.targetVolume = 0;
    this.pressBoost = 0;
    this.pressBoostRemaining = 0;
    this.prepareModeTracks();
    return true;
  }

  select(mode) {
    return this.selectMode(mode);
  }

  /** Start the selected loop at zero volume. Call this inside a user gesture. */
  start(mode = this.mode) {
    if (this.disposed || !SAMPLE_LOOP_PROFILES[mode]) return false;
    if (mode !== this.mode) this.selectMode(mode);
    if (!this.base) return false;
    if (this.started && !this.base.paused) return true;
    this.base.loop = true;
    this.base.volume = this.muted ? 0 : this.currentVolume;
    this.started = true;
    this.startCount += 1;
    return this.playTrack(this.base, { unlockBase: true });
  }

  setActivity(amount) {
    this.activity = clamp(Number.isFinite(amount) ? amount : 0);
    return this.activity;
  }

  silenceInteraction() {
    this.started = false;
    this.activity = 0;
    this.currentVolume = 0;
    this.targetVolume = 0;
    this.pressBoost = 0;
    this.pressBoostRemaining = 0;
    if (this.base) {
      this.base.volume = 0;
      this.base.pause?.();
    }
    if (this.accent) {
      this.accent.volume = 0;
      this.accent.pause?.();
      try {
        this.accent.currentTime = 0;
      } catch {
        // Immediate silence matters; rewinding is optional.
      }
    }
  }

  /**
   * Adds a brief press emphasis. Bingsu gets its own crunchy one-shot; the
   * other types briefly swell their selected loop without stacking samples.
   */
  press(intensity = 1) {
    if (this.disposed) return false;
    const amount = clamp(Number.isFinite(intensity) ? intensity : 1, 0.15, 1);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this.started || this.base?.paused) this.start(this.mode);
    this.pressBoost = Math.max(this.pressBoost, this.profile.volumeCap * 0.22 * amount);
    this.pressBoostRemaining = Math.max(this.pressBoostRemaining, 190);

    if (!this.accent || this.muted || now - this.lastPressAt < 140) return true;
    this.lastPressAt = now;
    this.accent.pause?.();
    try {
      this.accent.currentTime = 0;
    } catch {
      // Seeking can fail until metadata has loaded; play still remains safe.
    }
    this.accent.volume = this.profile.pressVolumeCap * amount;
    this.pressAccentCount += 1;
    return this.playTrack(this.accent);
  }

  playDiscovery(intensity = 1) {
    if (this.disposed || this.muted) return false;
    if (!this.discoveryTrack) this.discoveryTrack = this.createTrack(DISCOVERY_SAMPLE.file);
    if (!this.discoveryTrack) return false;
    this.discoveryTrack.pause?.();
    try {
      this.discoveryTrack.currentTime = 0;
    } catch {
      // The cue can still play from its current position if seeking is denied.
    }
    this.discoveryTrack.volume = DISCOVERY_SAMPLE.volumeCap
      * clamp(Number.isFinite(intensity) ? intensity : 1, 0.2, 1);
    this.discoveryCueCount += 1;
    return this.playTrack(this.discoveryTrack);
  }

  discovery(intensity = 1) {
    return this.playDiscovery(intensity);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) {
      this.currentVolume = 0;
      this.targetVolume = 0;
      if (this.base) this.base.volume = 0;
      if (this.accent) {
        this.accent.volume = 0;
        this.accent.pause?.();
      }
      if (this.discoveryTrack) {
        this.discoveryTrack.volume = 0;
        this.discoveryTrack.pause?.();
      }
    }
    return this.muted;
  }

  update(deltaMs = 16.667, activity) {
    if (Number.isFinite(activity)) this.setActivity(activity);
    if (this.disposed) return 0;
    const elapsed = clamp(Number.isFinite(deltaMs) ? deltaMs : 16.667, 0, 100);
    this.pressBoostRemaining = Math.max(0, this.pressBoostRemaining - elapsed);
    if (this.pressBoostRemaining === 0) this.pressBoost = 0;

    const activityCurve = Math.pow(this.activity, 0.72);
    this.targetVolume = this.muted || !this.started
      ? 0
      : Math.min(this.profile.volumeCap, this.profile.volumeCap * activityCurve + this.pressBoost);
    const timeConstant = this.targetVolume > this.currentVolume ? this.fadeInMs : this.fadeOutMs;
    const blend = 1 - Math.exp(-elapsed / timeConstant);
    this.currentVolume += (this.targetVolume - this.currentVolume) * blend;
    if (this.currentVolume < 0.0001) this.currentVolume = 0;

    if (this.base) {
      this.base.volume = this.muted ? 0 : clamp(this.currentVolume, 0, this.profile.volumeCap);
      if (this.started && this.targetVolume > 0.001 && !this.muted && this.unlocked && this.base.paused) {
        this.playTrack(this.base, { unlockBase: true });
      }
    }
    return this.currentVolume;
  }

  stop({ rewind = true } = {}) {
    this.started = false;
    this.activity = 0;
    this.currentVolume = 0;
    this.targetVolume = 0;
    this.pressBoost = 0;
    this.pressBoostRemaining = 0;
    for (const track of [this.base, this.accent, this.discoveryTrack]) {
      if (!track) continue;
      track.volume = 0;
      track.pause?.();
      if (rewind) {
        try {
          track.currentTime = 0;
        } catch {
          // Rewinding is optional cleanup, not a playback requirement.
        }
      }
    }
  }

  get metrics() {
    return {
      mode: this.mode,
      selectedFile: this.profile.file,
      pressAccentFile: this.profile.pressFile || null,
      supported: Boolean(this.base),
      started: this.started,
      unlocked: this.unlocked,
      playing: Boolean(this.base && !this.base.paused && !this.base.ended),
      muted: this.muted,
      looping: Boolean(this.base?.loop),
      activity: round(this.activity),
      volumeCap: this.profile.volumeCap,
      targetVolume: round(this.targetVolume),
      currentVolume: round(this.currentVolume),
      startCount: this.startCount,
      pressAccentCount: this.pressAccentCount,
      discoveryCueCount: this.discoveryCueCount,
      playbackErrors: this.playbackErrors,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.releaseTrack(this.base);
    this.releaseTrack(this.accent);
    this.releaseTrack(this.discoveryTrack);
    this.base = null;
    this.accent = null;
    this.discoveryTrack = null;
    this.disposed = true;
  }
}

export default SampleLoopAudio;
