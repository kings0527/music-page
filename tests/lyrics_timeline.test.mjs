import assert from "node:assert/strict";
import test from "node:test";

import { findActiveCueIndex } from "../lyrics-timeline.js";

const cues = [
  { start: 15.58, end: 21.12, text: "小时候问天空有多远" },
  { start: 22.86, end: 28.3, text: "以为长大就能看见" },
  { start: 29.68, end: 35.56, text: "走过很多没有名字的街" },
];

test("lyric lookup handles the intro, active lines, gaps, and seeking", () => {
  assert.equal(findActiveCueIndex(cues, 10), -1);
  assert.equal(findActiveCueIndex(cues, 15.58), 0);
  assert.equal(findActiveCueIndex(cues, 20), 0);
  assert.equal(findActiveCueIndex(cues, 21.12), -1);
  assert.equal(findActiveCueIndex(cues, 30), 2);
});
