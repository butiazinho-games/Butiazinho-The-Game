/* ==========================================================================
   Butiázinho — audio.js
   --------------------------------------------------------------------------
   Responsabilidades:
     - Tocar efeitos sonoros sem múltiplos play() simultâneos (som de overlap)
     - Gerenciar BGM em loop com retentativas (autoplay policy)
     - Mute / unmute centralizado
     - Compatível com mobile (Chrome Android, Safari iOS)
     - Tratamento seguro de erros: nunca lança para o usuário

   Segurança / Robustez:
     - Todos os `play()` envolvidos em try/catch
     - Promessas rejeitadas (autoplay policy) capturadas silenciosamente
     - Validação de objeto antes de chamar métodos de áudio
   ========================================================================== */

export class AudioManager {
  constructor(audioMapOrGetter) {
    // Aceita tanto um mapa direto quanto um getter (para lazy lookup).
    // O getter é útil quando o mapa é populado depois da construção.
    if (typeof audioMapOrGetter === 'function') {
      this._getAudioMap = audioMapOrGetter;
    } else if (audioMapOrGetter && typeof audioMapOrGetter === 'object') {
      this._getAudioMap = () => audioMapOrGetter;
    } else {
      throw new Error('AudioManager requer um mapa de áudios ou um getter');
    }
    this._muted = false;
    this._bgmStarted = false;
    this._maxAttempts = 5;
    this._lastPlayTimestamp = Object.create(null); // throttle por efeito
    this._minIntervalMs = 30;        // evita chamadas seguidas em loop apertado
  }

  // ---------- API pública ----------

  /** Retorna verdadeiro se o áudio está mutado. */
  isMuted() {
    return this._muted;
  }

  /** Alterna mute. Retorna o novo estado. */
  toggleMute() {
    this._muted = !this._muted;
    this._applyMuteState();
    return this._muted;
  }

  /** Define mute diretamente. */
  setMute(muted) {
    this._muted = !!muted;
    this._applyMuteState();
  }

  /**
   * Toca um efeito sonoro. Não sobrepõe o mesmo efeito se ele já estiver
   * tocando há menos de _minIntervalMs (evita áudio "rasgando").
   * @param {string} name — chave do efeito (die, hit, point, swoosh, wing)
   */
  play(name) {
    if (this._muted) return;
    const a = this._getAudioMap()[name];
    if (!a || !(a instanceof HTMLAudioElement)) return;

    // Throttle simples para evitar sobreposição do mesmo efeito
    const now = performance.now();
    const last = this._lastPlayTimestamp[name] || 0;
    if (now - last < this._minIntervalMs) return;
    this._lastPlayTimestamp[name] = now;

    try {
      // currentTime pode lançar se o áudio não está pronto
      if (a.readyState >= 2) {
        a.currentTime = 0;
      }
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* autoplay policy — silencioso */
        });
      }
    } catch (err) {
      if (window.__BUTIAZINHO_DEBUG__) {
        console.warn(`[Butiázinho] Erro ao tocar áudio "${name}":`, err);
      }
    }
  }

  /**
   * Inicia o BGM em loop. Tenta até _maxAttempts vezes com pequeno delay,
   * porque o play() pode falhar (race condition ou autoplay rejeitada).
   */
  startBgm() {
    const bgm = this._getAudioMap().bgm;
    if (!bgm || !(bgm instanceof HTMLAudioElement) || this._muted) return;
    if (this._bgmStarted) return;

    let attempts = 0;
    const tryPlay = () => {
      if (!bgm || this._muted) return;
      if (attempts >= this._maxAttempts) return;
      attempts++;
      try {
        if (bgm.readyState < 2) bgm.load();
        bgm.volume = 0.35;
        bgm.loop = true;
        const p = bgm.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            this._bgmStarted = true;
          }).catch(() => {
            // Autoplay policy rejeitada — tenta de novo
            setTimeout(tryPlay, 300);
          });
        } else {
          this._bgmStarted = true;
        }
      } catch (err) {
        if (window.__BUTIAZINHO_DEBUG__) {
          console.warn('[Butiázinho] BGM play erro:', err);
        }
        setTimeout(tryPlay, 300);
      }
    };
    tryPlay();
  }

  /** Pausa o BGM (usado em mute ou pausa de aba). */
  pauseBgm() {
    const bgm = this._getAudioMap().bgm;
    if (!bgm || !(bgm instanceof HTMLAudioElement)) return;
    try {
      bgm.pause();
    } catch (err) {
      if (window.__BUTIAZINHO_DEBUG__) {
        console.warn('[Butiázinho] BGM pause erro:', err);
      }
    }
  }

  /**
   * "Acode" os efeitos sonoros após gesto do usuário (necessário em mobile).
   * Chama play() + pause() imediatamente para destravar o audio context.
   */
  unlockOnUserGesture() {
    const map = this._getAudioMap();
    for (const key in map) {
      if (key === 'bgm') continue;
      const a = map[key];
      if (!a || !(a instanceof HTMLAudioElement)) continue;
      try {
        if (a.paused) {
          const p = a.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
          a.pause();
          a.currentTime = 0;
        }
      } catch (err) {
        /* silencioso */
      }
    }
  }

  /**
   * Pausa todos os áudios (usado ao ocultar a aba).
   */
  pauseAll() {
    const map = this._getAudioMap();
    for (const key in map) {
      const a = map[key];
      if (!a || !(a instanceof HTMLAudioElement)) continue;
      try {
        if (!a.paused) a.pause();
      } catch (err) {
        /* silencioso */
      }
    }
  }

  /**
   * Retoma o BGM após voltar da aba oculta (se estava tocando antes).
   */
  resumeBgmIfWasPlaying() {
    if (this._muted || !this._bgmStarted) return;
    const bgm = this._getAudioMap().bgm;
    if (!bgm) return;
    try {
      if (bgm.paused) {
        const p = bgm.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (err) {
      /* silencioso */
    }
  }

  // ---------- Internos ----------

  _applyMuteState() {
    const map = this._getAudioMap();
    for (const key in map) {
      if (key === 'bgm') continue;
      const a = map[key];
      if (a && a instanceof HTMLAudioElement) {
        try { a.muted = this._muted; } catch (err) { /* silencioso */ }
      }
    }
    // BGM: pausa quando mutado, retoma quando desmutado (se já tinha começado)
    const bgm = map.bgm;
    if (bgm && bgm instanceof HTMLAudioElement) {
      if (this._muted) {
        try { bgm.pause(); } catch (err) { /* silencioso */ }
      } else if (this._bgmStarted) {
        try {
          const p = bgm.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (err) { /* silencioso */ }
      }
    }
  }
}
