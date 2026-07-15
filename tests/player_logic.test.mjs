import assert from "node:assert/strict";
import test from "node:test";

import {
  advancePlayback,
  attemptPlayback,
  classifyPlaybackError,
  createShuffleQueue,
  formatDuration,
  getNextTrackIndex,
  navigatePlayback,
  shouldHandlePlaybackShortcut,
} from "../player-logic.js";


test("duration matches the whole seconds shown by native audio controls", () => {
  assert.equal(formatDuration(238.64), "3:58");
});

test("sequential playback advances once and stops after the final track", () => {
  assert.equal(
    getNextTrackIndex({ mode: "order", currentIndex: 0, trackCount: 3 }),
    1,
  );
  assert.equal(
    getNextTrackIndex({ mode: "order", currentIndex: 2, trackCount: 3 }),
    null,
  );
});

test("loop playback wraps from the final track to the first", () => {
  assert.equal(
    getNextTrackIndex({ mode: "loop", currentIndex: 2, trackCount: 3 }),
    0,
  );
});

test("a single-track playlist repeats in every playback mode", () => {
  for (const mode of ["order", "loop", "shuffle"]) {
    assert.deepEqual(
      advancePlayback({
        mode,
        currentIndex: 0,
        trackCount: 1,
      }),
      { index: 0, shuffleQueue: [] },
    );
  }
});

test("shuffle playback visits every other track once before reshuffling", () => {
  const queue = createShuffleQueue({
    trackCount: 4,
    currentIndex: 1,
    random: () => 0.5,
  });

  assert.deepEqual(queue.toSorted((left, right) => left - right), [0, 2, 3]);
});

test("shuffle playback consumes its queue", () => {
  assert.deepEqual(
    advancePlayback({
      mode: "shuffle",
      currentIndex: 0,
      trackCount: 3,
      shuffleQueue: [2, 1],
    }),
    { index: 2, shuffleQueue: [1] },
  );
});

test("manual shuffle navigation uses the shuffle bag and can return through history", () => {
  const forward = navigatePlayback({
    direction: 1,
    mode: "shuffle",
    currentIndex: 1,
    trackCount: 4,
    shuffleQueue: [3, 0, 2],
    shuffleHistory: [],
  });
  assert.deepEqual(forward, {
    index: 3,
    shuffleQueue: [0, 2],
    shuffleHistory: [1],
  });

  assert.deepEqual(
    navigatePlayback({
      direction: -1,
      mode: "shuffle",
      currentIndex: 3,
      trackCount: 4,
      shuffleQueue: forward.shuffleQueue,
      shuffleHistory: forward.shuffleHistory,
    }),
    {
      index: 1,
      shuffleQueue: [3, 0, 2],
      shuffleHistory: [],
    },
  );
});

test("space toggles playback only from a non-interactive page target", () => {
  assert.equal(
    shouldHandlePlaybackShortcut({ code: "Space", targetTagName: "MAIN" }),
    true,
  );
  assert.equal(
    shouldHandlePlaybackShortcut({ code: "Space", targetTagName: "BUTTON" }),
    false,
  );
  assert.equal(
    shouldHandlePlaybackShortcut({
      code: "Space",
      targetTagName: "MAIN",
      repeat: true,
    }),
    false,
  );
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
