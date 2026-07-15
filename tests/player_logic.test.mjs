import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPlaybackError,
  formatDuration,
  isCurrentPlaybackRequest,
} from "../player-logic.js";


test("duration matches the whole seconds shown by native audio controls", () => {
  assert.equal(formatDuration(238.64), "3:58");
});

test("autoplay policy failures expose the click-to-play fallback", () => {
  assert.deepEqual(classifyPlaybackError("NotAllowedError", true), {
    kind: "blocked",
    showGate: true,
    message: "浏览器需要你点一下才能播放",
  });
});

test("aborted and stale playback requests cannot overwrite current status", () => {
  assert.equal(classifyPlaybackError("AbortError", false).kind, "ignored");
  assert.equal(isCurrentPlaybackRequest(3, 4), false);
  assert.equal(isCurrentPlaybackRequest(4, 4), true);
});

test("real playback failures do not masquerade as autoplay blocking", () => {
  const outcome = classifyPlaybackError("NotSupportedError", false);
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.showGate, false);
});
