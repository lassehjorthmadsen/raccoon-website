/**
 * The game loop: dice, turns, and validating what the human clicks.
 *
 * Legality is never re-derived here. Every click is matched against the list of
 * legal half-move orders from the engine's own generator (legalSequences), so
 * the board can only ever reach positions OpenSpiel agrees are reachable — the
 * same generator the differential tests pin to OpenSpiel exactly.
 *
 * The position is always held from the side on roll, which is what the network
 * expects; the view flips it when the engine is thinking so the human's
 * checkers stay at the bottom.
 */

import {
  CHECKERS, isTerminal, startingPosition, swapPerspective, terminalPoints,
} from "../engine/board.js";
import { applyHalfMove, hasSecondDecision, legalSequences } from "../engine/movegen.js";

const sameMove = (a, b) => a.from === b.from && a.to === b.to && a.die === b.die;

export class Game {
  #onChange;
  #engine;

  /**
   * `autoplay` is what separates the two pages: playing against the engine, or
   * analysing. With it off nobody moves on their own — the human plays both
   * sides and the board turns round to whoever is on roll, which is how an
   * analyser is expected to behave.
   */
  constructor({ engine, onChange, autoplay = true }) {
    this.#engine = engine;
    this.#onChange = onChange;
    this.autoplay = autoplay;
    this.newGame();
  }

  /** Rank the current decision without playing it — the "hint" button. */
  async analyse() {
    if (!this.dice || this.phase === "gameover") return null;
    this.analysis = await this.#engine.rank(this.decisionStart, this.dice, this.midDoubles);
    this.analysisFor = "human";
    this.#changed();
    return this.analysis;
  }

  newGame() {
    this.position = startingPosition();
    this.humanOnRoll = true;
    this.dice = null;
    this.midDoubles = false;
    this.pending = [];
    this.selected = null;
    this.phase = "opening";
    this.result = null;
    this.log = [];
    this.analysis = null;
    this.#changed();
  }

  /**
   * Start from an arbitrary position — how the analyser loads an XGID, and the
   * only supported way to put the board into a specific state.
   *
   * With `dice` the mover is on a decision immediately; without them the board
   * waits for a roll.
   */
  setPosition(position, { dice = null, humanOnRoll = true, midDoubles = false } = {}) {
    this.position = position;
    this.humanOnRoll = humanOnRoll;
    this.dice = dice;
    this.midDoubles = midDoubles;
    this.result = null;
    this.log = [];
    this.analysis = null;
    this.phase = dice ? "moving" : "rolling";

    if (dice) {
      this.#beginDecision();
      return;
    }
    this.decisionStart = position;
    this.pending = [];
    this.selected = null;
    this.#changed();
  }

  /** The board as the human sees it — their own checkers always at the bottom. */
  humanView() {
    return this.humanOnRoll ? this.position : swapPerspective(this.position);
  }

  /**
   * Opening roll: re-rolled until the dice differ, higher die moves first.
   * The starting position is symmetric, so whoever wins it can be handed the
   * board as-is.
   */
  rollOpening() {
    let a = die();
    let b = die();
    while (a === b) {
      a = die();
      b = die();
    }
    this.humanOnRoll = a > b;
    this.dice = [Math.max(a, b), Math.min(a, b)];
    this.phase = "moving";
    this.#beginDecision();
  }

  roll() {
    if (this.phase === "opening") return this.rollOpening();
    this.dice = [die(), die()];
    this.phase = "moving";
    this.#beginDecision();
  }

  /**
   * Legal orders that still match what the human has entered so far.
   *
   * Enumerated from the position as it stood when the dice were rolled, not the
   * half-played one on screen: the pending moves are a prefix of those orders,
   * and re-deriving from the current board would spend the dice twice.
   */
  #survivors() {
    if (!this.dice || !this.decisionStart) return [];
    return legalSequences(this.decisionStart, this.dice).filter((play) =>
      this.pending.every((move, i) => play.moves[i] && sameMove(play.moves[i], move)),
    );
  }

  /** Points the human may pick a checker up from right now. */
  sources() {
    const step = this.pending.length;
    return [...new Set(this.#survivors().map((play) => play.moves[step]?.from).filter((f) => f !== undefined))];
  }

  /** Where the selected checker may go. */
  destinations() {
    if (this.selected === null) return [];
    const step = this.pending.length;
    return [
      ...new Set(
        this.#survivors()
          .map((play) => play.moves[step])
          .filter((move) => move && move.from === this.selected)
          .map((move) => move.to),
      ),
    ];
  }

  /** A click on a point, the bar, or the tray. */
  select(target) {
    if (this.phase !== "moving" || !this.humanOnRoll) return;

    if (this.selected === null) {
      if (this.sources().includes(target)) {
        this.selected = target;
        this.#changed();
      }
      return;
    }
    if (target === this.selected) {
      this.selected = null;
      this.#changed();
      return;
    }

    const step = this.pending.length;
    const move = this.#survivors()
      .map((play) => play.moves[step])
      .find((m) => m && m.from === this.selected && m.to === target);

    if (!move) {
      // Not a destination — treat it as picking a different checker up.
      this.selected = this.sources().includes(target) ? target : null;
      this.#changed();
      return;
    }

    this.position = applyHalfMove(this.position, move);
    this.pending.push(move);
    this.selected = null;
    this.#afterHalfMove();
  }

  /** Take back the half-moves entered since the dice were rolled. */
  undo() {
    if (this.phase !== "moving" || !this.humanOnRoll || this.pending.length === 0) return;
    this.position = this.decisionStart;
    this.pending = [];
    this.selected = null;
    this.#changed();
  }

  #beginDecision() {
    this.decisionStart = this.position;
    this.pending = [];
    this.selected = null;
    this.analysis = null;
    this.analysisFor = null;

    const plays = legalSequences(this.position, this.dice);
    if (plays.length === 1 && plays[0].moves.length === 0) {
      this.log.push({ side: this.humanOnRoll ? "human" : "engine", dice: this.dice, moves: [] });
      this.#endDecision([]);
      return;
    }
    this.#changed();
    if (!this.humanOnRoll) this.#engineTurn();
  }

  #afterHalfMove() {
    const complete = this.#survivors().some((play) => play.moves.length === this.pending.length);
    if (!complete) {
      this.#changed();
      return;
    }
    this.log.push({ side: "human", dice: this.dice, moves: [...this.pending] });
    this.#endDecision(this.pending);
  }

  /** Finish a decision: either the other half of a double, or the other player. */
  #endDecision(moves) {
    if (isTerminal(this.position)) return this.#finish();

    if (hasSecondDecision(this.position, this.dice, { moves }, { midDoubles: this.midDoubles })) {
      this.midDoubles = true;
      this.#beginDecision();
      return;
    }

    this.position = swapPerspective(this.position);
    if (this.autoplay) this.humanOnRoll = !this.humanOnRoll;
    this.dice = null;
    this.midDoubles = false;
    this.pending = [];
    this.decisionStart = this.position;
    this.phase = "rolling";
    this.#changed();
    if (!this.humanOnRoll) this.#engineRoll();
  }

  #engineRoll() {
    this.dice = [die(), die()];
    this.phase = "moving";
    this.#beginDecision();
  }

  /**
   * Think, then play. `busy` is the promise for the current engine turn, so
   * tests (and any caller that needs to wait) can settle the board without
   * polling; the UI just re-renders when #changed fires.
   */
  #engineTurn() {
    this.busy = this.#playEngineTurn().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  async #playEngineTurn() {
    this.phase = "thinking";
    this.#changed();

    const ranked = await this.#engine.rank(this.position, this.dice, this.midDoubles);
    this.analysis = ranked;
    this.analysisFor = "engine";

    const best = ranked[0];
    for (const move of best.moves) this.position = applyHalfMove(this.position, move);
    this.log.push({ side: "engine", dice: this.dice, moves: best.moves, equity: best.equity });

    // On a double the engine's choice was scored by a specific continuation;
    // play that, rather than re-deciding and risking a different tie-break.
    if (best.continuation && !isTerminal(this.position)) {
      for (const move of best.continuation.moves) this.position = applyHalfMove(this.position, move);
      this.log.push({ side: "engine", dice: this.dice, moves: best.continuation.moves, continuation: true });
      this.midDoubles = true;
      this.phase = "moving";
      this.#endDecision(best.continuation.moves);
      return;
    }

    this.phase = "moving";
    this.#endDecision(best.moves);
  }

  #finish() {
    const points = terminalPoints(this.position);
    const moverWon = this.position.myOff === CHECKERS;
    const humanIsMover = this.humanOnRoll;
    this.result = {
      points: (moverWon === humanIsMover ? 1 : -1) * points,
      kind: points === 3 ? "backgammon" : points === 2 ? "gammon" : "single",
    };
    this.phase = "gameover";
    this.dice = null;
    this.#changed();
  }

  #changed() {
    this.#onChange(this);
  }
}

function die() {
  return 1 + Math.floor(Math.random() * 6);
}
