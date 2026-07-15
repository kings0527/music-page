export function formatDuration(durationSeconds) {
  const totalSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function getNextTrackIndex({ mode, currentIndex, trackCount }) {
  if (mode === "loop") {
    return trackCount > 0 ? (currentIndex + 1) % trackCount : null;
  }

  if (mode !== "order") {
    return null;
  }
  const nextIndex = currentIndex + 1;
  return nextIndex < trackCount ? nextIndex : null;
}

export function createShuffleQueue({
  trackCount,
  currentIndex,
  random = Math.random,
}) {
  const queue = Array.from({ length: trackCount }, (_, index) => index).filter(
    (index) => index !== currentIndex,
  );

  for (let index = queue.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [queue[index], queue[swapIndex]] = [queue[swapIndex], queue[index]];
  }

  return queue;
}

export function advancePlayback({
  mode,
  currentIndex,
  trackCount,
  shuffleQueue = [],
  random = Math.random,
}) {
  if (mode !== "shuffle") {
    return {
      index: getNextTrackIndex({ mode, currentIndex, trackCount }),
      shuffleQueue: [],
    };
  }

  if (trackCount === 1) {
    return { index: 0, shuffleQueue: [] };
  }

  const availableQueue = shuffleQueue.filter(
    (index, position, queue) =>
      index >= 0 &&
      index < trackCount &&
      index !== currentIndex &&
      queue.indexOf(index) === position,
  );
  const nextQueue =
    availableQueue.length > 0
      ? availableQueue
      : createShuffleQueue({ trackCount, currentIndex, random });
  const [index = null, ...remainingQueue] = nextQueue;
  return { index, shuffleQueue: remainingQueue };
}

const INTERACTIVE_TAGS = new Set([
  "A",
  "AUDIO",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

export function shouldHandlePlaybackShortcut({
  code,
  targetTagName = "",
  isContentEditable = false,
  repeat = false,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
}) {
  return (
    code === "Space" &&
    !repeat &&
    !altKey &&
    !ctrlKey &&
    !metaKey &&
    !shiftKey &&
    !isContentEditable &&
    !INTERACTIVE_TAGS.has(targetTagName.toUpperCase())
  );
}

export function classifyPlaybackError(errorName, isAutoplayAttempt) {
  if (errorName === "AbortError") {
    return { kind: "ignored", showGate: false, message: "" };
  }

  if (errorName === "NotAllowedError") {
    return {
      kind: "blocked",
      showGate: true,
      message: isAutoplayAttempt
        ? "浏览器需要你点一下才能播放"
        : "请允许浏览器播放音频后重试",
    };
  }

  return {
    kind: "failed",
    showGate: false,
    message: "暂时无法播放，请稍后重试",
  };
}

export async function attemptPlayback({
  play,
  requestId,
  getCurrentRequestId,
  isAutoplayAttempt,
}) {
  try {
    await play();
    return { kind: "started", showGate: false, message: "" };
  } catch (error) {
    if (requestId !== getCurrentRequestId()) {
      return { kind: "ignored", showGate: false, message: "" };
    }
    return classifyPlaybackError(error.name, isAutoplayAttempt);
  }
}
