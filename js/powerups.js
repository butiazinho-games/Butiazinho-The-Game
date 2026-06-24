/* ==========================================================================
   Butiázinho — powerups.js
   --------------------------------------------------------------------------
   Responsabilidades:
     - Definir tipos, constantes e duração dos power-ups
     - Gerenciar lista de power-ups flutuantes (não coletados)
     - Gerenciar estado de power-ups ativos no pássaro (com expiração)
     - Calcular colisões pássaro ↔ power-up
     - Renderizar ícones e efeitos visuais

   Anti-cheat:
     - Todo estado encapsulado na instância PowerupManager
     - Validação interna antes de qualquer mutação
   ========================================================================== */

// ---------- Tipos e constantes (imutáveis) ----------
export const POWERUP_TYPES = Object.freeze(['shield', 'slowmo', 'magnet']);

export const POWERUP_CONFIG = Object.freeze({
  INTERVAL: 10,                              // a cada N pontos, spawna um power-up
  RADIUS: 14,
  SLOWMO_DURATION_MS: 4000,
  MAGNET_DURATION_MS: 5000,
  MAGNET_BONUS_POINTS: 5,
  SHIELD_BONUS_IF_ACTIVE: 3,
  INVULNERABILITY_AFTER_SHIELD_MS: 1500,
});

// ---------- Helper de peso para tipo aleatório ----------
// shield 40% (mais comum, salva vida)
// slowmo 30%
// magnet 30%
function randomPowerupType(rng) {
  const r = (rng || Math.random)();
  if (r < 0.40) return 'shield';
  if (r < 0.70) return 'slowmo';
  return 'magnet';
}

// ---------- Classe PowerupManager ----------
export class PowerupManager {
  constructor(config = POWERUP_CONFIG) {
    this._config = config;
    this._floating = [];                    // power-ups no canvas (não coletados)
    this._active = {                        // ativos no pássaro (com timestamps)
      shield: 0,
      slowmo: 0,
      magnet: 0,
      magnetBonusUsed: 0,
    };
    this._nextSpawnAt = config.INTERVAL;
    this._invulnerableUntil = 0;
  }

  // ---------- Getters públicos ----------

  get floating() { return this._floating; }
  get nextSpawnAt() { return this._nextSpawnAt; }
  get invulnerableUntil() { return this._invulnerableUntil; }
  set invulnerableUntil(v) { this._invulnerableUntil = Number(v) || 0; }

  isActive(type, timestamp) {
    return this._active[type] > timestamp;
  }

  getActiveState() {
    return {
      shield: this._active.shield,
      slowmo: this._active.slowmo,
      magnet: this._active.magnet,
      magnetBonusUsed: this._active.magnetBonusUsed,
    };
  }

  // ---------- Spawning ----------

  /**
   * Spawna um power-up em uma posição X, escolhendo Y alcançável.
   * @param {number} x — posição X
   * @param {Array} pipes — array de canos para posicionar Y no gap
   * @param {number} playfieldHeight
   * @param {number} now — timestamp (performance.now())
   * @param {function} [rng] — gerador aleatório (para teste)
   */
  spawn(x, pipes, playfieldHeight, now, rng) {
    if (typeof x !== 'number' || !isFinite(x)) return;
    const type = randomPowerupType(rng);
    let y;
    const nearby = (pipes || []).find(p => Math.abs(p.x - x) < 100);
    if (nearby) {
      y = nearby.gapY + ((rng || Math.random)() - 0.5) * 40;
      y = Math.max(60, Math.min(playfieldHeight - 60, y));
    } else {
      y = 60 + (rng || Math.random)() * (playfieldHeight - 120);
    }
    this._floating.push({
      x, y, type,
      collected: false,
      spawnTime: now,
    });
  }

  /**
   * Avança o marcador "próximo spawn" se o score atingiu o ponto.
   * @returns {boolean} true se deve spawnar agora
   */
  shouldSpawn(score) {
    if (score >= this._nextSpawnAt) {
      this._nextSpawnAt += this._config.INTERVAL;
      return true;
    }
    return false;
  }

  // ---------- Movimento / Colisão ----------

  /**
   * Atualiza posições dos power-ups flutuantes e remove os fora da tela.
   * @param {number} speed — velocidade efetiva do jogo (px/frame)
   * @param {number} delta — delta time
   */
  update(speed, delta) {
    for (const pu of this._floating) {
      if (!pu.collected) pu.x -= speed * delta;
    }
    // Cull — remove power-ups coletados ou fora da tela
    while (this._floating.length > 0 &&
           (this._floating[0].collected || this._floating[0].x < -30)) {
      this._floating.shift();
    }
  }

  /**
   * Verifica colisão entre pássaro e power-ups flutuantes.
   * @param {number} birdX
   * @param {number} birdY
   * @param {number} birdWidth
   * @param {number} now
   * @param {function} onCollect — callback(type, now)
   */
  checkCollisions(birdX, birdY, birdWidth, now, onCollect) {
    for (const pu of this._floating) {
      if (pu.collected) continue;
      const dx = birdX - pu.x;
      const dy = birdY - pu.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this._config.RADIUS + birdWidth / 2 - 4) {
        pu.collected = true;
        if (typeof onCollect === 'function') onCollect(pu.type, now);
      }
    }
  }

  // ---------- Ativação de power-ups ----------

  /**
   * Ativa um power-up no pássaro.
   * @param {string} type
   * @param {number} now
   * @param {object} opts — { onScoreBonus: fn, onSound: fn }
   * @returns {object} estado resultante (para o caller atualizar score/som)
   */
  activate(type, now, opts = {}) {
    if (!POWERUP_TYPES.includes(type)) return null;
    const cfg = this._config;

    if (type === 'shield') {
      if (this.isActive('shield', now)) {
        // Shield já ativo: converte em pontos (não stacka)
        if (typeof opts.onScoreBonus === 'function') {
          opts.onScoreBonus(cfg.SHIELD_BONUS_IF_ACTIVE);
        }
      } else {
        this._active.shield = Number.MAX_SAFE_INTEGER;
      }
    } else if (type === 'slowmo') {
      const currentEnd = this._active.slowmo;
      const newEnd = now + cfg.SLOWMO_DURATION_MS;
      this._active.slowmo = Math.max(currentEnd, newEnd);
    } else if (type === 'magnet') {
      this._active.magnet = now + cfg.MAGNET_DURATION_MS;
      this._active.magnetBonusUsed = 0;
    }

    if (typeof opts.onSound === 'function') opts.onSound('point');
    return this.getActiveState();
  }

  /**
   * Consome um shield ativo e ativa invulnerabilidade temporária.
   * @param {number} now
   * @returns {boolean} true se o shield foi consumido
   */
  consumeShield(now) {
    if (!this.isActive('shield', now)) return false;
    this._active.shield = 0;
    this._invulnerableUntil = now + this._config.INVULNERABILITY_AFTER_SHIELD_MS;
    return true;
  }

  /**
   * Verifica se um ponto marcado deve ser dobrado pelo magnet ativo.
   * Limita o bônus a MAGNET_BONUS_POINTS pontos dobrados.
   * @param {number} now
   * @returns {number} 1 (sem bônus) ou 2 (com bônus)
   */
  applyMagnetBonus(now) {
    if (!this.isActive('magnet', now)) return 1;
    if (this._active.magnetBonusUsed >= this._config.MAGNET_BONUS_POINTS) return 1;
    this._active.magnetBonusUsed++;
    if (this._active.magnetBonusUsed >= this._config.MAGNET_BONUS_POINTS) {
      this._active.magnet = 0;  // expira ao atingir limite
    }
    return 2;
  }

  // ---------- Reset ----------

  clear() {
    this._floating.length = 0;
    this._active.shield = 0;
    this._active.slowmo = 0;
    this._active.magnet = 0;
    this._active.magnetBonusUsed = 0;
    this._nextSpawnAt = this._config.INTERVAL;
    this._invulnerableUntil = 0;
  }

  // ---------- Renderização ----------

  /**
   * Renderiza os power-ups flutuantes no canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} now
   */
  renderFloating(ctx, now) {
    const R = this._config.RADIUS;
    for (const pu of this._floating) {
      if (pu.collected) continue;
      const floatY = Math.sin(now / 300 + pu.x * 0.05) * 3;
      const cx = pu.x;
      const cy = pu.y + floatY;
      const pulse = 0.7 + 0.3 * Math.sin(now / 200);

      ctx.save();
      ctx.translate(cx, cy);

      // Glow
      const glowRadius = R + 4 + 2 * Math.sin(now / 150);
      const gradient = ctx.createRadialGradient(0, 0, R - 2, 0, 0, glowRadius);
      let glowColor;
      if (pu.type === 'shield') glowColor = '80, 180, 255';
      else if (pu.type === 'slowmo') glowColor = '180, 130, 255';
      else glowColor = '255, 200, 60';
      gradient.addColorStop(0, `rgba(${glowColor}, ${0.6 * pulse})`);
      gradient.addColorStop(1, `rgba(${glowColor}, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Corpo
      this._drawBody(ctx, pu.type, R, pulse);
      ctx.restore();
    }
  }

  /**
   * Renderiza os efeitos visuais ativos no pássaro (shield ring, magnet orbit).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} birdWidth
   * @param {number} now
   */
  renderBirdEffects(ctx, birdWidth, now) {
    // Shield: dois anéis azuis pulsantes
    if (this.isActive('shield', now)) {
      const shieldPulse = 0.6 + 0.4 * Math.sin(now / 100);
      ctx.save();
      ctx.strokeStyle = `rgba(80, 180, 255, ${shieldPulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, birdWidth / 2 + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(80, 180, 255, ${shieldPulse * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, birdWidth / 2 + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Magnet: 3 partículas douradas orbitando
    if (this.isActive('magnet', now)) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const angle = now / 300 + (i * Math.PI * 2 / 3);
        const orbitR = birdWidth / 2 + 6;
        const px = Math.cos(angle) * orbitR;
        const py = Math.sin(angle) * orbitR;
        ctx.fillStyle = 'rgba(255, 200, 60, 0.9)';
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 220, 120, 0.3)';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * Renderiza overlay de slow-mo no canvas inteiro.
   */
  renderSlowmoOverlay(ctx, w, h, now) {
    if (!this.isActive('slowmo', now)) return;
    ctx.save();
    ctx.fillStyle = 'rgba(120, 100, 220, 0.12)';
    ctx.fillRect(0, 0, w, h);
    const pulse = 0.4 + 0.3 * Math.sin(now / 150);
    ctx.strokeStyle = `rgba(180, 130, 255, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.restore();
  }

  /**
   * Renderiza HUD de power-ups ativos (canto inferior direito).
   */
  renderHud(ctx, gameWidth, playfieldHeight, now) {
    const cfg = this._config;
    let hudY = playfieldHeight - 12;
    const hudX = gameWidth - 30;
    const list = [];

    if (this.isActive('shield', now)) list.push({ type: 'shield' });
    if (this.isActive('slowmo', now)) {
      list.push({ type: 'slowmo', remaining: (this._active.slowmo - now) / 1000 });
    }
    if (this.isActive('magnet', now)) {
      list.push({
        type: 'magnet',
        remaining: (this._active.magnet - now) / 1000,
        bonusLeft: cfg.MAGNET_BONUS_POINTS - (this._active.magnetBonusUsed || 0),
      });
    }

    for (const item of list) {
      ctx.save();
      ctx.translate(hudX, hudY);
      let color;
      if (item.type === 'shield') color = '#3c8ce6';
      else if (item.type === 'slowmo') color = '#8c5adc';
      else color = '#ffb428';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'right';
      if (item.type === 'shield') {
        ctx.fillText('∞', -10, 3);
      } else if (item.type === 'slowmo') {
        ctx.fillText(item.remaining.toFixed(1) + 's', -10, 3);
      } else {
        ctx.fillText(item.bonusLeft + 'x ' + item.remaining.toFixed(1) + 's', -10, 3);
      }
      ctx.restore();
      hudY -= 18;
    }
  }

  // ---------- Interno: desenho do corpo de cada tipo ----------

  _drawBody(ctx, type, R, pulse) {
    if (type === 'shield') {
      ctx.fillStyle = `rgba(60, 140, 230, ${0.85 * pulse + 0.15})`;
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      ctx.moveTo(0, -5); ctx.lineTo(0, 5);
      ctx.stroke();
    } else if (type === 'slowmo') {
      ctx.fillStyle = `rgba(140, 90, 220, ${0.85 * pulse + 0.15})`;
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-6, -6); ctx.lineTo(6, -6); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6, 6); ctx.lineTo(6, 6); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fill();
    } else if (type === 'magnet') {
      ctx.fillStyle = `rgba(255, 180, 40, ${0.85 * pulse + 0.15})`;
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, -1, 6, Math.PI, 0, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, -1); ctx.lineTo(-6, 6);
      ctx.moveTo(6, -1); ctx.lineTo(6, 6);
      ctx.stroke();
    }
  }
}
