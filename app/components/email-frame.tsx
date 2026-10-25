import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { useTheme } from "~/components/theme";

// The server render has no layout. useLayoutEffect there only gives a warning.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// The last measured height of each email. A frame that shows the same email
// again starts at that height, so the page does not jump while it loads.
const heights = new Map<string, number>();
const HEIGHT_LIMIT = 200;

function rememberHeight(html: string, height: number) {
  heights.delete(html);
  heights.set(html, height);
  if (heights.size > HEIGHT_LIMIT) heights.delete(heights.keys().next().value!);
}

// Proxy URLs that got a 403. A reload of the conversation gives new URLs, so
// a URL that fails again after a reload does not start one more reload.
const badSignatures = new Set<string>();
let lastReload = 0;
const RELOAD_GAP_MS = 10_000;

/**
 * Loads a failed proxy image one more time. The CDN or the browser can keep
 * an old failure for the original URL. The proxy ignores the "retry"
 * parameter, but the caches see a different URL, so the server fetches the
 * image again. A 403 tells that the signature in the URL is old, for example
 * after a change of SESSION_SECRET. Then the conversation loads again from
 * the server, and the new HTML has new signatures.
 *
 * Returns the URL to show, or null if the image stays failed.
 */
async function retryProxyUrl(src: string, reload: () => void) {
  const retry = `${src}&retry=1`;
  const response = await fetch(retry).catch(() => null);
  // The browser cache keeps the response, so the image loads with no second request.
  if (response?.ok) return retry;
  if (response?.status === 403 && !badSignatures.has(src)) {
    badSignatures.add(src);
    if (Date.now() - lastReload >= RELOAD_GAP_MS) {
      lastReload = Date.now();
      reload();
    }
  }
  return null;
}

// A proxy URL in a "background" attribute, a "style" attribute, or a <style>
// tag. The sanitizer encodes the remote URL, so it has no "&", quote, or
// space. The signature always has 22 characters. See image-proxy.server.ts.
const CSS_PROXY_URL = /\/api\/image\?url=[^&"\s]*&s=[\w-]{22}/g;

/**
 * Retries the failed images of an email: <img> tags and CSS backgrounds.
 * WebKit runs no event listener in a frame without "allow-scripts", and a
 * browser gives no error event for a CSS image. So an Image object in this
 * page loads each proxy URL too. The browser cache keeps a good image, so
 * that load sends no second request.
 *
 * The server does not keep a failure, so the probe can load an image that
 * failed in the frame. The browser does not load a failed image again by
 * itself, so the email gets the URL with a "#loaded" fragment. The browser
 * cache ignores the fragment, so the image comes from the copy of the probe.
 * If the probe fails too, the email gets the retry URL.
 */
function retryFailedImages(doc: Document, reload: () => void) {
  const images = [...doc.querySelectorAll("img")];
  const elements = [...doc.querySelectorAll("[background], [style]")];
  const styles = [...doc.querySelectorAll("style")];
  const urls = new Set<string>();
  for (const img of images) {
    const src = img.getAttribute("src");
    if (src?.startsWith("/api/image?")) urls.add(src);
  }
  for (const element of elements) {
    for (const name of ["background", "style"]) {
      for (const url of element.getAttribute(name)?.match(CSS_PROXY_URL) ?? []) urls.add(url);
    }
  }
  for (const style of styles) {
    for (const url of style.textContent?.match(CSS_PROXY_URL) ?? []) urls.add(url);
  }

  function replace(url: string, next: string) {
    for (const img of images) {
      // An <img> with a size has loaded. A new URL would only load it again.
      if (img.getAttribute("src") === url && img.naturalWidth === 0) img.src = next;
    }
    for (const element of elements) {
      for (const name of ["background", "style"]) {
        const value = element.getAttribute(name);
        if (value?.includes(url)) element.setAttribute(name, value.replaceAll(url, next));
      }
    }
    for (const style of styles) {
      if (style.textContent?.includes(url)) style.textContent = style.textContent.replaceAll(url, next);
    }
  }

  for (const url of urls) {
    const probe = new Image();
    // The same policy as the email frame, so senders get no referrer.
    probe.referrerPolicy = "no-referrer";
    probe.addEventListener("load", () => replace(url, `${url}#loaded`));
    probe.addEventListener("error", async () => {
      const retry = await retryProxyUrl(url, reload);
      if (retry) replace(url, retry);
    });
    probe.src = url;
  }
}

/**
 * Shows sanitized email HTML in a sandboxed iframe. The sandbox blocks
 * scripts and forms. "allow-same-origin" lets the parent write the email into
 * the frame, measure the height, and toggle quoted text. Without
 * "allow-scripts", the frame cannot run code.
 */
export function EmailFrame({
  html,
  showQuotes,
  title,
}: {
  html: string;
  showQuotes: boolean;
  title: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  // The first height only. After that, measure() writes the height to the
  // frame directly. A width animation changes the height on each frame, and
  // a React render on each frame drops frames.
  const [height] = useState(() => heights.get(html) ?? 120);
  const showQuotesRef = useRef(showQuotes);
  showQuotesRef.current = showQuotes;
  // The conversation on the screen always loads from the server. See app/routes/mail.thread.tsx.
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  const { dark } = useTheme();

  // Write the email before the browser paints. "srcDoc" loads after a delay,
  // and the frame shows empty until then.
  useIsomorphicLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    let written: Document | null = null;

    const reload = () => revalidateRef.current();

    function measure() {
      const doc = frame?.contentDocument;
      if (!doc?.body) return;
      // Some emails have a fixed width, often 600px. Scale them down to the
      // frame width, so they do not scroll horizontally. A transform does
      // not change the layout size of the body, so the sizes below are the
      // unscaled sizes.
      const body = doc.body;
      const scale = Math.min(1, doc.documentElement.clientWidth / body.scrollWidth);
      body.style.transformOrigin = "0 0";
      body.style.transform = scale < 1 ? `scale(${scale})` : "";
      // Measure the body, not the document. The document is never shorter
      // than the frame, so the frame could only grow and never shrink.
      const next = Math.ceil(body.scrollHeight * scale) + 2;
      frame!.style.height = `${next}px`;
      rememberHeight(html, next);
    }

    function write() {
      const doc = frame?.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(html);
      doc.close();
      written = doc;
      doc.body.classList.toggle("hide-quotes", !showQuotesRef.current);
      // Read the class, not "dark". On hydration, "dark" is false for one render.
      doc.documentElement.classList.toggle("dark", document.documentElement.classList.contains("dark"));
      measure();
      observer?.disconnect();
      observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      // Images change the height after they load.
      doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
      retryFailedImages(doc, reload);
    }

    // Some browsers load "about:blank" into a new frame after a delay, and
    // that removes the email. Write it again if that occurs.
    function onLoad() {
      if (frame?.contentDocument !== written) write();
    }

    write();
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [html]);

  useEffect(() => {
    const body = ref.current?.contentDocument?.body;
    body?.classList.toggle("hide-quotes", !showQuotes);
  }, [showQuotes]);

  useEffect(() => {
    ref.current?.contentDocument?.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block w-full rounded-lg bg-white dark:bg-transparent"
      // The light scheme makes "prefers-color-scheme" light in the frame, so
      // the dark styles of the email do not apply. See BASE_STYLES. The frame
      // and its document use the same scheme, so the frame can be transparent.
      style={{ height, colorScheme: "light" }}
    />
  );
}
