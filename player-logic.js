export function formatDuration(durationSeconds) {
  const totalSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
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
