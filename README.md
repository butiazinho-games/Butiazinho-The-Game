# Butiázinho 🐤

Jogo HTML5 estilo Flappy Bird com power-ups, modo hard e ciclo dia/noite.

**Autor original:** Célio De Oliveira
**Versão:** 2.0 (refatorada para GitHub Pages)

---

## ▶️ Como jogar

- **Toque na tela** / **clique** / **barra de espaço** / **seta ↑** / **W** para fazer o Butiázinho voar.
- **M** para alternar som (mute/unmute).
- Desvie dos canos verdes. A cada cano passado, +1 ponto.
- A cada 10 pontos, o cenário alterna entre **dia** e **noite**.
- A partir de 20 pontos, entra em **MODO HARD**: canos mais rápidos, gap menor, overlay vermelho.
- Power-ups aparecem a cada 10 pontos:
  - 🛡️ **Shield** — absorve 1 hit (dura até ser usado). Se já estiver ativo, +3 pontos.
  - ⏳ **Slow-mo** — câmera lenta por 4 segundos.
  - 🧲 **Magnet** — próximos 5 pontos valem 2x (duração máx. 5 segundos).

---

## 📁 Estrutura do projeto

```
/
├── index.html              # HTML mínimo, sem JS ou CSS inline
├── css/
│   └── style.css           # Todos os estilos
├── js/
│   ├── main.js             # Entry point (ES6 module)
│   ├── game.js             # Lógica principal + estado encapsulado
│   ├── audio.js            # Gerenciador de áudio (anti-overlap, autoplay-safe)
│   ├── assets.js           # Pré-carregamento + fallback visual
│   └── powerups.js         # Sistema de power-ups
├── assets/
│   ├── images/             # 19 imagens (WebP + PNG)
│   └── audio/              # 6 efeitos + BGM (MP3)
└── README.md               # Este arquivo
```

---

## 🚀 Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `butiazinho`).
2. Faça upload de **todos os arquivos desta pasta** para o repositório (mantendo a estrutura).
3. No GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root**.
4. Aguarde ~1 minuto. O jogo estará disponível em:
   ```
   https://<seu-usuario>.github.io/butiazinho/
   ```

> **Importante:** os caminhos dos assets são **relativos** (`assets/images/...`, `js/main.js`),
> então o jogo funciona tanto na raiz do domínio quanto em subpaths (`/repo-name/`).

---

## 🔒 Segurança

- ✅ Nenhum uso de `innerHTML` com dados dinâmicos — somente `textContent` e `createElement`.
- ✅ Sem `eval()`, `new Function()`, `document.write()`, `setTimeout(string)`, `setInterval(string)`.
- ✅ Pré-carregamento de assets usa paths **estáticos** definidos no código.
- ✅ Tratamento de erros: erros vão para `console` apenas; usuário vê mensagem amigável.
- ✅ **Modo produção:** logs só são emitidos quando `window.__BUTIAZINHO_DEBUG__ = true`.

---

## 🛡️ Anti-cheat

- Todo o estado do jogo (score, highScore, pipes, bird, state, powerups) é **encapsulado em closure** — não há variáveis globais acessíveis pelo console.
- **Validação interna de score:** incrementos maiores que 5 pontos por frame são rejeitados.
- **Checksum (FNV-1a)** do score é verificado a cada frame. Se o score for adulterado diretamente via console, o jogo detecta e restaura para o último valor validado.
- Objetos de configuração são `Object.freeze()`'d.

> **Nota realista:** anti-cheat client-side nunca é 100% eficaz (qualquer JS pode ser reescrito no DevTools). O objetivo aqui é dificultar adulteração casual e validar integridade do estado interno.

---

## ⚡ Performance

- ✅ Game loop único com `requestAnimationFrame` guardado (sempre no máximo 1 RAF ativo).
- ✅ Pausa automática em `visibilitychange` (aba oculta) e `blur`/`focus` da janela.
- ✅ Cull de pipes e power-ups fora da tela a cada frame.
- ✅ Reuso de objetos: arrays de pipes/power-ups, sem `new` dentro do loop principal.
- ✅ Colisões com **early-return** por bounding-box antes de cálculos de gap.
- ✅ Throttle de áudio para evitar `play()` em loop apertado.
- ✅ Imagens grandes em WebP (40% menor em média que PNG).

---

## 🔊 Áudio

- Efeitos sonoros com throttle de 30ms (sem overlap do mesmo efeito).
- BGM em loop com retentativas (lida com autoplay policy do Chrome/Safari).
- `unlockOnUserGesture()` destrava o audio context no primeiro toque (mobile).
- Todos os `play()` envolvidos em `try/catch` — nunca quebra o jogo por falha de áudio.

---

## 🧱 Robustez

- ✅ **Fallback procedural:** se uma imagem falhar, um placeholder em canvas é gerado automaticamente.
- ✅ Todos os `drawImage` envolvidos em `drawImageSafe()` (try/catch).
- ✅ Validação de objetos antes de uso (`instanceof HTMLAudioElement`, etc.).
- ✅ Assets ausentes não travam o boot — o jogo inicia com fallbacks.
- ✅ `localStorage` tratado defensivamente (modo privado / storage cheio).

---

## 🌐 Compatibilidade

Testado para funcionar em:

| Navegador            | Versão mínima       |
|----------------------|---------------------|
| Chrome (Desktop)     | 90+                 |
| Chrome (Android)     | 90+                 |
| Edge                 | 90+                 |
| Firefox              | 90+                 |
| Safari (iOS)         | 14+                 |

Requer suporte a:
- ES6 Modules (`<script type="module">`)
- `requestAnimationFrame`
- WebAudio / HTML5 Audio
- WebP (presente em todos os navegadores acima)

---

## 🛠️ Desenvolvimento (debug local)

Por padrão, o jogo roda em **modo produção** (console limpo).

Para ativar logs de debug:

```js
// No console do DevTools:
window.__BUTIAZINHO_DEBUG__ = true;
// Recarregue a página.
```

Para rodar localmente, use um servidor estático (não `file://`, pois ES6 modules exigem HTTP):

```bash
# Python 3
python3 -m http.server 8000

# Node (qualquer versão)
npx serve .
```

Abra `http://localhost:8000/` no navegador.

---

## 📜 Créditos

- **Jogo original:** Célio De Oliveira
- **Assets:** Sprites clássicos do Flappy Bird (domínio público / fair use)
- **Refatoração:** Auditoria completa conforme checklist de 40 itens

---

## 📄 Licença

Código sob licença MIT. Assets originais pertencem a seus respectivos donos.
