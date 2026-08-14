/** Shared loader for the gzipped fixtures written by the raccoon repo. */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createPosition } from "../app/engine/board.js";

export function loadFixture(name) {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
}

/** Fixture board (snake_case, from Python) -> engine Position. */
export function positionOf(board) {
  return createPosition({
    my: board.my,
    opp: board.opp,
    myBar: board.my_bar,
    oppBar: board.opp_bar,
    myOff: board.my_off,
    oppOff: board.opp_off,
  });
}
