/**
 * The JS encoder against tensors produced by raccoon/env/encoder.py.
 *
 * Every channel matters: the network was trained on this exact layout, so a
 * transposed row or an unscaled feature is silent strength loss rather than a
 * visible crash. Fixtures cover each position twice — as played (dice and
 * mid-doubles planes live) and pre-roll, which is what the value head sees.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { encodePosition, TENSOR_SIZE } from "../app/engine/encoder.js";
import { loadFixture, positionOf } from "./fixtures.js";

const { cases, meta } = loadFixture("encoder.json.gz");
const TOLERANCE = 1e-6; // the fixture stores 7 decimals

test("encoder fixture is the shape we expect", () => {
  assert.deepEqual(meta.shape, [26, 2, 12]);
  assert.equal(cases[0].tensor.length, TENSOR_SIZE);
  assert.ok(cases.some((c) => c.dice === null), "no pre-roll cases in the fixture");
  assert.ok(cases.some((c) => c.dice !== null), "no with-dice cases in the fixture");
});

test("encodePosition matches the Python encoder channel for channel", () => {
  let worst = { diff: 0 };

  for (const [index, testCase] of cases.entries()) {
    const got = encodePosition(positionOf(testCase.board), {
      dice: testCase.dice,
      midDoubles: testCase.mid_doubles,
    });
    for (let i = 0; i < TENSOR_SIZE; i++) {
      const diff = Math.abs(got[i] - testCase.tensor[i]);
      if (diff > worst.diff) {
        worst = { diff, index, at: i, channel: Math.floor(i / 24), got: got[i], want: testCase.tensor[i] };
      }
    }
  }

  assert.ok(
    worst.diff <= TOLERANCE,
    `max |js - python| = ${worst.diff} at case ${worst.index}, channel ${worst.channel} ` +
      `(js ${worst.got} vs python ${worst.want})`,
  );
});
