/**
 * The board: an SVG drawn from a position, plus click targets.
 *
 * The position handed in is always from the human's side — the caller flips it
 * when the engine is on roll — so the board never spins around mid-game. Human
 * checkers sit at the bottom and travel anticlockwise towards the bottom-right
 * home board, which is the orientation every backgammon program uses.
 *
 * Rendering is a full redraw per move. At 30 checkers and 24 points that costs
 * nothing, and it keeps the drawing a pure function of the position.
 */

import { BAR, OFF, POINTS, myPips, oppPips } from "../engine/board.js";

// A point is exactly five checker diameters long and the dice sit in the clear
// band between the tips — the proportions every physical board and every serious
// program (XG, GNU Backgammon) uses. Earlier numbers here squeezed five checkers
// into 240 units, so every checker in a stack sat 6 units under the one below and
// the dice were drawn over the fifth checker of a point.
const VIEW_W = 1012;
const VIEW_H = 664;
const MARGIN_X = 16;
const MARGIN_Y = 30; // deep enough that the point numbers fit on the frame
const POINT_W = 68;
const CHECKER_R = 26;
const STACK_STEP = 2 * CHECKER_R;
const POINT_H = 5 * STACK_STEP + 4; // the +4 is the gap under the first checker
const CHECKER_RIM_R = 16;
const BAR_W = 2 * CHECKER_R + 4;
const TRAY_W = 90;
const MAX_VISIBLE = 5;
const DIE = 52;

const BOARD_LEFT = MARGIN_X;
const BOARD_TOP = MARGIN_Y;
const BOARD_BOTTOM = VIEW_H - MARGIN_Y;
const MIDDLE_Y = VIEW_H / 2;
const BAR_X = BOARD_LEFT + 6 * POINT_W;
const RIGHT_HALF_X = BAR_X + BAR_W;
const BOARD_RIGHT = RIGHT_HALF_X + 6 * POINT_W;
const TRAY_X = BOARD_RIGHT + 10;

/** Left edge of the column a human-side index is drawn in. */
function columnX(index) {
  if (index < 6) return BOARD_RIGHT - (index + 1) * POINT_W;
  if (index < 12) return BAR_X - (index - 5) * POINT_W;
  if (index < 18) return BOARD_LEFT + (index - 12) * POINT_W;
  return RIGHT_HALF_X + (index - 18) * POINT_W;
}

const isBottom = (index) => index < 12;

export class BoardView {
  #svg;
  #onSelect;

  constructor(svg, { onSelect }) {
    this.#svg = svg;
    this.#onSelect = onSelect;
    svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.addEventListener("click", (event) => {
      const target = event.target.closest("[data-select]");
      if (!target) return;
      const value = target.dataset.select;
      this.#onSelect(value === "bar" ? BAR : value === "off" ? OFF : Number(value));
    });
  }

  /**
   * Draw a position.
   *
   * `selected` is the point a checker is being moved from, `destinations` the
   * points it may legally reach — both come from the game loop, which validates
   * clicks against real legal plays rather than re-deriving the rules here.
   */
  render(position, { dice = null, selected = null, destinations = [], onRoll = "human" } = {}) {
    const parts = [
      `<rect x="0" y="0" width="${VIEW_W}" height="${VIEW_H}" rx="10" class="bg-frame"/>`,
      `<rect x="${BOARD_LEFT}" y="${BOARD_TOP}" width="${BOARD_RIGHT - BOARD_LEFT}" ` +
        `height="${BOARD_BOTTOM - BOARD_TOP}" class="bg-felt"/>`,
      `<rect x="${BAR_X}" y="${BOARD_TOP}" width="${BAR_W}" height="${BOARD_BOTTOM - BOARD_TOP}" class="bg-bar"/>`,
      `<rect x="${TRAY_X}" y="${BOARD_TOP}" width="${TRAY_W}" height="${BOARD_BOTTOM - BOARD_TOP}" ` +
        `class="bg-tray" data-select="off"/>`,
    ];

    for (let i = 0; i < POINTS; i++) parts.push(point(i, destinations.includes(i)));
    for (let i = 0; i < POINTS; i++) {
      parts.push(checkers(i, position.my[i], "mine", selected === i));
      parts.push(checkers(i, position.opp[i], "theirs", false));
    }

    parts.push(bar(position, selected === BAR, destinations.includes(BAR)));
    parts.push(tray(position, destinations.includes(OFF)));
    parts.push(labels(position, dice, onRoll));

    this.#svg.innerHTML = parts.join("");
  }
}

function point(index, isDestination) {
  const x = columnX(index);
  const bottom = isBottom(index);
  const yBase = bottom ? BOARD_BOTTOM : BOARD_TOP;
  const yTip = bottom ? BOARD_BOTTOM - POINT_H : BOARD_TOP + POINT_H;
  const shade = index % 2 === 0 ? "bg-point--dark" : "bg-point--light";
  return (
    `<polygon points="${x},${yBase} ${x + POINT_W},${yBase} ${x + POINT_W / 2},${yTip}" ` +
      `class="bg-point ${shade}${isDestination ? " bg-point--target" : ""}"/>` +
    `<rect x="${x}" y="${bottom ? BOARD_BOTTOM - POINT_H : BOARD_TOP}" width="${POINT_W}" ` +
      `height="${POINT_H}" class="bg-hit" data-select="${index}"/>`
  );
}

/**
 * One checker. The rim is the lathe-turned ring a real checker has; it is also
 * what keeps a stack of five legible, since flat discs of one colour touching
 * edge to edge read as a single blob.
 *
 * `count` is the whole stack, so the numeral replaces the rim on the top checker
 * when there are more than five — the stack is capped, not the point.
 */
function checker(x, y, side, { selected = false, count = 0 } = {}) {
  const overflow = count > MAX_VISIBLE;
  return (
    `<circle cx="${x}" cy="${y}" r="${CHECKER_R}" ` +
      `class="bg-checker bg-checker--${side}${selected ? " bg-checker--selected" : ""}"/>` +
    (overflow
      ? `<text x="${x}" y="${y + 7}" class="bg-count bg-count--${side}">${count}</text>`
      : `<circle cx="${x}" cy="${y}" r="${CHECKER_RIM_R}" class="bg-checker-rim bg-checker-rim--${side}"/>`)
  );
}

function checkers(index, count, side, isSelected) {
  if (count === 0) return "";
  const x = columnX(index) + POINT_W / 2;
  const bottom = isBottom(index);
  const shown = Math.min(count, MAX_VISIBLE);
  let out = "";
  for (let n = 0; n < shown; n++) {
    const y = bottom
      ? BOARD_BOTTOM - CHECKER_R - 4 - n * STACK_STEP
      : BOARD_TOP + CHECKER_R + 4 + n * STACK_STEP;
    const top = n === shown - 1;
    out += checker(x, y, side, { selected: top && isSelected, count: top ? count : 0 });
  }
  return out;
}

function bar(position, isSelected, isDestination) {
  const x = BAR_X + BAR_W / 2;
  let out = isDestination
    ? `<rect x="${BAR_X}" y="${BOARD_TOP}" width="${BAR_W}" height="${BOARD_BOTTOM - BOARD_TOP}" class="bg-point--target"/>`
    : "";
  // The two stacks grow away from the middle line, and carry the same overflow
  // numeral the points do: before this, a sixth checker on the bar simply was
  // not drawn anywhere.
  for (let n = 0; n < Math.min(position.myBar, MAX_VISIBLE); n++) {
    const top = n === Math.min(position.myBar, MAX_VISIBLE) - 1;
    out += checker(x, MIDDLE_Y + 30 + n * STACK_STEP, "mine", {
      selected: isSelected && n === 0,
      count: top ? position.myBar : 0,
    });
  }
  for (let n = 0; n < Math.min(position.oppBar, MAX_VISIBLE); n++) {
    const top = n === Math.min(position.oppBar, MAX_VISIBLE) - 1;
    out += checker(x, MIDDLE_Y - 30 - n * STACK_STEP, "theirs", {
      count: top ? position.oppBar : 0,
    });
  }
  if (position.myBar > 0) {
    out += `<rect x="${BAR_X}" y="${MIDDLE_Y}" width="${BAR_W}" height="${BOARD_BOTTOM - MIDDLE_Y}" ` +
      `class="bg-hit" data-select="bar"/>`;
  }
  return out;
}

function tray(position, isDestination) {
  const x = TRAY_X + TRAY_W / 2;
  let out = isDestination
    ? `<rect x="${TRAY_X}" y="${BOARD_TOP}" width="${TRAY_W}" height="${BOARD_BOTTOM - BOARD_TOP}" ` +
        `class="bg-point--target" data-select="off"/>`
    : "";
  out +=
    `<text x="${x}" y="${BOARD_BOTTOM - 14}" class="bg-tray-label">${position.myOff} off</text>` +
    `<text x="${x}" y="${BOARD_TOP + 24}" class="bg-tray-label">${position.oppOff} off</text>`;
  for (let n = 0; n < position.myOff; n++) {
    out += `<rect x="${TRAY_X + 12}" y="${BOARD_BOTTOM - 40 - n * 15}" width="${TRAY_W - 24}" height="11" ` +
      `rx="3" class="bg-borne bg-borne--mine"/>`;
  }
  for (let n = 0; n < position.oppOff; n++) {
    out += `<rect x="${TRAY_X + 12}" y="${BOARD_TOP + 34 + n * 15}" width="${TRAY_W - 24}" height="11" ` +
      `rx="3" class="bg-borne bg-borne--theirs"/>`;
  }
  return out;
}

function labels(position, dice, onRoll) {
  let out = "";
  // Point numbers go on the wooden frame rather than on the felt: a five-stack
  // now reaches the tip, and there is nowhere in the playing area to put them
  // that the checkers or the dice do not want.
  for (let i = 0; i < POINTS; i++) {
    const x = columnX(i) + POINT_W / 2;
    out += `<text x="${x}" y="${isBottom(i) ? VIEW_H - 11 : 21}" class="bg-pointno">${i + 1}</text>`;
  }

  out += `<text x="${TRAY_X + TRAY_W / 2}" y="${MIDDLE_Y - 8}" class="bg-pips">${myPips(position)}</text>`;
  out += `<text x="${TRAY_X + TRAY_W / 2}" y="${MIDDLE_Y + 14}" class="bg-pips bg-pips--muted">${oppPips(position)}</text>`;

  if (dice) {
    // Centred in the band between the point tips, on the roller's side of the
    // bar, so the dice never cover a checker.
    const y = MIDDLE_Y - DIE / 2;
    const originX = onRoll === "human" ? RIGHT_HALF_X + 70 : BOARD_LEFT + 70;
    dice.forEach((die, n) => {
      out += die6(originX + n * (DIE + 16), y, die);
    });
  }
  return out;
}

function die6(x, y, value) {
  const pips = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  }[value];
  const mid = DIE / 2;
  const spread = DIE / 4;
  const dots = pips
    .map(
      ([dx, dy]) =>
        `<circle cx="${x + mid + dx * spread}" cy="${y + mid + dy * spread}" r="${DIE / 12}" class="bg-die-pip"/>`,
    )
    .join("");
  return `<rect x="${x}" y="${y}" width="${DIE}" height="${DIE}" rx="9" class="bg-die"/>${dots}`;
}
