import {
  attemptPlayback,
  formatDuration,
} from "./player-logic.js";

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

let tracks = [];
let currentIndex = 0;
let playbackRequestId = 0;

function updatePlaylistSelection() {
  playlist.querySelectorAll("button").forEach((button, index) => {
    button.setAttribute("aria-current", index === currentIndex ? "true" : "false");
  });

  const hasSeveralTracks = tracks.length > 1;
  previousButton.disabled = !hasSeveralTracks;
  nextButton.disabled = !hasSeveralTracks;
}

function selectTrack(index) {
  playbackRequestId += 1;
  currentIndex = (index + tracks.length) % tracks.length;
  const track = tracks[currentIndex];
  title.textContent = track.title;
  subtitle.textContent = `${track.subtitle} · ${track.format} · ${formatDuration(track.duration_seconds)}`;
  document.title = track.title;
  player.src = track.file;
  player.load();
  updatePlaylistSelection();
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

playlist.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) {
    return;
  }
  selectTrack(Number(button.dataset.index));
  await requestPlayback();
});

autoplayGate.addEventListener("click", () => requestPlayback());
previousButton.addEventListener("click", () => changeTrack(-1));
nextButton.addEventListener("click", () => changeTrack(1));

player.addEventListener("playing", () => {
  autoplayGate.hidden = true;
  playerCard.classList.add("is-playing");
  status.textContent = "正在播放";
});

player.addEventListener("waiting", () => {
  status.textContent = "正在缓冲…";
});

player.addEventListener("pause", () => {
  playerCard.classList.remove("is-playing");
  if (!player.ended) {
    status.textContent = "已暂停";
  }
});

player.addEventListener("ended", async () => {
  if (tracks.length > 1) {
    selectTrack(currentIndex + 1);
    await requestPlayback();
  } else {
    status.textContent = "播放结束";
  }
});

player.addEventListener("error", () => {
  playbackRequestId += 1;
  autoplayGate.hidden = true;
  playerCard.classList.remove("is-playing");
  status.textContent = "音频加载失败，请稍后重试";
});

async function initializePlayer() {
  try {
    const response = await fetch("tracks.json");
    if (!response.ok) {
      throw new Error(`播放列表加载失败：${response.status}`);
    }

    const payload = await response.json();
    tracks = payload.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new Error("播放列表为空");
    }

    renderPlaylist();
    selectTrack(0);
    await requestPlayback(true);
  } catch (error) {
    status.textContent = error.message;
    subtitle.textContent = "播放器加载失败";
  }
}

initializePlayer();
