/**
 * The game loop's own rules: conservation, turn structure, and undo.
 *
 * No network here — a stub engine picks the first candidate, which is enough to
 * drive thousands of turns through the parts that have no other test: doubles
 * staging, passing the turn, bearing off, and taking a half-move back. The
 * legality of the moves themselves is covered against OpenSpiel in
 * movegen.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CHECKERS, boardKey, startingPosition, swapPerspective } from "../app/engine/board.js";
import { applyHalfMove, legalPlays, legalSequences } from "../app/engine/movegen.js";
import { Game } from "../app/ui/game.js";

/** Stands in for the network: ranks nothing, just returns the legal plays. */
const stubEngine = {
  async rank(position, dice) {
    return legalPlays(position, dice).map((play) => ({ ...play, equity: 0, continuation: null }));
  },
};

function assertConserved(position, where) {
  const mine = sum(position.my) + position.myBar + position.myOff;
  const theirs = sum(position.opp) + position.oppBar + position.oppOff;
  assert.equal(mine, CHECKERS, `${where}: mover has ${mine} checkers`);
  assert.equal(theirs, CHECKERS, `${where}: opponent has ${theirs} checkers`);
  assert.ok(position.my.every((n, i) => n >= 0 && position.opp[i] >= 0), `${where}: negative count`);
  assert.ok(
    position.my.every((n, i) => n === 0 || position.opp[i] <= 1),
    `${where}: both sides occupy a point`,
  );
}

const sum = (array) => array.reduce((total, n) => total + n, 0);

test("a full game plays out with checkers conserved throughout", async () => {
  for (let seed = 0; seed < 25; seed++) {
    const game = new Game({ engine: stubEngine, onChange: () => {} });
    let guard = 0;

    while (game.phase !== "gameover") {
      assert.ok(guard++ < 4000, "game did not finish");
      if (game.busy) {
        await game.busy;
        continue;
      }
      if (game.phase === "opening" || game.phase === "rolling") {
        game.roll();
        continue;
      }
      if (game.phase === "moving" && game.humanOnRoll) playRandomly(game);
      assertConserved(game.position, `phase ${game.phase}`);
    }

    assert.ok([1, 2, 3].includes(Math.abs(game.result.points)), `odd result ${game.result.points}`);
    assert.ok(
      game.position.myOff === CHECKERS || game.position.oppOff === CHECKERS,
      "game ended without anyone bearing off 15",
    );
  }
});

test("undo restores the position exactly", () => {
  const game = new Game({ engine: stubEngine, onChange: () => {} });
  let checked = 0;

  for (let attempt = 0; attempt < 200 && checked < 60; attempt++) {
    game.setPosition(startingPosition(), { dice: [1 + (attempt % 6), 1 + ((attempt * 3) % 6)] });

    const before = boardKey(game.position);
    const plays = legalSequences(game.position, game.dice);
    if (plays[0].moves.length === 0) continue;

    // Enter the first half-move of a legal order, then take it back.
    const move = plays[0].moves[0];
    game.select(move.from);
    game.select(move.to);
    if (game.pending.length === 0) continue; // the play completed in one click-pair
    game.undo();
    assert.equal(boardKey(game.position), before, "undo did not restore the board");
    checked++;
  }
  assert.ok(checked > 10, `only exercised ${checked} undos`);
});

test("a double gives the mover four half-moves, not two", async () => {
  const game = new Game({ engine: stubEngine, onChange: () => {} });
  game.setPosition(startingPosition(), { dice: [3, 3] });

  const before = pipCount(game.position);
  let spent = 0;
  while (game.humanOnRoll && game.phase === "moving" && spent < 4) {
    playOneHalfMove(game);
    spent++;
  }
  // Four 3s leave the mover 12 pips better off, and the turn then passes.
  assert.equal(before - pipCount(swapPerspective(game.position)), 12);
  assert.equal(game.humanOnRoll, false, "turn did not pass after four half-moves");
});

function pipCount(position) {
  let pips = position.myBar * 25;
  for (let i = 0; i < position.my.length; i++) pips += position.my[i] * (i + 1);
  return pips;
}

function playOneHalfMove(game) {
  const from = game.sources()[0];
  game.select(from);
  const to = game.destinations()[0];
  game.select(to);
}

function playRandomly(game) {
  let guard = 0;
  while (game.phase === "moving" && game.humanOnRoll && !game.busy) {
    assert.ok(guard++ < 8, "human decision never completed");
    const sources = game.sources();
    if (sources.length === 0) break;
    const from = sources[Math.floor(Math.random() * sources.length)];
    game.select(from);
    const destinations = game.destinations();
    game.select(destinations[Math.floor(Math.random() * destinations.length)]);
  }
}
