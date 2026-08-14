/**
 * Move selection: 0-ply value lookahead, the rule the published numbers measure.
 *
 * For each legal play the engine encodes the position it leads to, evaluates the
 * value head once, and takes the best. There is no search and no policy head —
 * a single batched forward pass per decision. This mirrors child_values() in
 * raccoon/train/lookahead.py, including the three things that make or break it:
 *
 *   1. A child where the opponent is on roll is encoded from THEIR side
 *      (swapPerspective) and its value negated. Relabelling without reversing
 *      the indices leaves a mirrored position that evaluates as noise.
 *   2. Doubles are scored jointly. OpenSpiel splits a double into two decisions
 *      of two half-moves, and ranking the first half by the value of the
 *      halfway position is unsound: the value head is told "you are about to
 *      roll" about a position where two half-moves of a known die are still
 *      owed, a state it never saw in training. exp020 measured the cost in real
 *      play — fixing this, with no change to the network, was worth +0.033 ppg,
 *      two thirds of the engine's entire margin over GNU Backgammon. So each
 *      first half is scored by its best continuation.
 *   3. Distinct positions are evaluated once. A doubles turn reaches ~58
 *      distinct positions along ~550 ordered paths, so deduplicating before the
 *      forward pass is the difference between a snappy board and a slow one.
 *
 * test/engine.test.js checks the whole path against 1,000 decisions taken by
 * the Python engine with the same weights.
 */

import { encodePosition, NUM_CHANNELS, BOARD_H, BOARD_W, TENSOR_SIZE } from "./encoder.js";
import { legalPlays, hasSecondDecision } from "./movegen.js";
import { CHECKERS, boardKey, isTerminal, swapPerspective, terminalPoints } from "./board.js";

/** Outcome order of the six-way value head, as trained. */
export const OUTCOMES = ["win", "winGammon", "winBackgammon", "lose", "loseGammon", "loseBackgammon"];

export class Evaluator {
  #session;
  #meta;

  constructor(session, meta) {
    this.#session = session;
    this.#meta = meta;
  }

  /**
   * Load the network. `ort` is the onnxruntime-web namespace, passed in rather
   * than imported so the worker, the page and the tests can each supply the
   * build they run (wasm in the browser, onnxruntime-node under `node --test`).
   */
  static async create({ ort, modelUrl, meta, executionProviders = ["wasm"] }) {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: "all",
    });
    return new Evaluator(session, meta);
  }

  get provenance() {
    return this.#meta;
  }

  /** Batched forward pass over encoded positions. */
  async #forward(tensors, ort) {
    const batch = tensors.length;
    const data = new Float32Array(batch * TENSOR_SIZE);
    tensors.forEach((tensor, i) => data.set(tensor, i * TENSOR_SIZE));

    const input = new ort.Tensor("float32", data, [batch, NUM_CHANNELS, BOARD_H, BOARD_W]);
    const output = await this.#session.run({ obs: input });
    return { equity: output.equity.data, probs: output.probs ? output.probs.data : null };
  }

  /**
   * Rank every legal play for `dice`.
   *
   * Candidates are decisions, not whole turns — on a double that means the
   * first two half-moves, scored by the best way to finish. Each carries
   * `equity` in money points from the mover's POV, the win/gammon/backgammon
   * split oriented the same way, and (on a double) the `continuation` that
   * earned the score, so the board can play all four half-moves at once.
   *
   * `midDoubles` marks the second decision of a double, where the other two
   * half-moves are already spent and nothing follows this one.
   */
  async rankPlays(position, dice, { ort, midDoubles = false }) {
    const plays = legalPlays(position, dice);
    const batch = new PositionBatch();
    const groups = plays.map((play) => this.#leavesOf(play, dice, batch, midDoubles));

    const evaluated = batch.size > 0 ? await this.#forward(batch.tensors, ort) : null;

    return plays
      .map((play, i) => {
        const best = bestLeaf(groups[i], evaluated);
        return {
          moves: play.moves,
          position: play.position,
          key: play.key,
          equity: best.equity,
          probs: best.probs,
          continuation: best.leaf.continuation ?? null,
        };
      })
      .sort((a, b) => b.equity - a.equity);
  }

  /**
   * The turn-ending positions a decision can lead to.
   *
   * One leaf for an ordinary play. On a double that leaves us still on roll,
   * one leaf per way of playing the remaining two half-moves — the joint
   * scoring exp020 showed to be worth a third of the engine's margin.
   */
  #leavesOf(play, dice, batch, midDoubles) {
    const child = play.position;
    if (isTerminal(child)) return [terminalLeaf(child)];

    if (hasSecondDecision(child, dice, play, { midDoubles })) {
      return legalPlays(child, dice).map((continuation) =>
        isTerminal(continuation.position)
          ? { ...terminalLeaf(continuation.position), continuation }
          : { ...batch.add(swapPerspective(continuation.position)), continuation },
      );
    }
    return [batch.add(swapPerspective(child))];
  }
}

/** Collects the distinct positions a decision needs, so each is evaluated once. */
class PositionBatch {
  tensors = [];
  #rows = new Map();

  get size() {
    return this.tensors.length;
  }

  add(position) {
    const key = boardKey(position);
    let row = this.#rows.get(key);
    if (row === undefined) {
      row = this.tensors.length;
      this.#rows.set(key, row);
      this.tensors.push(encodePosition(position));
    }
    // Every batched leaf is a position with the opponent on roll, so its value
    // is worth the negative of what the network says.
    return { row, negate: true };
  }
}

function terminalLeaf(position) {
  const sign = position.myOff === CHECKERS ? 1 : -1;
  return { terminal: true, equity: sign * terminalPoints(position) };
}

/** Best leaf of a group, with its equity in money points and oriented probabilities. */
function bestLeaf(leaves, evaluated) {
  let best = null;
  for (const leaf of leaves) {
    const equity = leaf.terminal
      ? leaf.equity
      : (leaf.negate ? -1 : 1) * evaluated.equity[leaf.row] * 3;
    if (best === null || equity > best.equity) best = { leaf, equity };
  }
  const probs =
    best.leaf.terminal || !evaluated?.probs
      ? null
      : orientProbs(evaluated.probs, best.leaf.row, best.leaf.negate);
  return { ...best, probs };
}

/**
 * Six-outcome probabilities as the mover sees them.
 *
 * The head reports from the encoded position's own side, so when that side is
 * the opponent the wins and losses trade places.
 */
function orientProbs(flat, row, negate) {
  const base = row * 6;
  const p = Array.from({ length: 6 }, (_, i) => flat[base + i]);
  const ordered = negate ? [p[3], p[4], p[5], p[0], p[1], p[2]] : p;
  return Object.fromEntries(OUTCOMES.map((name, i) => [name, ordered[i]]));
}

/** Total win probability from a six-outcome split. */
export function winProbability(probs) {
  return probs.win + probs.winGammon + probs.winBackgammon;
}
