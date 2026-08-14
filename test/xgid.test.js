/**
 * XGID parsing, pinned to positions whose contents are known independently.
 *
 * The second case comes with a tensor audit from the raccoon repo
 * (docs/bagai/audit_XGID_…txt) that states the pip counts and bar counts for
 * the same ID, so it checks the orientation of the parse — the part that is
 * easy to get backwards and impossible to notice by eye.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { myPips, oppPips, startingPosition, boardKey } from "../app/engine/board.js";
import { formatXgid, parseXgid } from "../app/engine/xgid.js";

const START = "XGID=-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10";
const AUDITED = "XGID=-aaBBbBB-----D------AbbcdB:0:0:1:00:0:0:3:0:10";

test("the opening position round-trips", () => {
  const { position, dice } = parseXgid(START);
  assert.equal(boardKey(position), boardKey(startingPosition()));
  assert.equal(dice, null);
  assert.equal(myPips(position), 167);
  assert.equal(oppPips(position), 167);
  assert.equal(formatXgid(position), START);
});

test("an audited position parses with the documented pips and bar", () => {
  // From the audit dump: My Pips 162, Opp Pips 111, My Bar 2, Opp Bar 0,
  // and the mover has three home points made.
  const { position, matchLength } = parseXgid(AUDITED);
  assert.equal(myPips(position), 162);
  assert.equal(oppPips(position), 111);
  assert.equal(position.myBar, 2);
  assert.equal(position.oppBar, 0);
  assert.equal(matchLength, 3);

  const homePointsMade = [0, 1, 2, 3, 4, 5].filter((i) => position.my[i] >= 2).length;
  assert.equal(homePointsMade, 3);
});

test("turn = -1 hands back the other side, mirrored", () => {
  const upper = parseXgid(AUDITED).position;
  const lower = parseXgid(AUDITED.replace(":1:00:", ":-1:00:")).position;

  assert.equal(myPips(lower), oppPips(upper));
  assert.equal(oppPips(lower), myPips(upper));
  assert.equal(lower.oppBar, upper.myBar);
});

test("dice are read and written", () => {
  const { dice } = parseXgid(START.replace(":00:", ":52:"));
  assert.deepEqual(dice, [5, 2]);
  assert.match(formatXgid(startingPosition(), { dice: [2, 5] }), /:52:/);
});

test("a malformed board is rejected rather than half-read", () => {
  assert.throws(() => parseXgid("XGID=-b----E-C---eE:0:0:1:00:0:0:0:0:10"), /26 board characters/);
  assert.throws(() => parseXgid(START.replace("-b--", "-z--")), /not a checker count/);
});
