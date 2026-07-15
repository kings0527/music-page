export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  await navigator.serviceWorker.register(
    new URL("./service-worker.js", import.meta.url),
    { type: "module", updateViaCache: "none" },
  );
  return navigator.serviceWorker.ready;
}

export function sendServiceWorkerMessage(registration, message, timeoutMs = 180000) {
  const worker =
    registration?.active ?? registration?.waiting ?? registration?.installing;
  if (!worker) {
    return Promise.reject(new Error("离线缓存服务尚未就绪"));
  }

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("离线缓存操作超时"));
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok) {
        resolve(event.data);
      } else {
        reject(new Error(event.data?.error ?? "离线缓存操作失败"));
      }
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export function versionedSourceUrl(source, baseUrl = document.baseURI) {
  const url = new URL(source.file, baseUrl);
  url.searchParams.set("v", source.sha256.slice(0, 16));
  return url.href;
}
