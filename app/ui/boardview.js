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

const VIEW_W = 1000;
const VIEW_H = 600;
const MARGIN = 16;
const POINT_W = 68;
const POINT_H = 240;
const BAR_W = 44;
const TRAY_W = 90;
const CHECKER_R = 26;
const STACK_STEP = 46;
const MAX_VISIBLE = 5;

const BOARD_LEFT = MARGIN;
const BOARD_TOP = MARGIN;
const BOARD_BOTTOM = VIEW_H - MARGIN;
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
    out +=
      `<circle cx="${x}" cy="${y}" r="${CHECKER_R}" ` +
      `class="bg-checker bg-checker--${side}${top && isSelected ? " bg-checker--selected" : ""}"/>`;
    if (top && count > MAX_VISIBLE) {
      out += `<text x="${x}" y="${y + 6}" class="bg-count bg-count--${side}">${count}</text>`;
    }
  }
  return out;
}

function bar(position, isSelected, isDestination) {
  const x = BAR_X + BAR_W / 2;
  let out = isDestination
    ? `<rect x="${BAR_X}" y="${BOARD_TOP}" width="${BAR_W}" height="${BOARD_BOTTOM - BOARD_TOP}" class="bg-point--target"/>`
    : "";
  for (let n = 0; n < Math.min(position.myBar, MAX_VISIBLE); n++) {
    const y = VIEW_H / 2 + 60 + n * STACK_STEP;
    out += `<circle cx="${x}" cy="${y}" r="${CHECKER_R - 2}" class="bg-checker bg-checker--mine${
      isSelected && n === 0 ? " bg-checker--selected" : ""
    }"/>`;
  }
  for (let n = 0; n < Math.min(position.oppBar, MAX_VISIBLE); n++) {
    const y = VIEW_H / 2 - 60 - n * STACK_STEP;
    out += `<circle cx="${x}" cy="${y}" r="${CHECKER_R - 2}" class="bg-checker bg-checker--theirs"/>`;
  }
  if (position.myBar > 0) {
    out += `<rect x="${BAR_X}" y="${VIEW_H / 2}" width="${BAR_W}" height="${VIEW_H / 2 - MARGIN}" ` +
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
  for (let i = 0; i < POINTS; i++) {
    const x = columnX(i) + POINT_W / 2;
    const bottom = isBottom(i);
    out += `<text x="${x}" y="${bottom ? BOARD_BOTTOM - POINT_H - 10 : BOARD_TOP + POINT_H + 22}" ` +
      `class="bg-pointno">${i + 1}</text>`;
  }

  out += `<text x="${TRAY_X + TRAY_W / 2}" y="${VIEW_H / 2 - 8}" class="bg-pips">${myPips(position)}</text>`;
  out += `<text x="${TRAY_X + TRAY_W / 2}" y="${VIEW_H / 2 + 14}" class="bg-pips bg-pips--muted">${oppPips(position)}</text>`;

  if (dice) {
    const y = onRoll === "human" ? VIEW_H / 2 + 40 : VIEW_H / 2 - 96;
    const originX = onRoll === "human" ? RIGHT_HALF_X + 70 : BOARD_LEFT + 70;
    dice.forEach((die, n) => {
      out += die6(originX + n * 76, y, die);
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
  const dots = pips
    .map(([dx, dy]) => `<circle cx="${x + 28 + dx * 14}" cy="${y + 28 + dy * 14}" r="4.5" class="bg-die-pip"/>`)
    .join("");
  return `<rect x="${x}" y="${y}" width="56" height="56" rx="9" class="bg-die"/>${dots}`;
}
