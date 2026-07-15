import {
  advancePlayback,
  attemptPlayback,
  formatDuration,
  shouldHandlePlaybackShortcut,
} from "./player-logic.js";
import { findActiveCueIndex } from "./lyrics-timeline.js";
import {
  registerServiceWorker,
  sendServiceWorkerMessage,
  versionedSourceUrl,
} from "./cache-client.js";

const MODE_STORAGE_KEY = "music-player-mode";
const MODE_LABELS = {
  order: "顺序播放",
  loop: "循环播放",
  shuffle: "随机播放",
};

const player = document.querySelector("#player");
const playerCard = document.querySelector(".player-card");
const title = document.querySelector("#track-title");
const subtitle = document.querySelector("#track-subtitle");
const status = document.querySelector("#playback-status");
const autoplayGate = document.querySelector("#autoplay-gate");
const playlist = document.querySelector("#playlist");
const trackCount = document.querySelector("#track-count");
const previousButton = document.querySelector("#previous-track");
const nextButton = document.querySelector("#next-track");
const modeButtons = [...document.querySelectorAll("[data-play-mode]")];
const cacheButton = document.querySelector("#cache-track");
const cacheStatus = document.querySelector("#cache-status");
const masterDownload = document.querySelector("#master-download");
const lyricsContainer = document.querySelector("#lyrics");
const lyricsStatus = document.querySelector("#lyrics-status");

let tracks = [];
let currentIndex = 0;
let playbackRequestId = 0;
let playMode = readStoredMode();
let shuffleQueue = [];
let lyricCues = [];
let activeLyricIndex = -2;
let lyricRequestId = 0;
let currentStreamSource = null;
let cacheRequestId = 0;
let cacheBusy = false;
let repairedSourceSha = null;

const serviceWorkerRegistration = registerServiceWorker().catch((error) => {
  cacheStatus.textContent = `本地缓存不可用：${error.message}`;
  return null;
});

function readStoredMode() {
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return Object.hasOwn(MODE_LABELS, stored) ? stored : "order";
  } catch {
    return "order";
  }
}

function storeMode(mode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Playback still works when private browsing blocks localStorage.
  }
}

function setPlayMode(mode, { announce = true } = {}) {
  if (!Object.hasOwn(MODE_LABELS, mode)) {
    return;
  }
  playMode = mode;
  shuffleQueue = [];
  storeMode(mode);
  modeButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      button.dataset.playMode === mode ? "true" : "false",
    );
  });
  if (announce) {
    status.textContent = `已切换为${MODE_LABELS[mode]}`;
  }
}

function updatePlaylistSelection() {
  playlist.querySelectorAll("button").forEach((button, index) => {
    button.setAttribute("aria-current", index === currentIndex ? "true" : "false");
  });

  const hasSeveralTracks = tracks.length > 1;
  previousButton.disabled = !hasSeveralTracks;
  nextButton.disabled = !hasSeveralTracks;
}

function chooseStreamSource(track) {
  return (
    track.sources.find((source) => player.canPlayType(source.type) !== "") ??
    track.sources[0]
  );
}

function setTrackSources(track) {
  player.removeAttribute("src");
  const sourceElements = track.sources.map((source) => {
    const element = document.createElement("source");
    element.src = versionedSourceUrl(source);
    element.type = source.type;
    return element;
  });
  player.replaceChildren(...sourceElements);
  currentStreamSource = chooseStreamSource(track);
}

function selectTrack(index, { resetShuffle = true } = {}) {
  playbackRequestId += 1;
  currentIndex = (index + tracks.length) % tracks.length;
  if (resetShuffle) {
    shuffleQueue = [];
  }
  repairedSourceSha = null;
  const track = tracks[currentIndex];
  title.textContent = track.title;
  subtitle.textContent = `${track.subtitle} · ${track.format} · ${formatDuration(track.duration_seconds)}`;
  document.title = track.title;
  setTrackSources(track);
  player.load();

  masterDownload.href = track.master.file;
  masterDownload.download = track.master.file.split("/").at(-1);
  masterDownload.hidden = false;
  updatePlaylistSelection();
  void loadLyrics(track);
  void refreshCacheState();
}

async function requestPlayback(isAutoplayAttempt = false) {
  const requestId = ++playbackRequestId;
  const outcome = await attemptPlayback({
    play: () => player.play(),
    requestId,
    getCurrentRequestId: () => playbackRequestId,
    isAutoplayAttempt,
  });

  if (outcome.kind === "started" || outcome.kind === "ignored") {
    return;
  }

  autoplayGate.hidden = !outcome.showGate;
  status.textContent = outcome.message;
}

function renderPlaylist() {
  const fragment = document.createDocumentFragment();

  tracks.forEach((track, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const number = document.createElement("span");
    const name = document.createElement("span");
    const duration = document.createElement("span");

    button.type = "button";
    button.dataset.index = String(index);
    number.className = "track-number";
    number.textContent = String(index + 1).padStart(2, "0");
    name.className = "track-name";
    name.textContent = track.title;
    duration.className = "track-duration";
    duration.textContent = formatDuration(track.duration_seconds);

    button.append(number, name, duration);
    item.append(button);
    fragment.append(item);
  });

  playlist.replaceChildren(fragment);
  trackCount.textContent = `${tracks.length} 首`;
}

async function changeTrack(offset) {
  if (tracks.length < 2) {
    return;
  }
  selectTrack(currentIndex + offset);
  await requestPlayback();
}

function renderLyrics(cues) {
  const fragment = document.createDocumentFragment();
  cues.forEach((cue, index) => {
    const line = document.createElement("p");
    line.className = "lyric-line";
    line.dataset.lyricIndex = String(index);
    line.textContent = cue.text;
    fragment.append(line);
  });
  lyricsContainer.replaceChildren(fragment);
}

function describeLyricGap(currentTime) {
  if (lyricCues.length === 0) {
    return "暂无歌词";
  }
  if (currentTime < lyricCues[0].start) {
    return "前奏";
  }
  if (currentTime >= lyricCues.at(-1).end) {
    return "尾奏";
  }
  return "间奏";
}

function updateLyrics(currentTime) {
  const nextIndex = findActiveCueIndex(lyricCues, currentTime);
  if (nextIndex === activeLyricIndex) {
    if (nextIndex < 0) {
      lyricsStatus.textContent = describeLyricGap(currentTime);
    }
    return;
  }

  if (activeLyricIndex >= 0) {
    lyricsContainer
      .querySelector(`[data-lyric-index="${activeLyricIndex}"]`)
      ?.removeAttribute("aria-current");
  }
  activeLyricIndex = nextIndex;

  if (nextIndex < 0) {
    lyricsStatus.textContent = describeLyricGap(currentTime);
    return;
  }

  lyricsStatus.textContent = `${nextIndex + 1} / ${lyricCues.length}`;
  const activeLine = lyricsContainer.querySelector(
    `[data-lyric-index="${nextIndex}"]`,
  );
  activeLine?.setAttribute("aria-current", "true");
  activeLine?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
  });
}

async function loadLyrics(track) {
  const requestId = ++lyricRequestId;
  lyricCues = [];
  activeLyricIndex = -2;
  lyricsStatus.textContent = "正在加载…";
  showLyricsPlaceholder("歌词正在加载…");

  if (!track.lyrics) {
    lyricsStatus.textContent = "暂无歌词";
    showLyricsPlaceholder("这首歌暂无同步歌词");
    return;
  }

  try {
    const response = await fetch(track.lyrics, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const timeline = await response.json();
    if (
      timeline.audio_sha256 !== track.master.sha256 ||
      Math.abs(timeline.duration_seconds - track.duration_seconds) > 0.05 ||
      !Array.isArray(timeline.cues)
    ) {
      throw new Error("歌词时间轴与当前音频不匹配");
    }
    if (requestId !== lyricRequestId) {
      return;
    }
    lyricCues = timeline.cues;
    renderLyrics(lyricCues);
    activeLyricIndex = -2;
    updateLyrics(player.currentTime);
  } catch (error) {
    if (requestId !== lyricRequestId) {
      return;
    }
    lyricsStatus.textContent = "加载失败";
    showLyricsPlaceholder(error.message);
  }
}

function showLyricsPlaceholder(message) {
  const placeholder = document.createElement("p");
  placeholder.className = "lyrics-placeholder";
  placeholder.textContent = message;
  lyricsContainer.replaceChildren(placeholder);
}

function sourceCacheMessage(type, { force = false } = {}) {
  return {
    type,
    url: versionedSourceUrl(currentStreamSource),
    bytes: currentStreamSource.bytes,
    sha256: currentStreamSource.sha256,
    force,
  };
}

function updateCacheButton(cached) {
  cacheButton.dataset.cached = cached ? "true" : "false";
  cacheButton.textContent = cached ? "重新缓存" : "缓存本曲";
  cacheButton.disabled = cacheBusy || !currentStreamSource;
}

async function refreshCacheState() {
  const requestId = ++cacheRequestId;
  cacheBusy = true;
  cacheStatus.textContent = "正在检查本地缓存…";
  updateCacheButton(false);
  const sourceSha = currentStreamSource?.sha256;

  try {
    const registration = await serviceWorkerRegistration;
    if (!registration || !currentStreamSource) {
      throw new Error("浏览器不支持离线缓存");
    }
    const result = await sendServiceWorkerMessage(
      registration,
      sourceCacheMessage("CHECK_TRACK"),
    );
    if (requestId !== cacheRequestId || sourceSha !== currentStreamSource.sha256) {
      return;
    }
    cacheStatus.textContent = result.cached
      ? `已缓存 ${formatBytes(result.bytes)}`
      : "尚未缓存";
    updateCacheButton(result.cached);
  } catch (error) {
    if (requestId === cacheRequestId) {
      cacheStatus.textContent = error.message;
      updateCacheButton(false);
    }
  } finally {
    if (requestId === cacheRequestId) {
      cacheBusy = false;
      updateCacheButton(cacheButton.dataset.cached === "true");
    }
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function cacheCurrentTrack({ force = false, repair = false } = {}) {
  if (cacheBusy || !currentStreamSource) {
    return false;
  }
  cacheBusy = true;
  cacheButton.disabled = true;
  cacheStatus.textContent = repair ? "音频异常，正在重新下载…" : "正在下载到本地…";
  const sourceSha = currentStreamSource.sha256;

  try {
    if (!repair && navigator.storage?.persist) {
      void navigator.storage.persist();
    }
    const registration = await serviceWorkerRegistration;
    if (!registration) {
      throw new Error("浏览器不支持离线缓存");
    }
    const result = await sendServiceWorkerMessage(
      registration,
      sourceCacheMessage("CACHE_TRACK", { force }),
    );
    if (sourceSha !== currentStreamSource.sha256) {
      return false;
    }
    cacheStatus.textContent = `已缓存 ${formatBytes(result.bytes)}`;
    updateCacheButton(true);
    return true;
  } catch (error) {
    if (sourceSha === currentStreamSource?.sha256) {
      cacheStatus.textContent = error.message;
      updateCacheButton(false);
    }
    return false;
  } finally {
    cacheBusy = false;
    updateCacheButton(cacheButton.dataset.cached === "true");
  }
}

async function repairAndResumePlayback() {
  if (!currentStreamSource || repairedSourceSha === currentStreamSource.sha256) {
    status.textContent = "音频加载失败，请点击“重新缓存”后重试";
    return;
  }
  repairedSourceSha = currentStreamSource.sha256;
  const resumeTime = player.currentTime;
  if (!(await cacheCurrentTrack({ force: true, repair: true }))) {
    status.textContent = "音频重新下载失败，请稍后重试";
    return;
  }

  status.textContent = "音频已重新下载，正在恢复播放…";
  player.addEventListener(
    "loadedmetadata",
    () => {
      if (Number.isFinite(resumeTime) && resumeTime > 0) {
        player.currentTime = Math.min(resumeTime, player.duration || resumeTime);
      }
      void requestPlayback();
    },
    { once: true },
  );
  player.load();
}

playlist.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) {
    return;
  }
  selectTrack(Number(button.dataset.index));
  await requestPlayback();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setPlayMode(button.dataset.playMode));
});

cacheButton.addEventListener("click", () => {
  void cacheCurrentTrack({ force: cacheButton.dataset.cached === "true" });
});

document.addEventListener("keydown", (event) => {
  if (
    !shouldHandlePlaybackShortcut({
      code: event.code,
      targetTagName: event.target?.tagName,
      isContentEditable: event.target?.isContentEditable,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }) ||
    tracks.length === 0
  ) {
    return;
  }
  event.preventDefault();
  if (player.paused || player.ended) {
    void requestPlayback();
  } else {
    playbackRequestId += 1;
    player.pause();
  }
});

autoplayGate.addEventListener("click", () => requestPlayback());
previousButton.addEventListener("click", () => changeTrack(-1));
nextButton.addEventListener("click", () => changeTrack(1));

player.addEventListener("playing", () => {
  autoplayGate.hidden = true;
  playerCard.classList.add("is-playing");
  status.textContent = `正在播放 · ${MODE_LABELS[playMode]}`;
});

player.addEventListener("waiting", () => {
  status.textContent = "正在缓冲…";
});

player.addEventListener("stalled", () => {
  status.textContent = "网络较慢，正在继续加载…";
});

player.addEventListener("pause", () => {
  playerCard.classList.remove("is-playing");
  if (!player.ended) {
    status.textContent = "已暂停";
  }
});

player.addEventListener("timeupdate", () => updateLyrics(player.currentTime));
player.addEventListener("seeking", () => updateLyrics(player.currentTime));
player.addEventListener("loadedmetadata", () => updateLyrics(player.currentTime));

player.addEventListener("ended", async () => {
  const next = advancePlayback({
    mode: playMode,
    currentIndex,
    trackCount: tracks.length,
    shuffleQueue,
  });
  shuffleQueue = next.shuffleQueue;
  if (next.index === null) {
    status.textContent = "顺序播放结束";
    return;
  }
  selectTrack(next.index, { resetShuffle: false });
  await requestPlayback();
});

player.addEventListener("error", () => {
  playbackRequestId += 1;
  autoplayGate.hidden = true;
  playerCard.classList.remove("is-playing");
  void repairAndResumePlayback();
});

async function initializePlayer() {
  try {
    const response = await fetch("tracks.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`播放列表加载失败：${response.status}`);
    }

    const payload = await response.json();
    tracks = payload.tracks;
    if (
      !Array.isArray(tracks) ||
      tracks.length === 0 ||
      tracks.some((track) => !Array.isArray(track.sources) || track.sources.length === 0)
    ) {
      throw new Error("播放列表为空或格式无效");
    }

    renderPlaylist();
    setPlayMode(playMode, { announce: false });
    selectTrack(0);
    await requestPlayback(true);
  } catch (error) {
    status.textContent = error.message;
    subtitle.textContent = "播放器加载失败";
  }
}

initializePlayer();
