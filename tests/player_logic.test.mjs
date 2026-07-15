import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptPlayback,
  classifyPlaybackError,
  formatDuration,
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

test("aborted playback requests are ignored", () => {
  assert.equal(classifyPlaybackError("AbortError", false).kind, "ignored");
});

test("real playback failures do not masquerade as autoplay blocking", () => {
  const outcome = classifyPlaybackError("NotSupportedError", false);
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.showGate, false);
});

test("a late rejection from an old track is ignored after a fast switch", async () => {
  let rejectOldPlayback;
  let currentRequestId = 1;
  const oldPlayback = attemptPlayback({
    play: () =>
      new Promise((resolve, reject) => {
        rejectOldPlayback = reject;
      }),
    requestId: 1,
    getCurrentRequestId: () => currentRequestId,
    isAutoplayAttempt: true,
  });

  currentRequestId = 2;
  const rejection = new Error("superseded");
  rejection.name = "NotAllowedError";
  rejectOldPlayback(rejection);

  assert.deepEqual(await oldPlayback, {
    kind: "ignored",
    showGate: false,
    message: "",
  });
});
