/**
 * Port of raccoon/env/encoder.py -> the (26, 2, 12) tensor the network reads.
 *
 * Channel order, normalisation divisors and the handcrafted features are copied
 * from the Python encoder rather than reinvented: the weights were trained
 * against that exact layout, so any drift here is silent strength loss. The
 * fixtures in test/encoder.test.js compare this file's output against tensors
 * produced by the Python encoder itself.
 *
 * Layout: channel-major, two rows of twelve columns.
 *   row 0, col c  <- the mover's point 13+c
 *   row 1, col c  <- the mover's point 12-c
 */

import { POINTS } from "./board.js";

export const NUM_CHANNELS = 26;
export const BOARD_H = 2;
export const BOARD_W = 12;
export const PLANE = BOARD_H * BOARD_W;
export const TENSOR_SIZE = NUM_CHANNELS * PLANE;

/** Divisors that pull the handcrafted channels into the base planes' ~[0,1] range. */
const FEATURE_SCALES = new Map([
  [17, 167], [18, 167], [19, 1], [20, 15], [21, 15],
  [22, 6], [23, 6], [24, 167], [25, 167],
]);

/** (row, col) for a point index, as offsets into a plane. */
function cellOf(pointIndex) {
  return pointIndex >= 12 ? pointIndex - 12 : BOARD_W + (11 - pointIndex);
}

function fillCheckerPlanes(out, points, channelOffset) {
  for (let pt = 0; pt < POINTS; pt++) {
    const count = points[pt];
    if (count === 0) continue;
    const cell = cellOf(pt);
    if (count >= 1) out[channelOffset * PLANE + cell] = 1;
    if (count >= 2) out[(channelOffset + 1) * PLANE + cell] = 1;
    if (count >= 3) out[(channelOffset + 2) * PLANE + cell] = 1;
    if (count > 3) out[(channelOffset + 3) * PLANE + cell] = (count - 3) / 2;
  }
}

function broadcast(out, channel, value) {
  out.fill(value, channel * PLANE, (channel + 1) * PLANE);
}

/**
 * Encode a position.
 *
 * `dice` is null for a pre-roll position — which is what the value head always
 * sees, since move selection ranks the positions moves lead to, not the roll
 * that produced them.
 */
export function encodePosition(pos, { dice = null, midDoubles = false } = {}) {
  const out = new Float32Array(TENSOR_SIZE);

  fillCheckerPlanes(out, pos.my, 0);
  fillCheckerPlanes(out, pos.opp, 4);

  broadcast(out, 8, 1); // side to move
  broadcast(out, 9, pos.myBar / 15);
  broadcast(out, 10, pos.oppBar / 15);
  broadcast(out, 11, pos.myOff / 15);
  broadcast(out, 12, pos.oppOff / 15);

  if (dice) {
    broadcast(out, 13, dice[0] / 6);
    broadcast(out, 14, dice[1] / 6);
    broadcast(out, 15, dice[0] === dice[1] ? 1 : 0);
  }
  if (midDoubles) broadcast(out, 16, 1);

  // --- handcrafted features, raw here and scaled at the end ---
  let myPip = pos.myBar * 25;
  let oppPip = pos.oppBar * 25;
  let myBlots = 0;
  let oppBlots = 0;
  let myAnchors = 0;
  let oppAnchors = 0;
  let firstOpp = -1;
  let lastMy = -1;
  for (let i = 0; i < POINTS; i++) {
    myPip += pos.my[i] * (i + 1);
    oppPip += pos.opp[i] * (POINTS - i);
    if (pos.my[i] === 1) myBlots++;
    if (pos.opp[i] === 1) oppBlots++;
    if (i >= 18 && pos.my[i] >= 2) myAnchors++;
    if (i < 6 && pos.opp[i] >= 2) oppAnchors++;
    if (pos.opp[i] > 0 && firstOpp === -1) firstOpp = i;
    if (pos.my[i] > 0) lastMy = i;
  }

  broadcast(out, 17, myPip);
  broadcast(out, 18, oppPip);
  const pipTotal = myPip + oppPip;
  broadcast(out, 19, pipTotal > 0 ? myPip / pipTotal : 0.5);
  broadcast(out, 20, myBlots);
  broadcast(out, 21, oppBlots);
  broadcast(out, 22, myAnchors);
  broadcast(out, 23, oppAnchors);

  // Contact pressure: pips still needed before the two sides can no longer
  // touch. Bar checkers re-enter in the far home board, which is why they use
  // the opposite end of the range.
  const haveOpp = firstOpp !== -1 || pos.oppBar > 0;
  const haveMy = lastMy !== -1 || pos.myBar > 0;
  let myContact = 0;
  let oppContact = 0;
  if (haveOpp && haveMy) {
    const minOpp = pos.oppBar > 0 ? 0 : firstOpp;
    const maxMy = pos.myBar > 0 ? POINTS - 1 : lastMy;
    for (let i = 0; i < POINTS; i++) {
      myContact += pos.my[i] * Math.max(0, i - minOpp + 1);
      oppContact += pos.opp[i] * Math.max(0, maxMy - i + 1);
    }
    myContact += pos.myBar * (25 - minOpp);
    oppContact += pos.oppBar * (maxMy + 2);
  }
  broadcast(out, 24, myContact);
  broadcast(out, 25, oppContact);

  for (const [channel, scale] of FEATURE_SCALES) {
    if (scale === 1) continue;
    for (let i = channel * PLANE; i < (channel + 1) * PLANE; i++) out[i] /= scale;
  }
  return out;
}
