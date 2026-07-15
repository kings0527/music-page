import { findActiveCueIndex } from "./lyrics-timeline.js";

export function createLyricsController({ container, status, media }) {
  let cues = [];
  let activeIndex = -2;
  let requestId = 0;

  function showPlaceholder(message) {
    const placeholder = document.createElement("p");
    placeholder.className = "lyrics-placeholder";
    placeholder.textContent = message;
    container.replaceChildren(placeholder);
  }

  function render(nextCues) {
    const fragment = document.createDocumentFragment();
    nextCues.forEach((cue, index) => {
      const line = document.createElement("p");
      line.className = "lyric-line";
      line.dataset.lyricIndex = String(index);
      line.textContent = cue.text;
      fragment.append(line);
    });
    container.replaceChildren(fragment);
  }

  function describeGap(currentTime) {
    if (cues.length === 0) {
      return "暂无歌词";
    }
    if (currentTime < cues[0].start) {
      return "前奏";
    }
    if (currentTime >= cues.at(-1).end) {
      return "尾奏";
    }
    return "间奏";
  }

  function update(currentTime) {
    const nextIndex = findActiveCueIndex(cues, currentTime);
    if (nextIndex === activeIndex) {
      if (nextIndex < 0) {
        status.textContent = describeGap(currentTime);
      }
      return;
    }

    if (activeIndex >= 0) {
      container
        .querySelector(`[data-lyric-index="${activeIndex}"]`)
        ?.removeAttribute("aria-current");
    }
    activeIndex = nextIndex;

    if (nextIndex < 0) {
      status.textContent = describeGap(currentTime);
      return;
    }

    status.textContent = `${nextIndex + 1} / ${cues.length}`;
    const activeLine = container.querySelector(
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

  async function load(track) {
    const currentRequestId = ++requestId;
    cues = [];
    activeIndex = -2;
    status.textContent = "正在加载…";
    showPlaceholder("歌词正在加载…");

    if (!track.lyrics) {
      status.textContent = "暂无歌词";
      showPlaceholder("这首歌暂无同步歌词");
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
      if (currentRequestId !== requestId) {
        return;
      }
      cues = timeline.cues;
      render(cues);
      activeIndex = -2;
      update(media.currentTime);
    } catch (error) {
      if (currentRequestId !== requestId) {
        return;
      }
      status.textContent = "加载失败";
      showPlaceholder(error.message);
    }
  }

  media.addEventListener("timeupdate", () => update(media.currentTime));
  media.addEventListener("seeking", () => update(media.currentTime));
  media.addEventListener("loadedmetadata", () => update(media.currentTime));

  return { load };
}
