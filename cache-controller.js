import {
  registerServiceWorker,
  sendServiceWorkerMessage,
  versionedSourceUrl,
} from "./cache-client.js";

export function createAudioCacheController({
  button,
  status,
  media,
  onPlaybackStatus,
  onResumePlayback,
}) {
  let source = null;
  let busy = false;
  let cached = false;
  let requestId = 0;
  let repairedSha = null;

  const registration = registerServiceWorker().catch((error) => {
    status.textContent = `本地缓存不可用：${error.message}`;
    return null;
  });

  function isCurrent(candidate) {
    return candidate && source?.sha256 === candidate.sha256;
  }

  function updateButton() {
    button.dataset.cached = cached ? "true" : "false";
    button.textContent = cached ? "重新缓存" : "缓存本曲";
    button.disabled = busy || !source;
  }

  function messageFor(candidate, type, { force = false } = {}) {
    return {
      type,
      url: versionedSourceUrl(candidate),
      bytes: candidate.bytes,
      sha256: candidate.sha256,
      force,
    };
  }

  function formatBytes(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function reloadMedia(candidate, { resumeTime = 0, resume = false } = {}) {
    if (!isCurrent(candidate)) {
      return;
    }
    media.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(resumeTime) && resumeTime > 0) {
          media.currentTime = Math.min(resumeTime, media.duration || resumeTime);
        }
        status.textContent = `已缓存 ${formatBytes(candidate.bytes)}`;
        if (resume) {
          onResumePlayback();
        }
      },
      { once: true },
    );
    const reloadUrl = new URL(versionedSourceUrl(candidate), window.location.href);
    reloadUrl.searchParams.set("music-reload", String(Date.now()));
    media.src = reloadUrl.href;
    media.load();
  }

  async function refresh(candidate) {
    const currentRequestId = ++requestId;
    busy = true;
    cached = false;
    status.textContent = "正在检查本地缓存…";
    updateButton();

    try {
      const worker = await registration;
      if (!worker) {
        throw new Error("浏览器不支持离线缓存");
      }
      const result = await sendServiceWorkerMessage(
        worker,
        messageFor(candidate, "CHECK_TRACK"),
      );
      if (currentRequestId !== requestId || !isCurrent(candidate)) {
        return;
      }
      if (result.repairRequired) {
        const resumeTime = media.currentTime;
        const resume = !media.paused && !media.ended;
        if (await cacheSource(candidate, { force: true, repair: true })) {
          repairedSha = candidate.sha256;
          reloadMedia(candidate, { resumeTime, resume });
        }
        return;
      }
      cached = result.cached;
      status.textContent = cached
        ? `已缓存 ${formatBytes(result.bytes)}`
        : "尚未缓存";
    } catch (error) {
      if (currentRequestId === requestId && isCurrent(candidate)) {
        cached = false;
        status.textContent = error.message;
      }
    } finally {
      if (currentRequestId === requestId && isCurrent(candidate)) {
        busy = false;
        updateButton();
      }
    }
  }

  async function cacheSource(candidate, { force = false, repair = false } = {}) {
    const currentRequestId = ++requestId;
    const previouslyCached = cached;
    busy = true;
    status.textContent = repair
      ? "音频异常，正在重新下载…"
      : "正在下载到本地…";
    updateButton();

    try {
      const worker = await registration;
      if (!worker) {
        throw new Error("浏览器不支持离线缓存");
      }
      const result = await sendServiceWorkerMessage(
        worker,
        messageFor(candidate, "CACHE_TRACK", { force }),
      );
      if (currentRequestId !== requestId || !isCurrent(candidate)) {
        return false;
      }
      cached = true;
      status.textContent = repair
        ? "音频已重新下载，正在恢复…"
        : `已缓存 ${formatBytes(result.bytes)}`;
      return true;
    } catch (error) {
      if (currentRequestId === requestId && isCurrent(candidate)) {
        cached = previouslyCached;
        status.textContent = previouslyCached
          ? `刷新失败，已保留旧缓存：${error.message}`
          : error.message;
      }
      return false;
    } finally {
      if (currentRequestId === requestId && isCurrent(candidate)) {
        busy = false;
        updateButton();
      }
    }
  }

  function setSource(nextSource) {
    source = nextSource;
    repairedSha = null;
    cached = false;
    updateButton();
    if (source) {
      void refresh(source);
    }
  }

  async function repairAndResume() {
    const candidate = source;
    if (!candidate || repairedSha === candidate.sha256) {
      onPlaybackStatus("音频加载失败，请点击“重新缓存”后重试");
      return;
    }

    repairedSha = candidate.sha256;
    const resumeTime = media.currentTime;
    if (!(await cacheSource(candidate, { force: true, repair: true }))) {
      if (isCurrent(candidate)) {
        onPlaybackStatus("音频重新下载失败，请稍后重试");
      }
      return;
    }
    if (!isCurrent(candidate)) {
      return;
    }

    onPlaybackStatus("音频已重新下载，正在恢复播放…");
    reloadMedia(candidate, { resumeTime, resume: true });
  }

  button.addEventListener("click", () => {
    if (busy || !source) {
      return;
    }
    if (navigator.storage?.persist) {
      void navigator.storage.persist();
    }
    void cacheSource(source, { force: cached });
  });

  updateButton();
  return { setSource, repairAndResume };
}
