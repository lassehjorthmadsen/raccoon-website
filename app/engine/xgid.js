/**
 * XGID import and export — the position format XG, GNU Backgammon and
 * Backgammon Galaxy all speak.
 *
 *   XGID=-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10
 *         └ 26 board characters ──┘ │ │ │ │  │ │ │ │ └ max cube (log2)
 *                                   │ │ │ │  │ │ │ └ Crawford / Jacoby
 *                                   │ │ │ │  │ │ └ match length, 0 = money
 *                                   │ │ │ │  └─┴ scores
 *                                   │ │ │ └ dice, "00" when none
 *                                   │ │ └ turn: 1 = uppercase on roll
 *                                   │ └ cube owner
 *                                   └ cube value (log2)
 *
 * Board characters: index 1-24 are points numbered from the UPPERCASE player's
 * home, index 0 is the lowercase player's bar and index 25 the uppercase
 * player's bar. Letters give the count, a-o for lowercase, A-O for uppercase.
 *
 * The cube fields are parsed and handed back untouched. This engine is
 * cubeless, and pretending otherwise in the UI would be a lie about what the
 * network can do.
 */

import { CHECKERS, POINTS, createPosition } from "./board.js";

const LETTERS = "abcdefghijklmno";

function countOf(character) {
  if (character === "-") return { count: 0, upper: false };
  const upper = character === character.toUpperCase();
  const index = LETTERS.indexOf(character.toLowerCase());
  if (index < 0) throw new Error(`not a checker count: ${character}`);
  return { count: index + 1, upper };
}

function letterFor(count, upper) {
  if (count <= 0) return "-";
  if (count > CHECKERS) throw new Error(`impossible checker count: ${count}`);
  const letter = LETTERS[count - 1];
  return upper ? letter.toUpperCase() : letter;
}

/**
 * Parse an XGID into a position from the mover's side, plus the fields this
 * engine does not act on.
 *
 * Returns `{ position, dice, cube, matchLength, scores, turn }`.
 */
export function parseXgid(text) {
  const body = String(text).trim().replace(/^XGID=/i, "");
  const fields = body.split(":");
  const board = fields[0];
  if (board.length !== 26) {
    throw new Error(`expected 26 board characters, got ${board.length}`);
  }

  const cubeValue = 2 ** Number(fields[1] ?? 0);
  const cubeOwner = Number(fields[2] ?? 0);
  const turn = Number(fields[3] ?? 1);
  const diceField = fields[4] ?? "00";
  const scores = [Number(fields[5] ?? 0), Number(fields[6] ?? 0)];
  const matchLength = Number(fields[7] ?? 0);

  // With turn = 1 the uppercase side is on roll and the indices already run
  // from its home; with turn = -1 the mover is the lowercase side, whose points
  // are numbered the other way round.
  const upperOnRoll = turn >= 0;
  const my = new Int8Array(POINTS);
  const opp = new Int8Array(POINTS);

  for (let i = 0; i < POINTS; i++) {
    const boardIndex = upperOnRoll ? i + 1 : POINTS - i;
    const { count, upper } = countOf(board[boardIndex]);
    if (count === 0) continue;
    if (upper === upperOnRoll) my[i] = count;
    else opp[i] = count;
  }

  const myBar = countOf(board[upperOnRoll ? 25 : 0]).count;
  const oppBar = countOf(board[upperOnRoll ? 0 : 25]).count;

  const position = createPosition({
    my,
    opp,
    myBar,
    oppBar,
    myOff: CHECKERS - total(my) - myBar,
    oppOff: CHECKERS - total(opp) - oppBar,
  });

  const dice = /^[1-6][1-6]$/.test(diceField)
    ? [Number(diceField[0]), Number(diceField[1])]
    : null;

  return {
    position,
    dice,
    turn,
    scores,
    matchLength,
    cube: { value: cubeValue, owner: cubeOwner },
  };
}

/**
 * Format a position as an XGID, with the mover as the uppercase side.
 *
 * Cube fields are written as centred and 1, and the match length as 0 (money):
 * that is what this engine actually reasons about.
 */
export function formatXgid(position, { dice = null } = {}) {
  const characters = new Array(26).fill("-");
  characters[0] = letterFor(position.oppBar, false);
  characters[25] = letterFor(position.myBar, true);

  for (let i = 0; i < POINTS; i++) {
    if (position.my[i] > 0 && position.opp[i] > 0) {
      throw new Error(`both sides on point ${i + 1}`);
    }
    if (position.my[i] > 0) characters[i + 1] = letterFor(position.my[i], true);
    else if (position.opp[i] > 0) characters[i + 1] = letterFor(position.opp[i], false);
  }

  const diceField = dice ? `${Math.max(...dice)}${Math.min(...dice)}` : "00";
  return `XGID=${characters.join("")}:0:0:1:${diceField}:0:0:0:0:10`;
}

const total = (counts) => counts.reduce((sum, n) => sum + n, 0);
