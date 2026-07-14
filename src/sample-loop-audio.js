const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export const SAMPLE_LOOP_PROFILES = Object.freeze({
  liquidy: Object.freeze({
    file: '/audio/glowy-ginsu-1.mp3',
    files: Object.freeze(['/audio/glowy-ginsu-1.mp3', '/audio/glowy-ginsu-4.mp3']),
    volumeCap: 0.18,
  }),
  cloud3d: Object.freeze({
    file: '/audio/cloud-slime.mp3',
    volumeCap: 0.145,
  }),
  bingsu: Object.freeze({
    file: '/audio/puffy-foam-squish.mp3',
    files: Object.freeze(['/audio/puffy-foam-squish.mp3', '/audio/puffy-step-squish.mp3']),
    volumeCap: 0.18,
    popFiles: Object.freeze(['/audio/puffy-pop-a.mp3', '/audio/puffy-pop-b.mp3']),
    popVolumeCap: 0.44,
  }),
  putty: Object.freeze({
    file: '/audio/liquidy-gel-slime.mp3',
    volumeCap: 0.14,
  }),
});

export const UI_SAMPLE_PROFILES = Object.freeze({
  typeSelection: Object.freeze({
    files: Object.freeze(['/audio/type-select-a.mp3', '/audio/type-select-b.mp3']),
    volumeCap: 0.24,
  }),
  colorSelection: Object.freeze({
    file: '/audio/color-select-soft.mp3',
    volumeCap: 0.34,
  }),
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
    this.alternateIndex = -1;
    this.activeFile = this.profile.file;
    this.muted = Boolean(muted);
    this.base = null;
    this.baseTracks = [];
    this.accent = null;
    this.popTracks = [];
    this.popAlternateIndex = -1;
    this.activePopFile = null;
    this.popPlaybackCount = 0;
    this.popFallbackCount = 0;
    this.typeSelectionTracks = [];
    this.typeSelectionIndex = -1;
    this.activeTypeSelectionFile = null;
    this.typeSelectionCueCount = 0;
    this.colorSelectionTrack = null;
    this.colorSelectionCueCount = 0;
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
    this.playbackErrors = 0;
    this.prepareModeTracks();
    this.prepareUiTracks();
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
    const files = this.profile.files || [this.profile.file];
    this.baseTracks = files.map((file) => this.createTrack(file, { loop: true }));
    this.base = this.baseTracks[0] || null;
    this.accent = this.profile.pressFile
      ? this.createTrack(this.profile.pressFile)
      : null;
    this.popTracks = (this.profile.popFiles || []).map((file) => this.createTrack(file));
  }

  prepareUiTracks() {
    this.typeSelectionTracks = UI_SAMPLE_PROFILES.typeSelection.files
      .map((file) => this.createTrack(file));
    this.colorSelectionTrack = this.createTrack(UI_SAMPLE_PROFILES.colorSelection.file);
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

  playTrack(track, { unlockBase = false, onError = null } = {}) {
    let errorHandled = false;
    const handleError = (error) => {
      // Pausing a still-loading media element intentionally raises AbortError;
      // it is not a broken asset and should not trigger a late fallback sound.
      if (error?.name === 'AbortError') return;
      if (errorHandled) return;
      errorHandled = true;
      this.playbackErrors += 1;
      onError?.();
    };
    if (!track || this.disposed) {
      handleError();
      return false;
    }
    try {
      const result = track.play?.();
      if (result?.then) {
        result.then(() => {
          if (unlockBase) this.unlocked = true;
        }).catch(handleError);
      } else {
        if (unlockBase) this.unlocked = true;
      }
      return true;
    } catch (error) {
      handleError(error);
      return false;
    }
  }

  selectMode(mode) {
    if (!SAMPLE_LOOP_PROFILES[mode] || this.disposed) return false;
    if (mode === this.mode) return true;
    this.baseTracks.forEach((track) => this.releaseTrack(track));
    this.releaseTrack(this.accent);
    this.popTracks.forEach((track) => this.releaseTrack(track));
    this.mode = mode;
    this.profile = SAMPLE_LOOP_PROFILES[mode];
    this.alternateIndex = -1;
    this.activeFile = this.profile.file;
    this.base = null;
    this.baseTracks = [];
    this.accent = null;
    this.popTracks = [];
    this.popAlternateIndex = -1;
    this.activePopFile = null;
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
    if (!this.started && this.profile.files?.length > 1) {
      this.alternateIndex = (this.alternateIndex + 1) % this.profile.files.length;
      this.activeFile = this.profile.files[this.alternateIndex];
      this.base = this.baseTracks[this.alternateIndex] || null;
      try {
        if (this.base) this.base.currentTime = 0;
      } catch {
        // Starting from the current position is an acceptable metadata fallback.
      }
    }
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
   * Adds a brief press emphasis without stacking extra synthesized sounds.
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

  playTypeSelection(intensity = 1) {
    if (this.disposed || this.muted || !this.typeSelectionTracks.length) return false;
    this.typeSelectionTracks.forEach((track) => {
      if (!track) return;
      track.volume = 0;
      track.pause?.();
    });
    this.typeSelectionIndex = (this.typeSelectionIndex + 1) % this.typeSelectionTracks.length;
    const track = this.typeSelectionTracks[this.typeSelectionIndex];
    if (!track) return false;
    try {
      track.currentTime = 0;
    } catch {
      // The short cue can still play if metadata has not finished loading.
    }
    track.volume = UI_SAMPLE_PROFILES.typeSelection.volumeCap
      * clamp(Number.isFinite(intensity) ? intensity : 1, 0.2, 1);
    this.activeTypeSelectionFile = UI_SAMPLE_PROFILES.typeSelection.files[this.typeSelectionIndex];
    this.typeSelectionCueCount += 1;
    return this.playTrack(track);
  }

  playColorSelection(intensity = 1) {
    if (this.disposed || this.muted || !this.colorSelectionTrack) return false;
    this.colorSelectionTrack.pause?.();
    try {
      this.colorSelectionTrack.currentTime = 0;
    } catch {
      // The short cue can still play if metadata has not finished loading.
    }
    this.colorSelectionTrack.volume = UI_SAMPLE_PROFILES.colorSelection.volumeCap
      * clamp(Number.isFinite(intensity) ? intensity : 1, 0.2, 1);
    this.colorSelectionCueCount += 1;
    return this.playTrack(this.colorSelectionTrack);
  }

  playPop(onFailure) {
    let fallbackHandled = false;
    const fallback = () => {
      if (fallbackHandled) return;
      fallbackHandled = true;
      this.popFallbackCount += 1;
      onFailure?.();
    };
    if (this.disposed || this.muted || !this.profile.popFiles?.length || !this.popTracks.length) {
      if (!this.muted) fallback();
      return false;
    }
    this.popAlternateIndex = (this.popAlternateIndex + 1) % this.popTracks.length;
    const track = this.popTracks[this.popAlternateIndex];
    if (!track || track.error) {
      fallback();
      return false;
    }
    this.popTracks.forEach((candidate, index) => {
      if (!candidate || index === this.popAlternateIndex) return;
      candidate.volume = 0;
      candidate.pause?.();
    });
    track.pause?.();
    try {
      track.currentTime = 0;
    } catch {
      // The pop remains useful even if metadata is not ready for seeking.
    }
    track.volume = this.profile.popVolumeCap || 0.4;
    this.activePopFile = this.profile.popFiles[this.popAlternateIndex];
    this.popPlaybackCount += 1;
    return this.playTrack(track, { onError: fallback });
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
      for (const track of [...this.popTracks, ...this.typeSelectionTracks, this.colorSelectionTrack]) {
        if (!track) continue;
        track.volume = 0;
        track.pause?.();
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
    for (const track of [...new Set([
      ...this.baseTracks,
      ...this.popTracks,
      ...this.typeSelectionTracks,
      this.accent,
      this.colorSelectionTrack,
    ])]) {
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
      selectedFile: this.activeFile,
      alternatingFiles: this.profile.files || null,
      alternateIndex: this.profile.files?.length > 1 ? this.alternateIndex : null,
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
      popSampleFiles: this.profile.popFiles || null,
      selectedPopFile: this.activePopFile,
      popAlternateIndex: this.profile.popFiles?.length ? this.popAlternateIndex : null,
      popPlaybackCount: this.popPlaybackCount,
      popFallbackCount: this.popFallbackCount,
      typeSelectionFiles: UI_SAMPLE_PROFILES.typeSelection.files,
      selectedTypeSelectionFile: this.activeTypeSelectionFile,
      typeSelectionIndex: this.typeSelectionIndex,
      typeSelectionCueCount: this.typeSelectionCueCount,
      colorSelectionFile: UI_SAMPLE_PROFILES.colorSelection.file,
      colorSelectionCueCount: this.colorSelectionCueCount,
      playbackErrors: this.playbackErrors,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.baseTracks.forEach((track) => this.releaseTrack(track));
    this.popTracks.forEach((track) => this.releaseTrack(track));
    this.typeSelectionTracks.forEach((track) => this.releaseTrack(track));
    this.releaseTrack(this.accent);
    this.releaseTrack(this.colorSelectionTrack);
    this.base = null;
    this.baseTracks = [];
    this.popTracks = [];
    this.typeSelectionTracks = [];
    this.accent = null;
    this.colorSelectionTrack = null;
    this.disposed = true;
  }
}

export default SampleLoopAudio;
