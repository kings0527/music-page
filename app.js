import {
  advancePlayback,
  attemptPlayback,
  formatDuration,
  navigatePlayback,
  shouldHandlePlaybackShortcut,
} from "./player-logic.js";
import { versionedSourceUrl } from "./cache-client.js";
import { createAudioCacheController } from "./cache-controller.js";
import { createLyricsController } from "./lyrics-controller.js";

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
const cacheStatus = document.querySelector("#cache-status");
const masterDownload = document.querySelector("#master-download");
const lyricsContainer = document.querySelector("#lyrics");
const lyricsStatus = document.querySelector("#lyrics-status");

let tracks = [];
let currentIndex = 0;
let playbackRequestId = 0;
let playMode = readStoredMode();
let shuffleQueue = [];
let shuffleHistory = [];
let trackSelectionId = 0;

const lyricsController = createLyricsController({
  container: lyricsContainer,
  status: lyricsStatus,
  media: player,
});
const cacheController = createAudioCacheController({
  status: cacheStatus,
  media: player,
  onPlaybackStatus: (message) => {
    status.textContent = message;
  },
  onResumePlayback: () => {
    void requestPlayback();
  },
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
  shuffleHistory = [];
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

function choosePlayableSource(sources) {
  return (
    sources.find((source) => player.canPlayType(source.type) !== "") ??
    sources[0]
  );
}

function setTrackSources(sources) {
  player.removeAttribute("src");
  const sourceElements = sources.map((source) => {
    const element = document.createElement("source");
    element.src = versionedSourceUrl(source);
    element.type = source.type;
    return element;
  });
  player.replaceChildren(...sourceElements);
  return choosePlayableSource(sources);
}

function prioritizeSource(sources, preferredSource) {
  return [
    preferredSource,
    ...sources.filter((source) => source.sha256 !== preferredSource.sha256),
  ];
}

async function selectTrack(index, { resetShuffle = true } = {}) {
  const selectionId = ++trackSelectionId;
  playbackRequestId += 1;
  currentIndex = (index + tracks.length) % tracks.length;
  if (resetShuffle) {
    shuffleQueue = [];
    shuffleHistory = [];
  }
  const track = tracks[currentIndex];
  title.textContent = track.title;
  subtitle.textContent = `${track.subtitle} · ${track.format} · ${formatDuration(track.duration_seconds)}`;
  document.title = track.title;
  const compressedSource = choosePlayableSource(track.sources);

  masterDownload.href = versionedSourceUrl(track.master);
  masterDownload.download = track.master.file.split("/").at(-1);
  masterDownload.hidden = false;
  updatePlaylistSelection();
  void lyricsController.load(track);

  const initialSource = await cacheController.chooseInitialSource(
    track.master,
    compressedSource,
  );
  if (selectionId !== trackSelectionId) {
    return false;
  }

  const playbackSources = prioritizeSource(
    [...track.sources, track.master],
    initialSource,
  );
  const playbackSource = setTrackSources(playbackSources);
  player.load();
  cacheController.setSources(
    [compressedSource, track.master],
    playbackSource,
  );
  return true;
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

async function changeTrack(direction) {
  if (tracks.length < 2) {
    return;
  }
  const destination = navigatePlayback({
    direction,
    mode: playMode,
    currentIndex,
    trackCount: tracks.length,
    shuffleQueue,
    shuffleHistory,
  });
  if (destination.index === null) {
    return;
  }
  shuffleQueue = destination.shuffleQueue;
  shuffleHistory = destination.shuffleHistory;
  if (await selectTrack(destination.index, { resetShuffle: false })) {
    await requestPlayback();
  }
}

playlist.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) {
    return;
  }
  if (await selectTrack(Number(button.dataset.index))) {
    await requestPlayback();
  }
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setPlayMode(button.dataset.playMode));
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

player.addEventListener("ended", async () => {
  const previousIndex = currentIndex;
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
  if (tracks.length === 1 && next.index === currentIndex) {
    player.currentTime = 0;
    await requestPlayback();
    return;
  }
  if (playMode === "shuffle") {
    shuffleHistory.push(previousIndex);
  }
  if (await selectTrack(next.index, { resetShuffle: false })) {
    await requestPlayback();
  }
});

player.addEventListener("error", () => {
  playbackRequestId += 1;
  autoplayGate.hidden = true;
  playerCard.classList.remove("is-playing");
  void cacheController.repairAndResume();
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
    player.loop = tracks.length === 1;
    setPlayMode(playMode, { announce: false });
    if (await selectTrack(0)) {
      await requestPlayback(true);
    }
  } catch (error) {
    status.textContent = error.message;
    subtitle.textContent = "播放器加载失败";
  }
}

initializePlayer();
