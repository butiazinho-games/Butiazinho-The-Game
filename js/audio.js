/* Butiázinho: one streaming music element and cached, short Web Audio effects.
 * Sound is optional: loading, decoding or blocked playback never queues a flap
 * or delays gameplay. Only a fresh effect with a running context is played.
 */
const EFFECT_KEYS = ['die', 'hit', 'point', 'swoosh', 'wing'];

export class AudioManager {
  constructor(audioMapOrGetter) {
    if (typeof audioMapOrGetter === 'function') this._getAudioMap = audioMapOrGetter;
    else if (audioMapOrGetter && typeof audioMapOrGetter === 'object') this._getAudioMap = () => audioMapOrGetter;
    else throw new Error('AudioManager requer um mapa de áudios ou um getter');
    this._muted = false;
    this._suspended = false;
    this._destroyed = false;
    this._generation = 0;
    this._bgmWanted = false;
    this._bgmStarted = false;
    this._bgmPending = null;
    this._context = null;
    this._gain = null;
    this._webAudioUnavailable = false;
    this._resumePending = null;
    this._unlockPrimed = false;
    this._silentSource = null;
    this._sessionConfigured = false;
    this._lastError = null;
    this._buffers = new Map();
    this._preparations = new Map();
    this._fallbackAllowed = new Set();
    this._fallback = new Map();
    this._fallbackPending = new Map();
    this._sources = new Map();
    this._lastPlayTimestamp = Object.create(null);
    this._minIntervalMs = 30;
    this._fetchController = typeof AbortController === 'function' ? new AbortController() : null;
  }

  isMuted() { return this._muted; }

  /** Small, read-only snapshot for the test build; no polling or audio work. */
  getStatus() {
    const bgm = this._getAudioMap().bgm;
    return {
      muted: this._muted,
      suspended: this._suspended,
      context: this._context ? this._context.state : 'unavailable',
      effectsLoaded: this._buffers.size,
      effectsExpected: EFFECT_KEYS.length,
      resumePending: !!this._resumePending,
      musicPlaying: !!bgm && !bgm.paused,
      lastError: this._lastError
    };
  }

  _configureSession() {
    if (this._sessionConfigured) return;
    this._sessionConfigured = true;
    try {
      // Optional Safari support: keep music and effects in the same playback
      // category, including devices with the physical Silent switch enabled.
      if (typeof navigator === 'object' && navigator.audioSession) {
        navigator.audioSession.type = 'playback';
      }
    } catch (_) { /* experimental API: playback still works without it */ }
  }

  toggleMute() {
    this.setMute(!this._muted);
    return this._muted;
  }

  setMute(muted) {
    if (this._destroyed) return;
    this._muted = !!muted;
    if (this._muted) {
      this._generation++;
      this._stopEffects();
      this._pauseMusic();
    }
    this._syncGain();
    // The caller can also unlock Web Audio synchronously in this same gesture.
    if (!this._muted && this._bgmWanted && !this._suspended) this.startBgm();
  }

  _canPlay() { return !this._destroyed && !this._muted && !this._suspended; }

  _sourceUrl(name) {
    const value = this._getAudioMap()[name];
    return value && (value.currentSrc || value.src) || '';
  }

  _ensureContext() {
    if (this._destroyed || this._webAudioUnavailable) return null;
    if (this._context) return this._context;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { this._webAudioUnavailable = true; return null; }
    try {
      this._context = new Context();
      this._gain = this._context.createGain();
      this._gain.connect(this._context.destination);
      this._syncGain();
      return this._context;
    } catch (error) {
      this._webAudioUnavailable = true;
      if (this._context) {
        try { this._ignore(this._context.close()); } catch (_) { /* unavailable */ }
      }
      this._context = null;
      this._gain = null;
      this._warn('Web Audio indisponível', error);
      return null;
    }
  }

  /** Call after Assets.preload(), without awaiting it to start the game. */
  prepare() {
    if (this._destroyed) return Promise.resolve();
    const context = this._ensureContext();
    for (const name of EFFECT_KEYS) {
      const src = this._sourceUrl(name);
      if (!src || this._preparations.has(name)) continue;
      if (!context || typeof fetch !== 'function') {
        this._fallbackAllowed.add(name);
        this._preparations.set(name, Promise.resolve());
        continue;
      }
      const options = this._fetchController ? { signal: this._fetchController.signal } : {};
      const task = Promise.resolve().then(() => {
        if (this._destroyed) return null;
        return fetch(src, options);
      }).then(response => {
        if (!response || this._destroyed) return null;
        if (!response.ok) throw new Error('Áudio HTTP ' + response.status);
        return response.arrayBuffer();
      }).then(bytes => {
        if (!bytes || this._destroyed) return null;
        // Callback + Promise signatures cover older Safari as well as modern APIs.
        return new Promise((resolve, reject) => {
          const result = context.decodeAudioData(bytes, resolve, reject);
          if (result && typeof result.then === 'function') result.then(resolve, reject);
        });
      }).then(buffer => {
        if (buffer && !this._destroyed && context === this._context) this._buffers.set(name, buffer);
      }).catch(error => {
        if (this._destroyed) return;
        this._fallbackAllowed.add(name);
        this._warn('Efeito ' + name + ' indisponível em Web Audio', error);
      });
      this._preparations.set(name, task);
    }
    return Promise.all(this._preparations.values()).then(() => undefined);
  }

  /** Never replays a sound after asynchronous decode/resume completes. */
  play(name) {
    if (!this._canPlay() || !EFFECT_KEYS.includes(name)) return;
    const now = performance.now();
    const last = this._lastPlayTimestamp[name];
    if (typeof last === 'number' && now - last < this._minIntervalMs) return;
    const buffer = this._buffers.get(name);
    if (buffer && this._context && this._context.state === 'running') {
      this._lastPlayTimestamp[name] = now;
      let source;
      try {
        const previous = this._sources.get(name);
        if (previous) this._stopSource(previous);
        source = this._context.createBufferSource();
        source.buffer = buffer;
        source.connect(this._gain);
        this._sources.set(name, source);
        source.onended = () => {
          if (this._sources.get(name) === source) this._sources.delete(name);
          try { source.disconnect(); } catch (_) { /* already disconnected */ }
        };
        source.start(0);
      } catch (error) {
        if (this._sources.get(name) === source) this._sources.delete(name);
        if (source) this._stopSource(source);
        this._warn('Efeito ' + name + ' não iniciou', error);
      }
    } else if (this._fallbackAllowed.has(name)) {
      this._lastPlayTimestamp[name] = now;
      this._playFallback(name);
    }
  }

  _playFallback(name) {
    if (this._fallbackPending.has(name)) return;
    let audio = this._fallback.get(name);
    if (!audio) {
      const src = this._sourceUrl(name);
      if (!src) return;
      try {
        audio = new Audio(src);
        audio.preload = 'none';
        this._fallback.set(name, audio);
      } catch (error) { this._warn('Fallback ' + name + ' indisponível', error); return; }
    }
    const request = { generation: this._generation };
    this._fallbackPending.set(name, request);
    const settle = () => {
      if (this._fallbackPending.get(name) !== request) return;
      this._fallbackPending.delete(name);
      if (request.generation !== this._generation || !this._canPlay()) this._pauseElement(audio);
    };
    try {
      if (audio.readyState >= 2) audio.currentTime = 0;
      const result = audio.play();
      if (result && typeof result.then === 'function') result.then(settle, error => {
        settle();
        this._warn('Fallback ' + name + ' não iniciou', error);
      });
      else settle();
    } catch (error) { settle(); this._warn('Fallback ' + name + ' não iniciou', error); }
  }

  /** Called directly in a user gesture, not from a timer or decode callback. */
  unlockOnUserGesture() {
    if (!this._canPlay()) return;
    this._configureSession();
    const context = this._ensureContext();
    if (!context || context.state === 'closed') return;
    this._syncGain();
    if (context.state === 'running') {
      if (!this._unlockPrimed) this._primeContext(context);
      this._unlockPrimed = true;
      return;
    }
    // A touch-start/pointer-down resume may stay pending on iOS until a valid
    // release/click gesture. That promise must not block the next gesture.
    // All attempts come from input events; there are no timers/retry loops.
    this._primeContext(context);
    const request = {};
    this._resumePending = request;
    const settle = () => {
      if (this._resumePending === request) this._resumePending = null;
      if (context.state === 'running') this._unlockPrimed = true;
      if (!this._canPlay()) {
        this._syncGain();
        try { this._ignore(context.suspend()); } catch (_) { /* closed */ }
      }
      // No queued effect or music is started here.
    };
    try {
      const result = context.resume();
      if (context.state === 'running') this._unlockPrimed = true;
      if (result && typeof result.then === 'function') result.then(settle, error => {
        settle();
        this._warn('Contexto não pôde ser ativado', error);
      });
      else settle();
    } catch (error) { settle(); this._warn('Contexto não pôde ser ativado', error); }
  }

  _primeContext(context) {
    if (this._silentSource) this._stopSource(this._silentSource);
    let source;
    try {
      source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, 22050);
      source.connect(this._gain);
      this._silentSource = source;
      source.onended = () => {
        if (this._silentSource === source) this._silentSource = null;
        if (context.state === 'running') this._unlockPrimed = true;
        try { source.disconnect(); } catch (_) { /* already disconnected */ }
      };
      source.start(0);
    } catch (error) {
      if (this._silentSource === source) this._silentSource = null;
      if (source) this._stopSource(source);
      this._warn('Ativação silenciosa indisponível', error);
    }
  }

  /** One pending play, no reload/retry loop. A rejection waits for a new gesture. */
  startBgm() {
    if (!this._canPlay()) return;
    this._configureSession();
    const bgm = this._getAudioMap().bgm;
    if (!bgm || typeof bgm.play !== 'function' || typeof bgm.pause !== 'function') return;
    this._bgmWanted = true;
    if (this._bgmPending || !bgm.paused) return;
    const request = { generation: this._generation };
    this._bgmPending = request;
    const settle = success => {
      if (this._bgmPending !== request) return;
      this._bgmPending = null;
      if (request.generation !== this._generation || !this._canPlay()) {
        this._pauseElement(bgm);
        return;
      }
      if (success) this._bgmStarted = true;
    };
    try {
      bgm.loop = true;
      bgm.volume = 0.35;
      const result = bgm.play();
      if (result && typeof result.then === 'function') result.then(() => settle(true), () => settle(false));
      else settle(true);
    } catch (error) { settle(false); this._warn('Música não iniciou', error); }
  }

  pauseBgm() {
    if (this._destroyed) return;
    this._generation++;
    this._bgmWanted = false;
    this._pauseMusic();
  }

  pauseAll() {
    if (this._destroyed) return;
    this._generation++;
    this._suspended = true;
    this._unlockPrimed = false;
    this._syncGain();
    this._stopEffects();
    this._pauseMusic();
    if (this._context) {
      try { this._ignore(this._context.suspend()); } catch (_) { /* unavailable */ }
    }
  }

  resumeBgmIfWasPlaying() {
    if (this._destroyed) return;
    this._suspended = false;
    this._syncGain();
    if (this._bgmWanted && !this._muted) this.startBgm();
    // Effects need a fresh user gesture to resume their context on iOS.
  }

  destroy() {
    if (this._destroyed) return;
    this._generation++;
    this._destroyed = true;
    this._muted = true;
    this._suspended = true;
    this._bgmWanted = false;
    this._syncGain();
    this._stopEffects();
    this._pauseMusic();
    this._fetchController?.abort();
    if (this._context) {
      try { this._ignore(this._context.close()); } catch (_) { /* unavailable */ }
    }
    this._buffers.clear();
    this._fallback.clear();
  }

  _syncGain() {
    if (this._gain) this._gain.gain.value = this._canPlay() ? 1 : 0;
  }

  _pauseElement(audio) {
    try { audio.pause(); } catch (_) { /* playback is optional */ }
  }

  _pauseMusic() {
    const bgm = this._getAudioMap().bgm;
    if (bgm && typeof bgm.pause === 'function') this._pauseElement(bgm);
  }

  _stopSource(source) {
    try { source.stop(); } catch (_) { /* already ended */ }
    try { source.disconnect(); } catch (_) { /* already disconnected */ }
  }

  _stopEffects() {
    if (this._silentSource) {
      this._stopSource(this._silentSource);
      this._silentSource = null;
    }
    for (const source of this._sources.values()) this._stopSource(source);
    this._sources.clear();
    for (const audio of this._fallback.values()) this._pauseElement(audio);
  }

  _ignore(promise) {
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  }

  _warn(message, error) {
    this._lastError = message;
    if (window.__BUTIAZINHO_DEBUG__) console.warn('[Butiázinho] ' + message, error);
  }
}
