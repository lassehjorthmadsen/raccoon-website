/**
 * Differential test: every legal play, against OpenSpiel's own answer.
 *
 * The fixtures come from scripts/export_web_fixtures.py in the raccoon repo and
 * are stratified over the cases a hand-written generator gets wrong — bar
 * entry, bear-off, doubles, and the second half of a doubles turn. Comparison
 * is on the SET of resulting positions, which is the only thing a 0-ply engine
 * can act on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { legalPlays } from "../app/engine/movegen.js";
import { loadFixture, positionOf } from "./fixtures.js";

const { cases, meta } = loadFixture("movegen.json.gz");

test("fixtures cover every awkward case", () => {
  const buckets = new Set(cases.map((c) => c.bucket));
  for (const wanted of ["bar", "bearoff", "doubles", "middoubles", "plain"]) {
    assert.ok(buckets.has(wanted), `no ${wanted} cases in the fixture`);
  }
  assert.ok(cases.length >= 1000, `only ${cases.length} cases`);
});

test("legalPlays reproduces OpenSpiel exactly", () => {
  const failures = [];
  const seen = {};

  for (const [index, testCase] of cases.entries()) {
    seen[testCase.bucket] = (seen[testCase.bucket] ?? 0) + 1;
    const got = legalPlays(positionOf(testCase.board), testCase.dice)
      .map((play) => play.key)
      .sort();
    const want = [...testCase.children].sort();

    if (got.length !== want.length || got.some((key, i) => key !== want[i])) {
      failures.push({ index, testCase, got, want });
    }
  }

  assert.equal(
    failures.length,
    0,
    failures.length === 0 ? "" : describe(failures[0], failures.length, seen),
  );
});

function describe(failure, total, seen) {
  const { index, testCase, got, want } = failure;
  const missing = want.filter((key) => !got.includes(key));
  const extra = got.filter((key) => !want.includes(key));
  return [
    `${total} of ${cases.length} positions disagree with OpenSpiel`,
    `(counts by bucket: ${JSON.stringify(seen)}, fixture seed ${meta.seed})`,
    ``,
    `first failure: case ${index}, bucket ${testCase.bucket}, dice ${testCase.dice}` +
      `${testCase.mid_doubles ? " (mid-doubles)" : ""}`,
    `  my  : ${testCase.board.my.join(",")}  bar ${testCase.board.my_bar} off ${testCase.board.my_off}`,
    `  opp : ${testCase.board.opp.join(",")}  bar ${testCase.board.opp_bar} off ${testCase.board.opp_off}`,
    `  we generated ${got.length} plays, OpenSpiel found ${want.length}`,
    missing.length ? `  missing ${missing.length}, e.g. ${missing[0]}` : `  missing none`,
    extra.length ? `  spurious ${extra.length}, e.g. ${extra[0]}` : `  spurious none`,
  ].join("\n");
}
