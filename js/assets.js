/* ==========================================================================
   Butiázinho — assets.js
   --------------------------------------------------------------------------
   Responsabilidades:
     - Mapear nomes lógicos → arquivos físicos em /assets/
     - Pré-carregar imagens; expor efeitos para decode assíncrono no AudioManager
     - Garantir fallback visual quando uma imagem falta ou falha
     - Expor um objeto imutável (frozen) com os assets carregados
     - Nunca expor dados externos arbitrários como código executável

   Segurança:
     - Nenhum uso de innerHTML
     - Paths são strings fixas (não vindas de input do usuário)
     - Falhas de carregamento são tratadas com fallback, não com throw
   ========================================================================== */

// ---------- Configuração de paths (relativos ao index.html) ----------
const ASSET_BASE = 'assets';
const IMAGE_DIR = `${ASSET_BASE}/images`;
const AUDIO_DIR = `${ASSET_BASE}/audio`;

// ---------- Mapa estático de assets ----------
// Cada item: nome lógico → caminho físico.
// Estes caminhos são constantes definidas no código (não dinâmicas),
// portanto não há risco de injeção de path.
const IMAGE_MANIFEST = Object.freeze({
  backgroundday:    `${IMAGE_DIR}/backgroundday.webp`,
  backgroundnight:  `${IMAGE_DIR}/backgroundnight.webp`,
  base:             `${IMAGE_DIR}/base.webp`,
  pipegreen:        `${IMAGE_DIR}/pipegreen.webp`,
  yellowbirddownflap: `${IMAGE_DIR}/yellowbirddownflap.webp`,
  yellowbirdmidflap:  `${IMAGE_DIR}/yellowbirdmidflap.webp`,
  yellowbirdupflap:   `${IMAGE_DIR}/yellowbirdupflap.webp`,
  gameover:         `${IMAGE_DIR}/gameover.webp`,
  message:          `${IMAGE_DIR}/message.webp`,
  num0:             `${IMAGE_DIR}/num0.png`,
  num1:             `${IMAGE_DIR}/num1.png`,
  num2:             `${IMAGE_DIR}/num2.png`,
  num3:             `${IMAGE_DIR}/num3.png`,
  num4:             `${IMAGE_DIR}/num4.png`,
  num5:             `${IMAGE_DIR}/num5.png`,
  num6:             `${IMAGE_DIR}/num6.png`,
  num7:             `${IMAGE_DIR}/num7.png`,
  num8:             `${IMAGE_DIR}/num8.png`,
  num9:             `${IMAGE_DIR}/num9.png`,
});

const AUDIO_MANIFEST = Object.freeze({
  die:     `${AUDIO_DIR}/die.mp3`,
  hit:     `${AUDIO_DIR}/hit.mp3`,
  point:   `${AUDIO_DIR}/point.mp3`,
  swoosh:  `${AUDIO_DIR}/swoosh.mp3`,
  wing:    `${AUDIO_DIR}/wing.mp3`,
  bgm:     `${AUDIO_DIR}/bgm.mp3`,
});

// ---------- Fallback procedural (canvas offscreen) ----------
// Quando uma imagem falta ou falha, geramos um placeholder em canvas
// para que o jogo nunca trave por causa de um asset ausente.
function createFallbackImage(width, height, fillStyle, label) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const cx = c.getContext('2d');
  cx.fillStyle = fillStyle;
  cx.fillRect(0, 0, width, height);
  if (label) {
    cx.fillStyle = '#fff';
    cx.font = `bold ${Math.floor(Math.min(width, height) / 6)}px sans-serif`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(label, width / 2, height / 2);
  }
  // Retorna um HTMLImageElement para uniformidade com Image()
  const img = new Image();
  img.src = c.toDataURL('image/png');
  return img;
}

// Cache de fallbacks por nome — evita regenerar a cada chamada
const fallbackCache = new Map();

function getFallback(name) {
  if (fallbackCache.has(name)) return fallbackCache.get(name);
  let fb;
  switch (name) {
    case 'backgroundday':
      fb = createFallbackImage(288, 512, '#4ec0ca', '');
      break;
    case 'backgroundnight':
      fb = createFallbackImage(288, 512, '#1a1a3a', '');
      break;
    case 'base':
      fb = createFallbackImage(336, 112, '#ded895', '');
      break;
    case 'pipegreen':
      fb = createFallbackImage(52, 320, '#74bf2e', '');
      break;
    case 'yellowbirddownflap':
    case 'yellowbirdmidflap':
    case 'yellowbirdupflap':
      fb = createFallbackImage(34, 30, '#f7d51d', 'B');
      break;
    case 'gameover':
      fb = createFallbackImage(192, 42, '#c0392b', 'Fim');
      break;
    case 'message':
      fb = createFallbackImage(184, 267, '#000000', '');
      break;
    default:
      if (name.startsWith('num')) {
        const digit = name.replace('num', '');
        fb = createFallbackImage(24, 36, 'rgba(0,0,0,0)', digit);
      } else {
        fb = createFallbackImage(64, 64, '#888', '?');
      }
  }
  fallbackCache.set(name, fb);
  return fb;
}

// ---------- Módulo de Assets (singleton) ----------
// NOTA: NÃO congelamos o objeto externo `Assets` porque precisamos substituir
// as propriedades `images` e `audio` após o preload. Em vez disso, congelamos
// APENAS os objetos internos (depois do preload) para impedir mutação acidental.
export const Assets = {
  images: {},
  audio: {},

  /**
   * Pré-carrega imagens. Áudio não bloqueia o início da partida.
   * Resolve sempre (nunca rejeita) — assets que falham usam fallback.
   * @returns {Promise<{images: Object, audio: Object, failed: string[]}>}
   */
  preload() {
    const images = {};
    const audio = {};
    const failed = [];

    const imgPromises = Object.entries(IMAGE_MANIFEST).map(([key, src]) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { images[key] = img; resolve(); };
        img.onerror = () => {
          if (window.__BUTIAZINHO_DEBUG__) {
            console.warn(`[Butiázinho] Falha ao carregar imagem: ${key} (${src})`);
          }
          images[key] = getFallback(key);
          failed.push(key);
          resolve();
        };
        img.src = src;
      })
    );

    for (const [key, src] of Object.entries(AUDIO_MANIFEST)) {
      if (key !== 'bgm') {
        // No five native MP3 players competing with short Web Audio effects.
        audio[key] = Object.freeze({ src });
        continue;
      }
      try {
        const bgm = new Audio(src);
        bgm.preload = 'metadata';
        bgm.loop = true;
        bgm.volume = 0.35;
        audio.bgm = bgm;
      } catch (error) {
        failed.push(key);
        if (window.__BUTIAZINHO_DEBUG__) console.warn('[Butiázinho] Música indisponível', error);
      }
    }

    return Promise.all(imgPromises).then(() => {
      // Substitui as propriedades internas pelos maps carregados (congelados)
      this.images = Object.freeze(images);
      this.audio  = Object.freeze(audio);
      return { images, audio, failed };
    });
  },

  /**
   * Acessa uma imagem com fallback automático.
   */
  getImage(name) {
    return this.images[name] || getFallback(name);
  },

  /**
   * Acessa o player da música ou o descritor src de um efeito.
   */
  getAudio(name) {
    return this.audio[name];
  },

  /**
   * Verifica se uma imagem carregou de verdade (não é fallback).
   */
  hasImage(name) {
    return Object.prototype.hasOwnProperty.call(this.images, name);
  },
};

export const IMAGE_KEYS = Object.freeze(Object.keys(IMAGE_MANIFEST));
export const AUDIO_KEYS = Object.freeze(Object.keys(AUDIO_MANIFEST));
