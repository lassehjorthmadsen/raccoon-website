/**
 * Standard backgammon move notation, from the mover's point numbering.
 *
 * Points are numbered 24 down to 1 towards the mover's home, so a board index i
 * reads as point i+1. Repeated moves collapse ("13/7(2)"), hits are starred
 * ("6/1*"), and the bar and the tray get their usual names.
 */

import { BAR, OFF } from "./board.js";

export function formatMove(move) {
  const from = move.from === BAR ? "bar" : String(move.from + 1);
  const to = move.to === OFF ? "off" : String(move.to + 1);
  return `${from}/${to}${move.hit ? "*" : ""}`;
}

/** A whole play, e.g. "24/18 13/11" or "8/5(2)". */
export function formatPlay(moves) {
  if (!moves || moves.length === 0) return "cannot move";

  const counts = new Map();
  for (const move of moves) {
    const text = formatMove(move);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts]
    .map(([text, count]) => (count > 1 ? `${text}(${count})` : text))
    .join(" ");
}

/** Equity to three decimals, sign always shown. */
export function formatEquity(equity) {
  return `${equity >= 0 ? "+" : "−"}${Math.abs(equity).toFixed(3)}`;
}

/** Percentage with one decimal, for the win/gammon/backgammon split. */
export function formatPercent(p) {
  return `${(100 * p).toFixed(1)}%`;
}
