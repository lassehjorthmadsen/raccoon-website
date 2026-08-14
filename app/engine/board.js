/**
 * Board representation for the browser engine.
 *
 * A Position is always seen from the player on roll ("me"). Indices follow the
 * Python BoardView (raccoon/env/game_wrapper.py) exactly, because the network
 * was trained on tensors built from it:
 *
 *   - index i holds what the mover calls point i+1;
 *   - the mover travels 23 -> 0 and bears off past index 0;
 *   - the opponent travels 0 -> 23 and bears off past index 23;
 *   - a checker entering from the bar lands on index 24-die for the mover,
 *     and on index die-1 for the opponent.
 *
 * Both arrays are in the mover's numbering: opp[i] is the opponent's checkers
 * on the mover's point i+1. Changing sides therefore costs an index reversal as
 * well as a label swap — see swapPerspective, and the same lesson recorded in
 * raccoon/train/lookahead.py's encode_pre_roll.
 */

export const POINTS = 24;
export const CHECKERS = 15;
export const BAR = -1; // sentinel "from" for a checker entering off the bar
export const OFF = -2; // sentinel "to" for a checker borne off

/** Create a position; arrays are copied, so callers keep no aliases. */
export function createPosition({ my, opp, myBar = 0, oppBar = 0, myOff = 0, oppOff = 0 }) {
  return {
    my: Int8Array.from(my),
    opp: Int8Array.from(opp),
    myBar,
    oppBar,
    myOff,
    oppOff,
  };
}

export function clonePosition(p) {
  return {
    my: Int8Array.from(p.my),
    opp: Int8Array.from(p.opp),
    myBar: p.myBar,
    oppBar: p.oppBar,
    myOff: p.myOff,
    oppOff: p.oppOff,
  };
}

/** The opening position, from the player on roll. */
export function startingPosition() {
  const my = new Int8Array(POINTS);
  const opp = new Int8Array(POINTS);
  my[5] = 5; my[7] = 3; my[12] = 5; my[23] = 2;
  opp[0] = 2; opp[11] = 5; opp[16] = 3; opp[18] = 5;
  return createPosition({ my, opp });
}

/**
 * The same position seen by the other player.
 *
 * Used before evaluating a child position: the network always scores the board
 * from the side on roll, and the caller negates the result (the rule
 * child_values() follows in raccoon/train/lookahead.py).
 */
export function swapPerspective(p) {
  const my = new Int8Array(POINTS);
  const opp = new Int8Array(POINTS);
  for (let i = 0; i < POINTS; i++) {
    my[i] = p.opp[POINTS - 1 - i];
    opp[i] = p.my[POINTS - 1 - i];
  }
  return { my, opp, myBar: p.oppBar, oppBar: p.myBar, myOff: p.oppOff, oppOff: p.myOff };
}

/**
 * Canonical string for a position.
 *
 * Byte-for-byte the format scripts/export_web_fixtures.py writes
 * ("my24|opp24|my_bar,opp_bar|my_off,opp_off"), so the differential tests
 * compare sets of positions rather than sets of move encodings — OpenSpiel's
 * 1352 action indices are deliberately not ported.
 */
export function boardKey(p) {
  return `${p.my.join(",")}|${p.opp.join(",")}|${p.myBar},${p.oppBar}|${p.myOff},${p.oppOff}`;
}

/** Pip count for the mover (bar checkers owe a full 25). */
export function myPips(p) {
  let pips = p.myBar * 25;
  for (let i = 0; i < POINTS; i++) pips += p.my[i] * (i + 1);
  return pips;
}

/** Pip count for the opponent, who travels the other way. */
export function oppPips(p) {
  let pips = p.oppBar * 25;
  for (let i = 0; i < POINTS; i++) pips += p.opp[i] * (POINTS - i);
  return pips;
}

/** True once every mover checker is home (indices 0-5) and none is on the bar. */
export function canBearOff(p) {
  if (p.myBar > 0) return false;
  for (let i = 6; i < POINTS; i++) if (p.my[i] > 0) return false;
  return true;
}

export function isTerminal(p) {
  return p.myOff === CHECKERS || p.oppOff === CHECKERS;
}

/**
 * Points won by the side that has borne off all 15, cubeless: 1, 2 (gammon) or
 * 3 (backgammon). Returns 0 while the game is unfinished.
 */
export function terminalPoints(p) {
  if (p.myOff === CHECKERS) return gameValue(p.oppOff, p.oppBar, p.opp, true);
  if (p.oppOff === CHECKERS) return gameValue(p.myOff, p.myBar, p.my, false);
  return 0;
}

function gameValue(loserOff, loserBar, loserPoints, loserIsOpponent) {
  if (loserOff > 0) return 1;
  // Backgammon: the loser still has a checker on the bar or in the winner's
  // home board. The winner's home is indices 0-5 for the mover, 18-23 for the
  // opponent, both counted in the mover's numbering.
  if (loserBar > 0) return 3;
  const from = loserIsOpponent ? 0 : 18;
  for (let i = from; i < from + 6; i++) if (loserPoints[i] > 0) return 3;
  return 2;
}
