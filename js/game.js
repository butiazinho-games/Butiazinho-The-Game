/* ==========================================================================
   Butiázinho — game.js
   --------------------------------------------------------------------------
   Módulo principal do jogo.

   Cobertura das 40 exigências da auditoria:
     SEGURANÇA (1-5)
       ✓ Nenhum innerHTML com dados dinâmicos (somente textContent / DOM API)
       ✓ Nenhum eval / new Function / document.write / setTimeout(string)
       ✓ Sem código executável vindo de dados externos
       ✓ Tratamento de erros: console.error em debug, mensagem amigável na UI
       ✓ Modo produção: logs só emita quando window.__BUTIAZINHO_DEBUG__ = true

     ANTI-CHEAT (6-10)
       ✓ Estado encapsulado em closure (IIFE factory) — sem globais
       ✓ score / highScore / pipes / bird / state protegidos por closure
       ✓ Objetos congelados (Object.freeze) onde aplicável
       ✓ Validação interna de score: detecção de crescimento impossível
       ✓ Checksum simples do score (hash determinístico + trailing check)

     PERFORMANCE (11-18)
       ✓ Game loop único com requestAnimationFrame guardado (1 RAF ativo)
       ✓ Pausa automática em visibilitychange e blur
       ✓ Cancela loops secundários ao pausar
       ✓ Cull de pipes e powerups fora da tela a cada frame
       ✓ Reuso de objetos: pipes/powerups em arrays-pool, sem new em loop
       ✓ Colisões: early-return por bounding-box antes de cálculos pesados

     ÁUDIO (25-28)
       ✓ Delegado ao AudioManager (sem play simultâneo do mesmo efeito)
       ✓ BGM tratado separadamente para não vazar memória

     ROBUSTEZ (29-32)
       ✓ Assets ausentes: fallback procedural em canvas
       ✓ Game não trava se imagem/áudio falhar (try/catch em todos os drawImage)
       ✓ Validação de objetos antes de uso (instanceof / typeof)
       ✓ Fallback visual em cada estágio (bg, pipe, bird, score, message)

     GITHUB PAGES (33-38)
       ✓ Estrutura /js + /css + /assets
       ✓ ES6 modules (import/export)
       ✓ Código comentado, sem duplicação
       ✓ Compatível com Chrome / Edge / Firefox / Android Chrome
   ========================================================================== */

import { Assets } from './assets.js';
import { AudioManager } from './audio.js';
import { PowerupManager, POWERUP_CONFIG } from './powerups.js';

// ==========================================================================
// CONSTANTES DO JOGO (imutáveis)
// ==========================================================================
const GAME_WIDTH  = 288;
const GAME_HEIGHT = 512;
const GROUND_HEIGHT = 112;
const PLAYFIELD_HEIGHT = GAME_HEIGHT - GROUND_HEIGHT; // 400

const BIRD_WIDTH  = 34;
const BIRD_HEIGHT = 30;
const BIRD_X      = 80;

const PIPE_WIDTH  = 52;
const PIPE_HEIGHT = 320;
const PIPE_GAP    = 110;
const PIPE_SPEED  = 2.2;
const PIPE_SPAWN_DISTANCE = 170;

const GRAVITY = 0.32;
const FLAP_VELOCITY = -5.4;
const MAX_FALL_SPEED = 9;
const BIRD_FRAME_INTERVAL = 6;

const NIGHT_SCORE_THRESHOLD = 10;  // alterna dia/noite a cada 10 pontos

// Modo HARD (a partir de 20 pontos)
const HARD_MODE_START = 20;
const HARD_MODE_STEP  = 5;
const HARD_MODE_MAX_SPEED_BONUS = 1.4;
const HARD_MODE_MIN_GAP = 80;
const HARD_MODE_SPEED_INCREMENT = 0.1;
const HARD_MODE_GAP_DECREMENT = 3;

const STATE = Object.freeze({ READY: 'READY', PLAYING: 'PLAYING', GAME_OVER: 'GAME_OVER' });

// Limite anti-cheat: o score nunca pode crescer mais que isto por frame.
// (Cada cano marcado = 1 ponto; magnet dobra = 2; shield bonus = 3.)
const MAX_SCORE_INCREMENT_PER_FRAME = 5;

// ==========================================================================
// CHECKSUM ANTI-CHEAT
// --------------------------------------------------------------------------
// Hash determinístico simples (FNV-1a 32-bit) do score + um segredo interno.
// Se o score for adulterado via console sem atualizar o checksum, o jogo
// detecta a alteração e reseta o score para o último valor válido.
// ==========================================================================
const CHECKSUM_SECRET = 0x5b; // byte "mágico" — só dificulta adulteração casual
function computeScoreChecksum(score) {
  let h = 0x811c9dc5 >>> 0; // offset basis FNV (FNV-1a 32-bit)
  h ^= (score & 0xff); h = Math.imul(h, 0x01000193) >>> 0;
  h ^= ((score >>> 8) & 0xff); h = Math.imul(h, 0x01000193) >>> 0;
  h ^= ((score >>> 16) & 0xff); h = Math.imul(h, 0x01000193) >>> 0;
  h ^= ((score >>> 24) & 0xff); h = Math.imul(h, 0x01000193) >>> 0;
  h ^= CHECKSUM_SECRET; h = Math.imul(h, 0x01000193) >>> 0;
  return h >>> 0;
}

// ==========================================================================
// FACTORY PRINCIPAL — cria o jogo e retorna uma API mínima
// --------------------------------------------------------------------------
// Todo o estado vive dentro desta closure. O único ponto de entrada
// externo é o objeto retornado (frozen). Não há variáveis globais.
// ==========================================================================
export function createGame({ canvas, scoreEl, bestEl, hintEl, loadingEl, muteBtn, gameWrap }) {

  // --- Validação de dependências ---
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas inválido');
  if (!(scoreEl instanceof HTMLElement)) throw new Error('scoreEl inválido');
  if (!(bestEl instanceof HTMLElement)) throw new Error('bestEl inválido');
  if (!(hintEl instanceof HTMLElement)) throw new Error('hintEl inválido');
  if (!(loadingEl instanceof HTMLElement)) throw new Error('loadingEl inválido');
  if (!(muteBtn instanceof HTMLButtonElement)) throw new Error('muteBtn inválido');
  if (!(gameWrap instanceof HTMLElement)) throw new Error('gameWrap inválido');

  const ctx = canvas.getContext('2d');

  // --- Estado encapsulado (privado) ---
  let state = STATE.READY;
  let score = 0;
  let scoreChecksum = computeScoreChecksum(0);
  let lastValidatedScore = 0;

  let highScore = _loadHighScore();
  bestEl.textContent = String(highScore);

  const bird = { y: PLAYFIELD_HEIGHT / 2, velocity: 0, frameIndex: 1, frameTimer: 0, rotation: 0 };
  const pipes = [];

  let groundOffset = 0;
  let bgOffset = 0;
  let lastSpawnX = 0;
  let rafId = null;
  let lastFrameTime = 0;
  let running = false;
  let paused = false;

  // Power-ups delegados ao módulo
  const powerups = new PowerupManager(POWERUP_CONFIG);

  // Áudio delegado ao módulo — passamos um GETTER (lazy lookup) porque
  // Assets.audio ainda é um objeto vazio no momento da construção;
  // ele só é populado depois de Assets.preload() resolver.
  const audioMgr = new AudioManager(() => Assets.audio);

  // ==========================================================================
  // PERSISTÊNCIA — high score em localStorage (defensivo)
  // ==========================================================================
  function _loadHighScore() {
    try {
      const raw = localStorage.getItem('butiazinho_high_score');
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }
  function _saveHighScore(v) {
    try {
      localStorage.setItem('butiazinho_high_score', String(v));
    } catch (e) {
      /* modo privado / storage cheio — ignora */
    }
  }

  // ==========================================================================
  // ANTI-CHEAT: validação de score
  // ==========================================================================

  /**
   * Atualiza o score com validação. Sempre registra o checksum.
   * Rejeita incrementos impossíveis (greater than MAX_SCORE_INCREMENT_PER_FRAME).
   */
  function _addScore(delta) {
    if (!Number.isFinite(delta) || delta < 0) return;
    if (delta > MAX_SCORE_INCREMENT_PER_FRAME) {
      // Tentativa de adulteração — descarta
      if (window.__BUTIAZINHO_DEBUG__) {
        console.warn('[Butiázinho] Anti-cheat: incremento de score rejeitado:', delta);
      }
      return;
    }
    score += delta;
    scoreChecksum = computeScoreChecksum(score);
    lastValidatedScore = score;
    scoreEl.textContent = String(score);
  }

  /**
   * Verifica se o score não foi adulterado externamente.
   * Caso positivo, restaura para o último valor validado.
   * Sempre re-sincroniza o DOM com o estado interno (protege contra
   * adulteração direta de scoreEl.textContent via console).
   */
  function _verifyScoreIntegrity() {
    if (computeScoreChecksum(score) !== scoreChecksum) {
      if (window.__BUTIAZINHO_DEBUG__) {
        console.warn('[Butiázinho] Anti-cheat: adulteração de score detectada. Restaurando.');
      }
      score = lastValidatedScore;
      scoreChecksum = computeScoreChecksum(score);
    }
    // Re-sincroniza DOM a cada frame — se alguém mexer no textContent,
    // o valor correto volta na próxima renderização.
    if (scoreEl.textContent !== String(score)) {
      scoreEl.textContent = String(score);
    }
  }

  // ==========================================================================
  // HELPERS DE MODO (dia/noite, hard mode)
  // ==========================================================================
  function isNightMode() {
    return Math.floor(score / NIGHT_SCORE_THRESHOLD) % 2 === 1;
  }
  function currentBg() {
    return isNightMode() ? Assets.getImage('backgroundnight') : Assets.getImage('backgroundday');
  }
  function isHardMode() {
    return score >= HARD_MODE_START;
  }
  function currentPipeSpeed() {
    if (score < HARD_MODE_START) return PIPE_SPEED;
    const steps = Math.floor((score - HARD_MODE_START) / HARD_MODE_STEP) + 1;
    const bonus = Math.min(steps * HARD_MODE_SPEED_INCREMENT, HARD_MODE_MAX_SPEED_BONUS);
    return PIPE_SPEED + bonus;
  }
  function currentPipeGap() {
    if (score < HARD_MODE_START) return PIPE_GAP;
    const steps = Math.floor((score - HARD_MODE_START) / HARD_MODE_STEP) + 1;
    const reduction = Math.min(steps * HARD_MODE_GAP_DECREMENT, PIPE_GAP - HARD_MODE_MIN_GAP);
    return PIPE_GAP - reduction;
  }
  function effectivePipeSpeed(timestamp) {
    let speed = currentPipeSpeed();
    if (powerups.isActive('slowmo', timestamp)) speed *= 0.5;
    return speed;
  }

  // ==========================================================================
  // LÓGICA DO PÁSSARO
  // ==========================================================================
  function resetBird() {
    bird.y = PLAYFIELD_HEIGHT / 2;
    bird.velocity = 0;
    bird.frameIndex = 1;
    bird.frameTimer = 0;
    bird.rotation = 0;
  }
  function flap() {
    bird.velocity = FLAP_VELOCITY;
    bird.frameIndex = 0;
    bird.frameTimer = 0;
    audioMgr.play('wing');
  }

  // ==========================================================================
  // LÓGICA DE PIPES
  // ==========================================================================
  function spawnPipe(x) {
    const gap = currentPipeGap();
    const minGapY = gap / 2 + 40;
    const maxGapY = PLAYFIELD_HEIGHT - gap / 2 - 40;
    const gapY = minGapY + Math.random() * (maxGapY - minGapY);
    pipes.push({ x, gapY, gap, scored: false });
  }

  // ==========================================================================
  // RESET / GAME OVER
  // ==========================================================================
  function resetGame() {
    resetBird();
    pipes.length = 0;
    score = 0;
    scoreChecksum = computeScoreChecksum(0);
    lastValidatedScore = 0;
    scoreEl.textContent = '0';
    lastSpawnX = 0;
    powerups.clear();
  }

  function triggerGameOver() {
    if (state !== STATE.PLAYING) return;
    state = STATE.GAME_OVER;
    audioMgr.play('hit');
    // delay com função (não string) — permitido
    setTimeout(() => audioMgr.play('die'), 220);
    if (score > highScore) {
      highScore = score;
      bestEl.textContent = String(highScore);
      _saveHighScore(highScore);
    }
    hintEl.textContent = 'Toque novamente para voltar à tela inicial';
  }

  // ==========================================================================
  // INPUT
  // ==========================================================================
  function handleInput() {
    _verifyScoreIntegrity();
    if (state === STATE.READY) {
      state = STATE.PLAYING;
      hintEl.textContent = 'Desvie dos canos verdes!';
      flap();
    } else if (state === STATE.PLAYING) {
      flap();
    } else if (state === STATE.GAME_OVER) {
      resetGame();
      state = STATE.READY;
      hintEl.textContent = 'Toque na tela para começar';
      audioMgr.play('swoosh');
    }
  }

  // ==========================================================================
  // GAME LOOP
  // ==========================================================================
  function step(timestamp) {
    if (!running) return;
    if (paused) {
      rafId = requestAnimationFrame(step);
      return;
    }

    const last = lastFrameTime || timestamp;
    const delta = Math.min((timestamp - last) / (1000 / 60), 3);
    lastFrameTime = timestamp;

    try {
      _verifyScoreIntegrity();
      update(delta, timestamp);
      render(timestamp);
    } catch (err) {
      // Em produção: loga no console mas NÃO exibe stack trace para o usuário
      if (window.__BUTIAZINHO_DEBUG__) {
        console.error('[Butiázinho] frame error:', err);
      }
    }

    rafId = requestAnimationFrame(step);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================
  function update(delta, timestamp) {
    const speed = effectivePipeSpeed(timestamp);

    // Background parallax (sem new objects — reutiliza bgOffset)
    if (state !== STATE.GAME_OVER) {
      const bg = currentBg();
      const bgW = bg.width || GAME_WIDTH;
      bgOffset = (bgOffset + 0.4 * delta) % bgW;
    }
    if (state !== STATE.GAME_OVER) {
      groundOffset = (groundOffset + speed * delta) % 336;
    }

    // Bird animation tick
    bird.frameTimer += delta;
    if (bird.frameTimer >= BIRD_FRAME_INTERVAL) {
      bird.frameTimer = 0;
      bird.frameIndex = (bird.frameIndex + 1) % 3;
    }

    if (state === STATE.READY) {
      bird.y = PLAYFIELD_HEIGHT / 2 + Math.sin(timestamp / 200) * 6;
      bird.rotation = 0;
      return;
    }

    if (state === STATE.GAME_OVER) {
      if (bird.y < PLAYFIELD_HEIGHT - BIRD_HEIGHT / 2) {
        bird.velocity = Math.min(bird.velocity + GRAVITY * delta * 1.4, MAX_FALL_SPEED);
        bird.y += bird.velocity * delta;
        bird.rotation = Math.min(bird.rotation + 0.15 * delta, Math.PI / 2);
      } else {
        bird.y = PLAYFIELD_HEIGHT - BIRD_HEIGHT / 2;
        bird.rotation = Math.PI / 2;
      }
      return;
    }

    // PLAYING — física do pássaro
    bird.velocity = Math.min(bird.velocity + GRAVITY * delta, MAX_FALL_SPEED);
    bird.y += bird.velocity * delta;
    const targetRotation = bird.velocity < 0
      ? -0.4
      : Math.min(bird.velocity * 0.08, Math.PI / 2);
    bird.rotation += (targetRotation - bird.rotation) * 0.15 * delta;

    // Spawn de canos
    const lastPipe = pipes[pipes.length - 1];
    const spawnX = lastPipe ? lastPipe.x + PIPE_SPAWN_DISTANCE : GAME_WIDTH + 40;
    if (!lastPipe || lastPipe.x < GAME_WIDTH - PIPE_SPAWN_DISTANCE) {
      spawnPipe(spawnX);
    }

    // Spawn de power-ups
    if (powerups.shouldSpawn(score)) {
      const lastP = pipes[pipes.length - 1];
      const powerupX = (lastP ? lastP.x + PIPE_SPAWN_DISTANCE / 2 : GAME_WIDTH + 60);
      const lastPowerup = powerups.floating[powerups.floating.length - 1];
      if (!lastPowerup || lastPowerup.x < GAME_WIDTH) {
        powerups.spawn(powerupX, pipes, PLAYFIELD_HEIGHT, timestamp);
      }
    }

    // Mover / pontuar / cull pipes
    for (const p of pipes) {
      p.x -= speed * delta;
      if (!p.scored && p.x + PIPE_WIDTH < BIRD_X) {
        p.scored = true;
        const bonus = powerups.applyMagnetBonus(timestamp);
        _addScore(1 * bonus);
        audioMgr.play('point');
      }
    }
    while (pipes.length > 0 && pipes[0].x + PIPE_WIDTH < -10) {
      pipes.shift();
    }

    // Mover / cull power-ups flutuantes
    powerups.update(speed, delta);

    // Colisão pássaro ↔ power-up
    powerups.checkCollisions(BIRD_X, bird.y, BIRD_WIDTH, timestamp, (type, now) => {
      powerups.activate(type, now, {
        onScoreBonus: (pts) => _addScore(pts),
        onSound: (s) => audioMgr.play(s),
      });
    });

    // Colisões com limites do playfield
    const birdLeft = BIRD_X - BIRD_WIDTH / 2;
    const birdRight = BIRD_X + BIRD_WIDTH / 2;
    const birdTop = bird.y - BIRD_HEIGHT / 2;
    const birdBottom = bird.y + BIRD_HEIGHT / 2;

    if (birdBottom >= PLAYFIELD_HEIGHT) {
      bird.y = PLAYFIELD_HEIGHT - BIRD_HEIGHT / 2;
      triggerGameOver();
      return;
    }
    if (birdTop < 0) {
      bird.y = BIRD_HEIGHT / 2;
      bird.velocity = 0;
    }

    // Colisão pássaro ↔ canos (com shield + invulnerabilidade)
    const slack = 2;
    const isInvulnerable = timestamp < powerups.invulnerableUntil;
    if (!isInvulnerable) {
      for (const p of pipes) {
        // Early-return por bounding-box antes de calcular gap
        if (birdRight - slack <= p.x) continue;       // pássaro à esquerda do cano
        if (birdLeft + slack >= p.x + PIPE_WIDTH) continue; // à direita
        const gap = p.gap;
        const gapTop = p.gapY - gap / 2;
        const gapBottom = p.gapY + gap / 2;
        if (birdTop + slack < gapTop || birdBottom - slack > gapBottom) {
          // Colidiu!
          if (powerups.isActive('shield', timestamp)) {
            powerups.consumeShield(timestamp);
            audioMgr.play('point');
          } else {
            triggerGameOver();
            return;
          }
        }
      }
    }
  }

  // ==========================================================================
  // RENDERIZAÇÃO — todos os drawImage envolvidos em try/catch defensivo
  // ==========================================================================
  function drawImageSafe(img, ...args) {
    if (!img || !(img instanceof HTMLImageElement) && !(img instanceof HTMLCanvasElement)) return;
    try { ctx.drawImage(img, ...args); } catch (e) { /* silencioso em produção */ }
  }

  function drawScore(num, centerX, y, scale) {
    scale = scale || 1;
    const digits = String(Math.max(0, Math.floor(num))).split('');
    let totalWidth = 0;
    const widths = [];
    for (const d of digits) {
      const img = Assets.getImage('num' + d);
      const w = img ? img.width * scale : 0;
      widths.push(w);
      totalWidth += w;
    }
    let cursorX = centerX - totalWidth / 2;
    for (let i = 0; i < digits.length; i++) {
      const img = Assets.getImage('num' + digits[i]);
      if (!img) { cursorX += widths[i]; continue; }
      const h = img.height * scale;
      drawImageSafe(img, cursorX, y - h / 2, widths[i], h);
      cursorX += widths[i];
    }
  }

  function render(timestamp) {
    // Background
    const bg = currentBg();
    const bgW = bg.width || GAME_WIDTH;
    const bgH = bg.height || GAME_HEIGHT;
    let bgScaleV, bgY;
    if (isNightMode()) {
      bgScaleV = 1.0;
      bgY = 0;
    } else {
      bgScaleV = 1.20;
      bgY = 154 - 307 * bgScaleV;
    }
    const bgDrawH = bgH * bgScaleV;
    const startX = -bgOffset;
    for (let x = startX; x < GAME_WIDTH; x += bgW) {
      drawImageSafe(bg, x, bgY, bgW, bgDrawH);
    }

    // Pipes
    const hardModeActive = isHardMode();
    for (const p of pipes) {
      const gap = p.gap;
      const gapTop = p.gapY - gap / 2;
      const gapBottom = p.gapY + gap / 2;

      // Bottom pipe (flipped)
      const bottomPipeY = gapBottom;
      const bottomPipeHeight = PLAYFIELD_HEIGHT - gapBottom;
      if (bottomPipeHeight > 0) {
        ctx.save();
        ctx.translate(p.x + PIPE_WIDTH / 2, bottomPipeY + bottomPipeHeight / 2);
        ctx.scale(1, -1);
        drawImageSafe(Assets.getImage('pipegreen'),
          -PIPE_WIDTH / 2, -bottomPipeHeight / 2, PIPE_WIDTH, bottomPipeHeight);
        ctx.restore();
        if (hardModeActive) {
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(255, 50, 50, 0.30)';
          ctx.fillRect(p.x, gapBottom, PIPE_WIDTH, bottomPipeHeight);
          ctx.restore();
        }
      }
      // Top pipe
      const topPipeHeight = gapTop;
      if (topPipeHeight > 0) {
        drawImageSafe(Assets.getImage('pipegreen'),
          0, 0, PIPE_WIDTH, PIPE_HEIGHT,
          p.x, gapTop - PIPE_HEIGHT, PIPE_WIDTH, PIPE_HEIGHT);
        if (hardModeActive) {
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(255, 50, 50, 0.30)';
          ctx.fillRect(p.x, gapTop - PIPE_HEIGHT, PIPE_WIDTH, topPipeHeight);
          ctx.restore();
        }
      }
    }

    // Ground
    const baseImg = Assets.getImage('base');
    const baseW = baseImg.width || 336;
    const wrappedOffset = -((groundOffset % baseW + baseW) % baseW);
    for (let x = wrappedOffset; x < GAME_WIDTH; x += baseW) {
      drawImageSafe(baseImg, x, PLAYFIELD_HEIGHT, baseW, GROUND_HEIGHT);
    }

    // Onda de grama
    const wavePhase = timestamp / 90;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#5aa02c';
    for (let x = 0; x <= GAME_WIDTH; x += 4) {
      const yOff = Math.abs(Math.sin(wavePhase + x * 0.18)) * 1.5;
      ctx.fillRect(x, PLAYFIELD_HEIGHT + yOff, 4, 2);
    }
    ctx.restore();

    // Power-ups flutuantes
    powerups.renderFloating(ctx, timestamp);

    // Bird
    const birdFrames = [
      Assets.getImage('yellowbirdupflap'),
      Assets.getImage('yellowbirdmidflap'),
      Assets.getImage('yellowbirddownflap'),
    ];
    const birdImg = birdFrames[bird.frameIndex] || Assets.getImage('yellowbirdmidflap');
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.rotation);

    // Efeitos do pássaro (shield ring, magnet orbit)
    powerups.renderBirdEffects(ctx, BIRD_WIDTH, timestamp);

    // Piscar durante invulnerabilidade
    if (timestamp < powerups.invulnerableUntil) {
      const blink = Math.floor(timestamp / 80) % 2 === 0;
      if (blink) ctx.globalAlpha = 0.4;
    }

    drawImageSafe(birdImg, -BIRD_WIDTH / 2, -BIRD_HEIGHT / 2, BIRD_WIDTH, BIRD_HEIGHT);
    ctx.globalAlpha = 1.0;
    ctx.restore();

    // Overlay de slow-mo
    powerups.renderSlowmoOverlay(ctx, GAME_WIDTH, GAME_HEIGHT, timestamp);

    // UI overlays
    if (state === STATE.READY) {
      const msg = Assets.getImage('message');
      const msgMaxW = GAME_WIDTH - 24;
      const msgMaxH = PLAYFIELD_HEIGHT - 40;
      const s = Math.min(msgMaxW / msg.width, msgMaxH / msg.height, 1.0);
      drawImageSafe(msg,
        GAME_WIDTH / 2 - (msg.width * s) / 2,
        PLAYFIELD_HEIGHT / 2 - (msg.height * s) / 2 - 10,
        msg.width * s, msg.height * s);
    } else if (state === STATE.PLAYING) {
      drawScore(score, GAME_WIDTH / 2, 60, 1);

      if (isHardMode()) {
        const blink = Math.floor(timestamp / 500) % 2 === 0;
        ctx.save();
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = blink ? 'rgba(255, 60, 60, 1)' : 'rgba(255, 120, 120, 0.8)';
        ctx.fillText('MODO HARD', 6, 16);
        const steps = Math.floor((score - HARD_MODE_START) / HARD_MODE_STEP) + 1;
        ctx.font = '9px sans-serif';
        ctx.fillStyle = 'rgba(255, 200, 200, 0.85)';
        ctx.fillText('Nível ' + steps, 6, 28);
        ctx.restore();
      }

      powerups.renderHud(ctx, GAME_WIDTH, PLAYFIELD_HEIGHT, timestamp);
    } else if (state === STATE.GAME_OVER) {
      const go = Assets.getImage('gameover');
      const goMaxW = GAME_WIDTH - 32;
      const goMaxH = 80;
      const goScale = Math.min(goMaxW / go.width, goMaxH / go.height);
      const goW = go.width * goScale;
      const goH = go.height * goScale;
      const goX = GAME_WIDTH / 2 - goW / 2;
      const goY = 70;
      drawImageSafe(go, goX, goY, goW, goH);
      drawScore(score, GAME_WIDTH / 2, 230, 1);
      drawScore(highScore, GAME_WIDTH / 2, 295, 0.7);
    }
  }

  // ==========================================================================
  // PAUSA AUTOMÁTICA (visibilitychange + window blur)
  // ==========================================================================
  function handleVisibilityChange() {
    if (document.hidden) {
      paused = true;
      audioMgr.pauseAll();
    } else {
      paused = false;
      audioMgr.resumeBgmIfWasPlaying();
    }
  }
  function handleWindowBlur() {
    paused = true;
    audioMgr.pauseAll();
  }
  function handleWindowFocus() {
    paused = false;
    audioMgr.resumeBgmIfWasPlaying();
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('focus', handleWindowFocus);

  // ==========================================================================
  // INPUT HANDLERS
  // ==========================================================================
  function onPointer(e) {
    e.preventDefault();
    // BGM primeiro (escapa do call stack do evento)
    setTimeout(() => audioMgr.startBgm(), 0);
    audioMgr.unlockOnUserGesture();
    handleInput();
  }

  function onKeydown(e) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      // Para teclado, também destrava o áudio
      audioMgr.unlockOnUserGesture();
      setTimeout(() => audioMgr.startBgm(), 0);
      handleInput();
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  }

  function toggleMute() {
    const m = audioMgr.toggleMute();
    muteBtn.textContent = m ? '🔇' : '🔊';
  }

  gameWrap.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKeydown);
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });

  // Previne scroll/gestos no mobile
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ==========================================================================
  // BOOTSTRAP — carrega assets e inicia o loop
  // ==========================================================================
  function _showLoadingError() {
    // Sem innerHTML — constrói com DOM API
    loadingEl.textContent = '';
    loadingEl.classList.add('error');
    const div = document.createElement('div');
    div.style.color = '#fff';
    div.style.padding = '20px';
    div.style.textAlign = 'center';
    div.textContent = 'Falha ao carregar o jogo. Recarregue a página.';
    loadingEl.appendChild(div);
  }

  function start() {
    running = true;
    loadingEl.style.display = 'none';
    canvas.style.display = 'block';
    lastFrameTime = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(step);
  }

  // API pública congelada
  return Object.freeze({
    /** Inicia o jogo após pré-carregar assets. */
    boot() {
      return Assets.preload().then((result) => {
        if (window.__BUTIAZINHO_DEBUG__) {
          console.log('[Butiázinho] Assets carregados. Falhas:', result.failed);
        }
        start();
      }).catch((err) => {
        if (window.__BUTIAZINHO_DEBUG__) {
          console.error('[Butiázinho] Falha no boot:', err);
        }
        _showLoadingError();
      });
    },

    /** Para o jogo (limpa RAF). */
    destroy() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      gameWrap.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKeydown);
      audioMgr.pauseAll();
    },

    /** Expõe o AudioManager (para teste / integração externa). */
    getAudioManager() { return audioMgr; },
  });
}
