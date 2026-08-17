/**
 * The analysis panel: what the engine thinks of every legal play.
 *
 * Equities are cubeless money points from the mover's side, and the
 * probabilities are the six-outcome value head read straight out — win, win a
 * gammon, win a backgammon, and the same three the other way. The column that
 * matters most is Diff: how much equity a play gives up against the best, which
 * is the quantity error rates are built from.
 *
 * The six outcomes are shown the way XG and GNU Backgammon show them, which is
 * cumulative: W counts every win, Wg counts gammons *and* backgammons, Wbg
 * counts backgammons alone. The value head's own buckets are exclusive, so the
 * gammon columns add two of them together. Losing chances are 100 − W and get no
 * column of their own.
 */

import { formatEquity, formatPlay } from "../engine/notation.js";
import { winProbability } from "../engine/evaluator.js";

const MAX_ROWS = 8;

export function renderAnalysis(container, candidates, { played = null, caption = "" } = {}) {
  if (!candidates || candidates.length === 0) {
    container.innerHTML = "";
    return;
  }

  const best = candidates[0].equity;
  const rows = candidates.slice(0, MAX_ROWS).map((candidate, index) => {
    const moves = candidate.continuation
      ? [...candidate.moves, ...candidate.continuation.moves]
      : candidate.moves;
    const isPlayed = played && candidate.key === played;
    const diff = candidate.equity - best;
    const p = candidate.probs;

    return `<tr class="${isPlayed ? "rb-row--played" : ""}">
      <td class="rb-rank">${index + 1}</td>
      <td class="rb-move">${escape(formatPlay(moves))}</td>
      <td class="rb-num rb-eq">${formatEquity(candidate.equity)}</td>
      <td class="rb-num rb-diff">${index === 0 ? "" : formatEquity(diff)}</td>
      <td class="rb-num">${p ? percentPoints(winProbability(p)) : "—"}</td>
      <td class="rb-num">${p ? percentPoints(p.winGammon + p.winBackgammon) : "—"}</td>
      <td class="rb-num rb-num--faint">${p ? percentPoints(p.winBackgammon) : "—"}</td>
      <td class="rb-num">${p ? percentPoints(p.loseGammon + p.loseBackgammon) : "—"}</td>
      <td class="rb-num rb-num--faint">${p ? percentPoints(p.loseBackgammon) : "—"}</td>
    </tr>`;
  });

  const hidden = candidates.length - rows.length;

  container.innerHTML = `
    ${caption ? `<p class="rb-analysis-title">${escape(caption)}</p>` : ""}
    <table class="rb-table">
      <thead>
        <tr>
          <th></th>
          <th>Play</th>
          <th class="rb-num">Equity</th>
          <th class="rb-num" title="Equity given up against the best play">Diff</th>
          <th class="rb-num" title="Chance of winning, however it ends (%)">W</th>
          <th class="rb-num" title="Chance of winning a gammon or a backgammon (%)">Wg</th>
          <th class="rb-num" title="Chance of winning a backgammon (%)">Wbg</th>
          <th class="rb-num" title="Chance of losing a gammon or a backgammon (%)">Lg</th>
          <th class="rb-num" title="Chance of losing a backgammon (%)">Lbg</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    ${hidden > 0 ? `<p class="rb-note">and ${hidden} more legal ${hidden === 1 ? "play" : "plays"}</p>` : ""}
    <p class="rb-note">Cubeless money equity, from the side on roll. One network
    evaluation per candidate — no search. Percentages are cumulative, as in XG:
    the gammon columns include backgammons, and the chance of losing is 100 − W.</p>
  `;
}

/**
 * The one line that says what just happened: the roll and the play, alternating
 * between the two sides. Without it the engine's turn is invisible — it rolls,
 * thinks and moves faster than the eye follows, and the board simply changes.
 */
const sameDice = (a, b) => Boolean(a && b && a[0] === b[0] && a[1] === b[1]);

export function renderLastPlay(container, game) {
  const entry = lastEntry(game.log);
  const onRoll = game.humanOnRoll ? "human" : "engine";
  // With dice on the board the mover may or may not have played yet. Once the
  // decision is logged, prefer it — that is the beat where the move becomes
  // visible, and the dice are still showing.
  const pending =
    game.dice && !(entry && entry.side === onRoll && sameDice(entry.dice, game.dice));
  const source = pending ? { side: onRoll, dice: game.dice } : entry;

  if (!source) {
    container.innerHTML = "";
    return;
  }

  const who = source.side === "human" ? "You" : "Raccoon";
  const dice = source.dice ? `${source.dice[0]}${source.dice[1]}` : "";
  const play = source.moves ? `: ${escape(formatPlay(source.moves))}` : "…";
  container.innerHTML =
    `<span class="rb-log-who rb-log-who--${source.side}">${who}</span> rolled ` +
    `<span class="rb-lastplay-dice">${dice}</span>` +
    `<span class="rb-lastplay-move">${play}</span>`;
}

/**
 * The newest completed play. A doubles turn is logged as two decisions, the
 * second flagged `continuation`, so the two are joined back into one line.
 */
function lastEntry(log) {
  const last = log.at(-1);
  if (!last) return null;
  if (!last.continuation) return last;
  const first = log.at(-2);
  return first ? { ...first, moves: [...first.moves, ...last.moves] } : last;
}

/** The move list, newest first, as a compact game record. */
export function renderLog(container, log) {
  const entries = [...log]
    .reverse()
    .slice(0, 12)
    .map((entry) => {
      const dice = entry.dice ? `${entry.dice[0]}${entry.dice[1]}` : "";
      const who = entry.side === "human" ? "You" : "Raccoon";
      return `<li><span class="rb-log-who rb-log-who--${entry.side}">${who}</span>
        <span class="rb-log-dice">${dice}</span>
        <span class="rb-log-move">${escape(formatPlay(entry.moves))}</span></li>`;
    });
  container.innerHTML = entries.length ? `<ol class="rb-log-list">${entries.join("")}</ol>` : "";
}

/** Bare number: the outcome columns carry their "%" in the footnote, not in 40 cells. */
function percentPoints(p) {
  return (100 * p).toFixed(1);
}

function escape(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
