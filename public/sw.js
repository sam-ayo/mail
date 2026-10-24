// The service worker. It keeps copies of the app files and of the pages that
// you open, so the app opens and shows them without a network. It also shows
// push notifications for new mail. app/root.tsx registers it.

// Change a version to drop its cache.
const STATIC_CACHE = "static-v1";
const PAGES_CACHE = "pages-v1";
const CACHES = [STATIC_CACHE, PAGES_CACHE];
const MAX_ENTRIES = { [STATIC_CACHE]: 300, [PAGES_CACHE]: 200 };

// These routes change the session or the server. Never keep copies of them.
const NO_CACHE = /^\/(api|auth|connect|logout)(\/|\.data|$)/;

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>mail</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif;background:#f8faff;color:#18181b;text-align:center;padding:24px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#0d0f18;color:#f4f4f5}}
p{color:#71717a;margin:4px 0 16px}button{font:inherit;border:0;border-radius:8px;padding:8px 14px;background:#6366f1;color:#fff}
</style></head><body><div><h1 style="font-size:20px;margin:0">You are offline</h1>
<p>This page is not saved on this device. Connect to the internet and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!CACHES.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function put(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  // Remove the oldest entries. The cache keeps them in the order they came.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES[cacheName]))) await cache.delete(key);
}

// Hashed files never change, so a saved copy is always correct.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") await put(STATIC_CACHE, request, response.clone());
  return response;
}

// Pages and their data come from the network when it is there. The saved copy is for offline use.
async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await put(PAGES_CACHE, request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, { cacheName: PAGES_CACHE });
    if (cached) return cached;
    if (fallback) return fallback();
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Signing out removes the saved mail and stops notifications on this device.
  // React Router posts the form to /logout.data.
  if (request.method === "POST" && url.origin === location.origin && /^\/logout(\.data)?$/.test(url.pathname)) {
    event.waitUntil(signOutCleanup());
    return;
  }
  if (request.method !== "GET") return;

  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== location.origin || NO_CACHE.test(url.pathname)) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, () => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html" } })),
    );
  } else if (url.pathname.endsWith(".data")) {
    // The route data that React Router loads when you move between pages.
    event.respondWith(networkFirst(request));
  }
});

async function signOutCleanup() {
  await caches.delete(PAGES_CACHE);
  const subscription = await self.registration.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

// The first page loads before the service worker starts. The page sends the
// URLs that it loaded, so they are saved too.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return;
  event.waitUntil(
    Promise.all(
      event.data.urls.map(async (href) => {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin || NO_CACHE.test(url.pathname)) return;
        const assets = url.pathname.startsWith("/assets/");
        if (await caches.match(url, { cacheName: assets ? STATIC_CACHE : PAGES_CACHE })) return;
        const response = await fetch(url).catch(() => null);
        if (response?.ok && !response.redirected) await put(assets ? STATIC_CACHE : PAGES_CACHE, url, response);
      }),
    ),
  );
});

// The types that the browser can show in a notification. It cannot show an SVG.
const ICON_TYPES = /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)$/;

/**
 * The logo of the sender's company, or of the sender, as a data URL. The
 * browser loads a notification icon without the session cookie, so the
 * service worker loads the image. Gives the app icon when there is no logo.
 */
async function senderIcon(email) {
  if (!email) return "/icon-192.png";
  try {
    const response = await fetch(`/api/avatar?email=${encodeURIComponent(email)}`, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(4000),
    });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !ICON_TYPES.test(type)) return "/icon-192.png";
    let binary = "";
    for (const byte of new Uint8Array(await response.arrayBuffer())) binary += String.fromCharCode(byte);
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return "/icon-192.png";
  }
}

// The payload comes from app/server/push.server.ts.
self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {};
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title || "New mail", {
        body: payload.body || "",
        tag: payload.tag,
        icon: await senderIcon(payload.sender),
        badge: "/icon-192.png",
        data: { url: payload.url || "/mail" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/mail", location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === location.origin);
      if (open) {
        await open.focus();
        // The page moves with the router, so the app does not load again. See app/root.tsx.
        open.postMessage({ type: "open-url", url });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
