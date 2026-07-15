import {
  registerServiceWorker,
  sendServiceWorkerMessage,
  versionedSourceUrl,
} from "./cache-client.js";

export function createAudioCacheController({
  status,
  media,
  onPlaybackStatus,
  onResumePlayback,
}) {
  let sources = [];
  let playbackSource = null;
  let generation = 0;
  let repairedSha = null;
  let cacheTriggerController = null;
  const downloads = new Map();
  const sourceChecks = new Map();

  const registration = registerServiceWorker().catch((error) => {
    status.textContent = `本地缓存不可用：${error.message}`;
    return null;
  });

  function sourceKey(source) {
    return `${source.file}:${source.sha256}`;
  }

  function uniqueSources(nextSources) {
    const seen = new Set();
    return nextSources.filter((source) => {
      if (!source?.file || !source?.sha256 || seen.has(sourceKey(source))) {
        return false;
      }
      seen.add(sourceKey(source));
      return true;
    });
  }

  function isCurrent(candidate, currentGeneration = generation) {
    return (
      currentGeneration === generation &&
      sources.some((source) => sourceKey(source) === sourceKey(candidate))
    );
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

  function describeSource(source) {
    if (source.type === "audio/wav") {
      return `WAV ${formatBytes(source.bytes)}`;
    }
    if (source.type === "audio/mp4") {
      return `AAC ${formatBytes(source.bytes)}`;
    }
    if (source.type === "audio/mpeg") {
      return `MP3 ${formatBytes(source.bytes)}`;
    }
    return formatBytes(source.bytes);
  }

  async function downloadSource(worker, candidate, { force = false } = {}) {
    const key = sourceKey(candidate);
    if (downloads.has(key)) {
      return downloads.get(key);
    }

    const download = sendServiceWorkerMessage(
      worker,
      messageFor(candidate, "CACHE_TRACK", { force }),
    ).finally(() => downloads.delete(key));
    downloads.set(key, download);
    return download;
  }

  function reloadMedia(candidate, { resumeTime = 0, resume = false } = {}) {
    if (!sources.some((source) => sourceKey(source) === sourceKey(candidate))) {
      return;
    }
    playbackSource = candidate;

    media.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(resumeTime) && resumeTime > 0) {
          media.currentTime = Math.min(resumeTime, media.duration || resumeTime);
        }
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

  function currentPlaybackSource() {
    if (!media.currentSrc) {
      return playbackSource;
    }
    const currentUrl = new URL(media.currentSrc, window.location.href);
    currentUrl.searchParams.delete("music-reload");
    return sources.find(
      (candidate) => versionedSourceUrl(candidate) === currentUrl.href,
    ) ?? playbackSource;
  }

  async function chooseInitialSource(cachedPreferred, fallback) {
    try {
      const worker = await registration;
      if (!worker) {
        return fallback;
      }
      const result = await sendServiceWorkerMessage(
        worker,
        messageFor(cachedPreferred, "CHECK_TRACK"),
      );
      sourceChecks.set(sourceKey(cachedPreferred), result);
      return result.cached ? cachedPreferred : fallback;
    } catch {
      return fallback;
    }
  }

  async function cacheAll(currentGeneration) {
    const worker = await registration;
    if (!worker || currentGeneration !== generation) {
      if (!worker && currentGeneration === generation) {
        status.textContent = "浏览器不支持离线缓存";
      }
      return;
    }

    let cachedCount = 0;
    let failureCount = 0;

    for (const [index, candidate] of sources.entries()) {
      if (!isCurrent(candidate, currentGeneration)) {
        return;
      }

      try {
        status.textContent = `正在检查本地版本 ${index + 1}/${sources.length}…`;
        const key = sourceKey(candidate);
        const result = sourceChecks.has(key)
          ? sourceChecks.get(key)
          : await sendServiceWorkerMessage(
              worker,
              messageFor(candidate, "CHECK_TRACK"),
            );
        sourceChecks.delete(key);
        if (!isCurrent(candidate, currentGeneration)) {
          return;
        }

        if (!result.cached) {
          const resumeTime = media.currentTime;
          const resume = !media.paused && !media.ended;
          status.textContent = `正在自动缓存 ${describeSource(candidate)}（${index + 1}/${sources.length}）…`;
          await downloadSource(worker, candidate, {
            force: result.repairRequired,
          });
          if (!isCurrent(candidate, currentGeneration)) {
            return;
          }
          if (
            result.repairRequired &&
            playbackSource?.sha256 === candidate.sha256 &&
            repairedSha !== candidate.sha256
          ) {
            repairedSha = candidate.sha256;
            reloadMedia(candidate, { resumeTime, resume });
          }
        }
        cachedCount += 1;
      } catch {
        failureCount += 1;
      }
    }

    if (currentGeneration !== generation) {
      return;
    }
    status.textContent = failureCount === 0
      ? `已自动缓存 ${cachedCount} 个版本`
      : `已缓存 ${cachedCount}/${sources.length} 个版本，失败项将在下次打开时重试`;
  }

  function clearCacheTrigger() {
    cacheTriggerController?.abort();
    cacheTriggerController = null;
  }

  function scheduleAutoCache(currentGeneration) {
    clearCacheTrigger();
    cacheTriggerController = new AbortController();
    const { signal } = cacheTriggerController;
    let started = false;
    let hasPlayed = false;

    const start = () => {
      if (started || currentGeneration !== generation) {
        return;
      }
      started = true;
      clearCacheTrigger();
      void cacheAll(currentGeneration);
    };
    const markPlayed = () => {
      hasPlayed = true;
    };
    const startAfterPlayedPause = () => {
      if (hasPlayed) {
        start();
      }
    };
    const startNearEnd = () => {
      if (
        Number.isFinite(media.duration) &&
        media.duration > 0 &&
        media.currentTime >= media.duration - 3
      ) {
        start();
      }
    };

    media.addEventListener("canplaythrough", start, { once: true, signal });
    media.addEventListener("playing", markPlayed, { once: true, signal });
    media.addEventListener("pause", startAfterPlayedPause, { signal });
    media.addEventListener("timeupdate", startNearEnd, { signal });
  }

  function setSources(nextSources, nextPlaybackSource) {
    generation += 1;
    sources = uniqueSources(nextSources);
    playbackSource = nextPlaybackSource;
    repairedSha = null;
    status.textContent = "将在播放稳定后自动缓存…";
    if (navigator.storage?.persist) {
      void navigator.storage.persist();
    }
    if (sources.length > 0) {
      scheduleAutoCache(generation);
    }
  }

  async function repairAndResume() {
    const candidate = currentPlaybackSource();
    if (!candidate || repairedSha === candidate.sha256) {
      onPlaybackStatus("音频加载失败，将在下次打开时重新缓存");
      return;
    }

    repairedSha = candidate.sha256;
    const currentGeneration = generation;
    const resumeTime = media.currentTime;
    onPlaybackStatus("音频异常，正在重新下载并恢复…");

    try {
      const worker = await registration;
      if (!worker) {
        throw new Error("浏览器不支持离线缓存");
      }
      await downloadSource(worker, candidate, { force: true });
      if (!isCurrent(candidate, currentGeneration)) {
        return;
      }
      onPlaybackStatus("音频已重新下载，正在恢复播放…");
      reloadMedia(candidate, { resumeTime, resume: true });
    } catch {
      if (currentGeneration === generation) {
        onPlaybackStatus("音频重新下载失败，将在下次打开时重试");
      }
    }
  }

  return { chooseInitialSource, setSources, repairAndResume };
}
