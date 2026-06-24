/* ==========================================================================
   Butiázinho — main.js
   --------------------------------------------------------------------------
   Entry point do jogo.
   - Busca os elementos do DOM (validados)
   - Instancia o jogo via factory createGame()
   - Inicia o boot (preload + game loop)
   ========================================================================== */

import { createGame } from './game.js';

// Em produção, NÃO definimos window.__BUTIAZINHO_DEBUG__.
// Para debug local, abra o console e digite:
//   window.__BUTIAZINHO_DEBUG__ = true;
// e recarregue a página.

(function bootstrap() {
  /** @type {HTMLCanvasElement} */
  const canvas    = document.getElementById('game');
  const scoreEl   = document.getElementById('scoreVal');
  const bestEl    = document.getElementById('bestVal');
  const hintEl    = document.getElementById('hint');
  const loadingEl = document.getElementById('loading');
  const muteBtn   = document.getElementById('muteBtn');
  const gameWrap  = document.getElementById('gameWrap');

  // Validação defensiva — se faltar algum elemento, mostramos mensagem limpa.
  if (!canvas || !scoreEl || !bestEl || !hintEl || !loadingEl || !muteBtn || !gameWrap) {
    console.error('[Butiázinho] Elementos do DOM não encontrados.');
    return;
  }

  try {
    const game = createGame({
      canvas, scoreEl, bestEl, hintEl, loadingEl, muteBtn, gameWrap,
    });
    game.boot();
  } catch (err) {
    console.error('[Butiázinho] Erro ao iniciar o jogo:', err);
    loadingEl.textContent = '';
    loadingEl.classList.add('error');
    const div = document.createElement('div');
    div.style.color = '#fff';
    div.style.padding = '20px';
    div.style.textAlign = 'center';
    div.textContent = 'Não foi possível iniciar o jogo.';
    loadingEl.appendChild(div);
  }
})();
