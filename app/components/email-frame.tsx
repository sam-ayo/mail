import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const { dark } = useTheme();

  // Write the email before the browser paints. "srcDoc" loads after a delay,
  // and the frame shows empty until then.
  useIsomorphicLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    let written: Document | null = null;

    function measure() {
      const doc = frame?.contentDocument;
      if (!doc?.body) return;
      // Measure the body, not the document. The document is never shorter
      // than the frame, so the frame could only grow and never shrink.
      const next = Math.ceil(doc.body.scrollHeight) + 2;
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
      className="block w-full rounded-lg bg-white dark:bg-zinc-900"
      style={{ height }}
    />
  );
}
