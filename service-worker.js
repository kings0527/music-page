import { cacheMetadataMatches, parseByteRange } from "./cache-logic.js";

const SHELL_CACHE = "music-shell-v3";
const AUDIO_CACHE = "music-audio-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./player-logic.js",
  "./lyrics-timeline.js",
  "./lyrics-controller.js",
  "./cache-client.js",
  "./cache-logic.js",
  "./cache-controller.js",
  "./tracks.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    warmShellCache().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith("music-shell-") && name !== SHELL_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.includes("/audio/")) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

self.addEventListener("message", (event) => {
  const reply = (payload) => event.ports[0]?.postMessage(payload);
  event.waitUntil(handleMessage(event.data).then(reply, (error) => reply({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })));
});

async function warmShellCache() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL_FILES);
  const manifestUrl = new URL("./tracks.json", self.registration.scope);
  const response = await fetch(manifestUrl, { cache: "reload" });
  if (!response.ok) {
    return;
  }
  await cache.put(manifestUrl, response.clone());
  const manifest = await response.json();
  const lyricUrls = manifest.tracks
    .map((track) => track.lyrics)
    .filter(Boolean)
    .map((path) => new URL(path, self.registration.scope));
  await Promise.all(
    lyricUrls.map(async (url) => {
      try {
        const lyricResponse = await fetch(url, { cache: "reload" });
        if (lyricResponse.ok) {
          await cache.put(url, lyricResponse);
        }
      } catch {
        // One optional lyric file must not prevent the player shell installing.
      }
    }),
  );
}

async function handleMessage(message) {
  switch (message?.type) {
    case "CACHE_TRACK":
      return cacheTrack(message);
    case "CHECK_TRACK":
      return checkTrack(message);
    default:
      throw new Error("未知的离线缓存操作");
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      const fallback = await cache.match("./");
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}

async function handleAudioRequest(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete("music-reload");
  const cached = await cache.match(cacheUrl.href);
  if (!cached) {
    return fetch(request);
  }

  const rangeHeader = request.headers.get("Range");
  if (!rangeHeader) {
    return cached;
  }

  const blob = await cached.blob();
  const range = parseByteRange(rangeHeader, blob.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${blob.size}` },
    });
  }

  const headers = new Headers(cached.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${blob.size}`);
  return new Response(blob.slice(range.start, range.end + 1, blob.type), {
    status: 206,
    headers,
  });
}

function validateMessageTrack(message) {
  const url = new URL(message.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.includes("/audio/") ||
    !Number.isInteger(message.bytes) ||
    message.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(message.sha256)
  ) {
    throw new Error("缓存音频信息无效");
  }
  return url;
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function cachedTrackIsValid(cached, expected) {
  if (!cached) {
    return false;
  }
  const metadata = {
    bytes: cached.headers.get("X-Music-Bytes"),
    sha256: cached.headers.get("X-Music-SHA256"),
  };
  if (!cacheMetadataMatches(expected, metadata)) {
    return false;
  }
  const buffer = await cached.clone().arrayBuffer();
  return buffer.byteLength === expected.bytes &&
    (await sha256Hex(buffer)) === expected.sha256;
}

async function checkTrack(message) {
  const url = validateMessageTrack(message);
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(url.href);
  const expected = { bytes: message.bytes, sha256: message.sha256 };
  const valid = await cachedTrackIsValid(cached, expected);
  const repairRequired = Boolean(cached && !valid);
  if (cached && !valid) {
    await cache.delete(url.href);
  }
  return {
    ok: true,
    cached: valid,
    bytes: valid ? message.bytes : 0,
    repairRequired,
  };
}

async function cacheTrack(message) {
  const url = validateMessageTrack(message);
  const cache = await caches.open(AUDIO_CACHE);
  const expected = { bytes: message.bytes, sha256: message.sha256 };
  const existing = await cache.match(url.href);
  if (!message.force && (await cachedTrackIsValid(existing, expected))) {
    return { ok: true, cached: true, bytes: message.bytes };
  }

  const response = await fetch(url.href, { cache: "reload" });
  if (!response.ok) {
    throw new Error(`重新下载失败：HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== message.bytes) {
    throw new Error("重新下载的音频大小不完整");
  }
  if ((await sha256Hex(buffer)) !== message.sha256) {
    throw new Error("重新下载的音频校验失败");
  }

  const headers = new Headers(response.headers);
  headers.delete("Content-Range");
  headers.set("Content-Length", String(message.bytes));
  headers.set("X-Music-Bytes", String(message.bytes));
  headers.set("X-Music-SHA256", message.sha256);
  await cache.put(url.href, new Response(buffer, { status: 200, headers }));

  for (const request of await cache.keys()) {
    const cachedUrl = new URL(request.url);
    if (cachedUrl.pathname === url.pathname && cachedUrl.href !== url.href) {
      await cache.delete(request);
    }
  }
  return { ok: true, cached: true, bytes: message.bytes };
}
