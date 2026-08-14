/**
 * Boots the engine UI into any .raccoon-app container on the page.
 *
 * Nothing heavy loads until it is needed: the page is fully usable before the
 * ~47 MB network is fetched, and the fetch only starts when the engine is
 * actually asked to think. Static pages with no container exit at the first
 * line.
 */

import { startingPosition } from "./engine/board.js";
import { formatXgid, parseXgid } from "./engine/xgid.js";
import { BoardView } from "./ui/boardview.js";
import { Game } from "./ui/game.js";
import { renderAnalysis, renderLog } from "./ui/analysis.js";

// Resolved against this module's own URL so the site works wherever it is
// mounted — the custom domain at the root, or a GitHub project subpath.
const MODEL_URL = new URL("./models/exp018-ep22-fp32.onnx", import.meta.url).href;
const META_URL = new URL("./models/exp018-ep22.meta.json", import.meta.url).href;

function mount(container, mode) {
  const analysing = mode === "analyse";
  container.classList.add("raccoon-app--ready");
  container.innerHTML = template(analysing);

  const engine = new EngineClient((status) => setStatus(container, status));
  const board = new BoardView(container.querySelector(".rb-board"), {
    onSelect: (target) => game.select(target),
  });

  const game = new Game({
    engine,
    autoplay: !analysing,
    onChange: (state) => draw(container, board, state, analysing),
  });

  container.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-act]")?.dataset.act;
    if (!action) return;

    if (action === "roll") game.roll();
    if (action === "new") game.newGame();
    if (action === "undo") game.undo();
    if (action === "hint") {
      setStatus(container, "Thinking…");
      await game.analyse();
      setStatus(container, "");
    }
    if (action === "load-xgid") loadXgid(container, game);
    if (action === "copy-xgid") copyXgid(container, game);
  });

  if (analysing) {
    game.setPosition(startingPosition(), { dice: [3, 1] });
  }
  draw(container, board, game, analysing);
}

function template(analysing) {
  return `
    <div class="rb-app">
      <svg class="rb-board" role="img" aria-label="Backgammon board"></svg>
      <aside class="rb-panel">
        <p class="rb-status" role="status"></p>
        <div class="rb-controls">
          <button type="button" data-act="roll" class="rb-btn rb-btn--primary">Roll</button>
          <button type="button" data-act="undo" class="rb-btn">Undo</button>
          <button type="button" data-act="hint" class="rb-btn">${analysing ? "Analyse" : "Hint"}</button>
          <button type="button" data-act="new" class="rb-btn">New game</button>
        </div>
        ${
          analysing
            ? `<div class="rb-xgid">
                 <label for="rb-xgid-input">Position (XGID)</label>
                 <input id="rb-xgid-input" class="rb-xgid-input" spellcheck="false"
                        placeholder="XGID=-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10">
                 <div class="rb-xgid-actions">
                   <button type="button" data-act="load-xgid" class="rb-btn">Load</button>
                   <button type="button" data-act="copy-xgid" class="rb-btn">Copy current</button>
                 </div>
               </div>`
            : ""
        }
        <div class="rb-analysis"></div>
        <div class="rb-log"></div>
      </aside>
    </div>`;
}

function draw(container, board, game, analysing) {
  board.render(game.humanView(), {
    dice: game.dice,
    selected: game.selected,
    destinations: game.destinations(),
    onRoll: game.humanOnRoll ? "human" : "engine",
  });

  const played = game.log.at(-1);
  renderAnalysis(container.querySelector(".rb-analysis"), game.analysis);
  renderLog(container.querySelector(".rb-log"), game.log);

  container.querySelector('[data-act="roll"]').disabled =
    !(game.phase === "opening" || game.phase === "rolling");
  container.querySelector('[data-act="undo"]').disabled = game.pending.length === 0;
  container.querySelector('[data-act="hint"]').disabled = !game.dice || game.phase === "gameover";

  setStatus(container, describe(game, analysing, played));
}

function describe(game, analysing, played) {
  if (game.phase === "gameover") {
    const { points, kind } = game.result;
    const who = points > 0 ? "You win" : "Raccoon wins";
    const suffix = kind === "single" ? "" : ` a ${kind}`;
    return `${who}${suffix} — ${Math.abs(points)} ${Math.abs(points) === 1 ? "point" : "points"}.`;
  }
  if (game.phase === "thinking") return "Raccoon is thinking…";
  if (game.phase === "opening") return "Roll to start. Higher die moves first.";
  if (game.phase === "rolling") {
    return analysing ? "Roll for the side on roll." : game.humanOnRoll ? "Your roll." : "Raccoon rolls…";
  }
  if (game.midDoubles) return "Doubles — two more half-moves.";
  if (!game.humanOnRoll && !analysing) return "Raccoon is moving…";
  if (game.selected !== null) return "Now click where the checker goes.";
  if (played?.side === "engine" && played.equity !== undefined) {
    return `Raccoon played. Your move.`;
  }
  return "Click a checker, then its destination.";
}

function setStatus(container, text) {
  if (text !== undefined) container.querySelector(".rb-status").textContent = text;
}

function loadXgid(container, game) {
  const input = container.querySelector(".rb-xgid-input");
  try {
    const { position, dice } = parseXgid(input.value);
    game.setPosition(position, { dice: dice ?? [3, 1] });
    setStatus(container, dice ? "Position loaded." : "Position loaded — dice set to 3-1.");
  } catch (error) {
    setStatus(container, `That XGID did not parse: ${error.message}`);
  }
}

function copyXgid(container, game) {
  const text = formatXgid(game.position, { dice: game.dice });
  container.querySelector(".rb-xgid-input").value = text;
  navigator.clipboard?.writeText(text).catch(() => {});
  setStatus(container, "XGID copied.");
}

/**
 * Talks to the engine worker, loading it on first use.
 *
 * Every request is a promise keyed by id; download progress arrives as
 * unsolicited messages and goes straight to the status line.
 */
class EngineClient {
  #worker = null;
  #pending = new Map();
  #nextId = 1;
  #ready = null;
  #onStatus;

  constructor(onStatus) {
    this.#onStatus = onStatus;
  }

  async rank(position, dice, midDoubles) {
    await this.#load();
    return this.#send("rank", { position, dice, midDoubles });
  }

  #load() {
    if (this.#ready) return this.#ready;

    this.#worker = new Worker(new URL("./engine/worker.js", import.meta.url), { type: "module" });
    this.#worker.onmessage = (event) => this.#receive(event.data);
    this.#worker.onerror = (event) => this.#onStatus(`Engine failed to start: ${event.message}`);

    this.#onStatus("Loading the network…");
    this.#ready = this.#send("load", { modelUrl: MODEL_URL, metaUrl: META_URL }).then((info) => {
      this.#onStatus("");
      return info;
    });
    return this.#ready;
  }

  #send(type, payload) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, type, payload });
    });
  }

  #receive(message) {
    if (message.progress) {
      const { loaded, total } = message.progress;
      const mb = (bytes) => (bytes / 1e6).toFixed(0);
      this.#onStatus(
        total
          ? `Loading the network… ${mb(loaded)} of ${mb(total)} MB`
          : `Loading the network… ${mb(loaded)} MB`,
      );
      return;
    }
    const waiting = this.#pending.get(message.id);
    if (!waiting) return;
    this.#pending.delete(message.id);
    if (message.ok) waiting.resolve(message.result);
    else waiting.reject(new Error(message.error));
  }
}

// Bootstrap last: `class` declarations are not hoisted the way functions are,
// so mounting before EngineClient is evaluated throws on its own definition.
for (const container of document.querySelectorAll(".raccoon-app")) {
  try {
    mount(container, container.dataset.mode ?? "play");
  } catch (error) {
    container.innerHTML = `<p class="rb-error">The board failed to start: ${error.message}</p>`;
  }
}
