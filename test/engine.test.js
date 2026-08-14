/**
 * End-to-end: does the browser engine play the same backgammon as the Python one?
 *
 * The fixtures are 1,000 decisions taken by raccoon/train/lookahead.py with the
 * weights this site ships, recorded with the equity it gave every candidate.
 * Agreement here is what lets the site quote the benchmark PR of the network as
 * the strength of the thing visitors actually play against.
 *
 * The test asserts equity, not move identity. Ties are common and legitimate —
 * especially on doubles, where joint scoring gives every first half that shares
 * a best continuation exactly the same value — and the two implementations
 * break them differently (Python takes the lowest action index, this engine the
 * first position by board key). Playing a *worse* move is the failure that
 * matters, so that is what fails the test; the exact-match rate rides along as
 * a diagnostic.
 *
 * Needs onnxruntime-node and the exported model; skips (loudly) without them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Evaluator } from "../app/engine/evaluator.js";
import { Game } from "../app/ui/game.js";
import { loadFixture, positionOf } from "./fixtures.js";

const MODEL = fileURLToPath(new URL("../app/models/exp018-ep22-fp32.onnx", import.meta.url));
const EQUITY_TOLERANCE = 1e-3; // money points; fp32 ONNX vs torch measured at 3.6e-7
const LOSS_TOLERANCE = 1e-5; // equity/3, the fixture's own precision

const ort = await importOrt();

test("engine agrees with the Python engine on recorded decisions", { skip: skipReason() }, async () => {
  const { cases } = loadFixture("engine.json.gz");
  const evaluator = await Evaluator.create({
    ort, modelUrl: MODEL, meta: {}, executionProviders: ["cpu"],
  });

  let sameMove = 0;
  let worstEquity = 0;
  let worstLoss = { loss: 0 };

  for (const testCase of cases) {
    const ranked = await evaluator.rankPlays(positionOf(testCase.board), testCase.dice, {
      ort, midDoubles: testCase.mid_doubles,
    });

    for (const candidate of ranked) {
      const expected = testCase.children[candidate.key];
      assert.notEqual(expected, undefined, `candidate absent from the fixture: ${candidate.key}`);
      worstEquity = Math.max(worstEquity, Math.abs(candidate.equity / 3 - expected));
    }
    const missing = Object.keys(testCase.children).filter(
      (key) => !ranked.some((candidate) => candidate.key === key),
    );
    assert.equal(missing.length, 0, `missed ${missing.length} legal plays, e.g. ${missing[0]}`);

    // What we gave up by choosing our move instead of the Python engine's.
    const loss = testCase.children[testCase.best_child] - testCase.children[ranked[0].key];
    if (ranked[0].key === testCase.best_child) sameMove++;
    else if (loss > worstLoss.loss) worstLoss = { loss, testCase, chose: ranked[0].key };
  }

  assert.ok(
    worstEquity <= EQUITY_TOLERANCE,
    `worst per-candidate equity disagreement ${worstEquity} > ${EQUITY_TOLERANCE}`,
  );
  assert.ok(
    worstLoss.loss <= LOSS_TOLERANCE,
    `played a worse move than the Python engine: gave up ${worstLoss.loss} ` +
      `on dice ${worstLoss.testCase?.dice}${worstLoss.testCase?.mid_doubles ? " (mid-doubles)" : ""}; ` +
      `chose ${worstLoss.chose}, python chose ${worstLoss.testCase?.best_child}`,
  );

  console.log(
    `      ${cases.length} decisions: identical move in ${sameMove}, ` +
      `equally-valued alternative in ${cases.length - sameMove}, worse move in none. ` +
      `Worst candidate equity difference ${worstEquity.toExponential(1)} points.`,
  );
});

test("the network plays complete games through the game loop", { skip: skipReason() }, async () => {
  const evaluator = await Evaluator.create({
    ort, modelUrl: MODEL, meta: {}, executionProviders: ["cpu"],
  });
  const engine = {
    rank: (position, dice, midDoubles) => evaluator.rankPlays(position, dice, { ort, midDoubles }),
  };

  // Both sides played by the network: every decision goes through the same
  // path the browser uses — legal move generation, encoding, the forward pass,
  // and the turn structure — with no human in the loop to paper over a stall.
  const game = new Game({ engine, onChange: () => {}, autoplay: true });
  const started = Date.now();
  let decisions = 0;

  while (game.phase !== "gameover") {
    assert.ok(Date.now() - started < 120000, "a self-play game did not finish in 2 minutes");
    if (game.busy) {
      await game.busy;
      continue;
    }
    if (game.phase === "opening" || game.phase === "rolling") {
      game.roll();
      continue;
    }
    if (game.humanOnRoll && game.phase === "moving") {
      // Stand in for the human with the engine's own choice.
      const ranked = await engine.rank(game.decisionStart, game.dice, game.midDoubles);
      for (const move of ranked[0].moves) {
        game.select(move.from);
        game.select(move.to);
      }
      decisions++;
    }
  }

  assert.ok(decisions > 5, `only ${decisions} human-side decisions were played`);
  assert.ok([1, 2, 3].includes(Math.abs(game.result.points)), `odd result ${game.result.points}`);
  console.log(
    `      self-play game finished ${game.result.points > 0 ? "for" : "against"} the ` +
      `clicking side by ${Math.abs(game.result.points)} (${game.result.kind}), ` +
      `${game.log.length} turns.`,
  );
});

async function importOrt() {
  try {
    return await import("onnxruntime-node");
  } catch {
    return null;
  }
}

function skipReason() {
  if (!ort) return "onnxruntime-node is not installed (npm install)";
  if (!existsSync(MODEL)) return "run scripts/export_web_model.py in the raccoon repo first";
  return false;
}
