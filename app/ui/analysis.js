/**
 * The analysis panel: what the engine thinks of every legal play.
 *
 * Equities are cubeless money points from the mover's side, and the
 * probabilities are the six-outcome value head read straight out — win, win a
 * gammon, win a backgammon, and the same three the other way. The column that
 * matters most is the last one: how much equity a play gives up against the
 * best, which is the quantity error rates are built from.
 */

import { formatEquity, formatPercent, formatPlay } from "../engine/notation.js";
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
    const loss = candidate.equity - best;

    return `<tr class="${isPlayed ? "rb-row--played" : ""}">
      <td class="rb-rank">${index + 1}</td>
      <td class="rb-move">${escape(formatPlay(moves))}</td>
      <td class="rb-eq">${formatEquity(candidate.equity)}</td>
      <td class="rb-loss">${index === 0 ? "" : formatEquity(loss)}</td>
      <td class="rb-win">${candidate.probs ? formatPercent(winProbability(candidate.probs)) : "—"}</td>
      <td class="rb-gam">${
        candidate.probs
          ? `${percentPoints(candidate.probs.winGammon + candidate.probs.winBackgammon)} / ` +
            `${percentPoints(candidate.probs.loseGammon + candidate.probs.loseBackgammon)}`
          : "—"
      }</td>
    </tr>`;
  });

  const hidden = candidates.length - rows.length;

  container.innerHTML = `
    ${caption ? `<p class="rb-analysis-title">${escape(caption)}</p>` : ""}
    <table class="rb-table">
      <thead>
        <tr>
          <th></th><th>Play</th><th>Equity</th><th>Loss</th><th>Win</th>
          <th title="Gammon or backgammon, won / lost (%)">G w/l</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    ${hidden > 0 ? `<p class="rb-note">and ${hidden} more legal ${hidden === 1 ? "play" : "plays"}</p>` : ""}
    <p class="rb-note">Cubeless money equity, from the side on roll. One network
    evaluation per candidate — no search.</p>
  `;
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

/** Bare number for the paired gammon column, which is already headed "%". */
function percentPoints(p) {
  return (100 * p).toFixed(1);
}

function escape(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
