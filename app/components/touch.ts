import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// Touch gestures for phones, as in the iOS Mail app. A web app on the Home
// Screen has no browser back gesture and no pull-to-refresh, so the app makes
// its own. The gestures change the style of the elements directly. A React
// render on each touch move would make them slow.

/** The curve of iOS navigation pushes and sheets. */
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DURATION = 320;

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below lg, one pane shows at a time: the list, or a conversation over it. */
export const SINGLE_PANE = "(max-width: 63.99rem)";

/** Moves an element with a transition, then calls `done`. */
function slide(element: HTMLElement, transform: string, done?: () => void) {
  element.style.transition = `transform ${DURATION}ms ${EASE}`;
  element.style.transform = transform;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    element.removeEventListener("transitionend", finish);
    done?.();
  };
  element.addEventListener("transitionend", finish);
  // A transition to the same position sends no transitionend event.
  setTimeout(finish, DURATION + 50);
}

function clearStyle(element: HTMLElement | null) {
  if (!element) return;
  element.style.transition = "";
  element.style.transform = "";
}

/**
 * A pane that slides in from the right, as a pushed screen in iOS. A swipe
 * from the left edge drags it back out, and `back` slides it out. The pane
 * stays out of view until `reset`, so it does not show again while the route
 * changes.
 */
export function usePaneSwipeBack(options: { enabled: boolean; onBack(): void }) {
  const pane = useRef<HTMLDivElement>(null);
  const { enabled, onBack } = options;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const closing = useRef(false);

  const back = useCallback(() => {
    const element = pane.current;
    if (!element || closing.current) return;
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onBackRef.current();
      return;
    }
    closing.current = true;
    slide(element, "translateX(100%)", () => onBackRef.current());
  }, [enabled]);

  const reset = useCallback(() => {
    closing.current = false;
    clearStyle(pane.current);
  }, []);

  useEffect(() => {
    const element = pane.current;
    if (!element || !enabled) return;
    let start: { x: number; y: number; time: number } | null = null;
    let dragging = false;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      // The edge of the screen only. A swipe on the content scrolls it.
      if (event.touches.length !== 1 || touch.clientX > 28 || closing.current) return;
      start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      dragging = false;
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dx <= Math.abs(dy)) {
          start = null;
          return;
        }
        dragging = true;
        element.style.transition = "none";
      }
      event.preventDefault();
      element.style.transform = `translateX(${Math.max(0, dx)}px)`;
    };
    const onEnd = (event: TouchEvent) => {
      if (!start || !dragging) {
        start = null;
        return;
      }
      const dx = (event.changedTouches[0]?.clientX ?? start.x) - start.x;
      const speed = dx / Math.max(1, event.timeStamp - start.time);
      start = null;
      dragging = false;
      if (dx > element.offsetWidth * 0.35 || (speed > 0.5 && dx > 30)) {
        closing.current = true;
        slide(element, "translateX(100%)", () => onBackRef.current());
      } else {
        slide(element, "translateX(0px)", () => clearStyle(element));
      }
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return { pane, back, reset };
}

/** How far the content moves for a pull. The content moves less than the finger. */
function resist(distance: number) {
  return Math.min(120, distance * 0.5);
}

const REFRESH_DISTANCE = 64;
const REFRESH_HOLD = 52;

/**
 * Pull down at the top of a list to refresh it. `scroller` is the element
 * that scrolls. `indicator` shows above it and turns as the finger moves.
 */
export function usePullToRefresh(options: {
  scroller: HTMLElement | null;
  indicator: React.RefObject<HTMLElement | null>;
  refreshing: boolean;
  onRefresh(): void;
}) {
  const { scroller, indicator, refreshing, onRefresh } = options;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const holding = useRef(false);

  const place = useCallback(
    (distance: number, animate: boolean, done?: () => void) => {
      const icon = indicator.current;
      if (!scroller || !icon) return;
      const progress = Math.min(1, distance / REFRESH_DISTANCE);
      icon.style.opacity = String(progress);
      icon.style.setProperty("--pull-turn", `${distance * 4}deg`);
      if (animate) slide(scroller, `translateY(${distance}px)`, done);
      else {
        scroller.style.transition = "none";
        scroller.style.transform = distance ? `translateY(${distance}px)` : "";
      }
    },
    [scroller, indicator],
  );

  // The list stays down while it loads, then goes back up.
  useEffect(() => {
    if (refreshing || !holding.current || !scroller) return;
    holding.current = false;
    indicator.current?.removeAttribute("data-refreshing");
    place(0, true, () => clearStyle(scroller));
  }, [refreshing, scroller, indicator, place]);

  useEffect(() => {
    if (!scroller) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || scroller.scrollTop > 0 || holding.current) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      pulling = false;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!pulling) {
        if (Math.abs(dy) < 6) return;
        // A swipe up or to the side is a normal scroll or a row swipe.
        if (dy < 0 || Math.abs(dx) > dy || scroller.scrollTop > 0) {
          start = null;
          return;
        }
        pulling = true;
      }
      event.preventDefault();
      distance = resist(Math.max(0, dy));
      place(distance, false);
    };
    const onEnd = () => {
      if (!start || !pulling) {
        start = null;
        return;
      }
      start = null;
      pulling = false;
      if (distance >= REFRESH_DISTANCE * 0.8) {
        holding.current = true;
        indicator.current?.setAttribute("data-refreshing", "");
        place(REFRESH_HOLD, true);
        onRefreshRef.current();
      } else {
        place(0, true, () => clearStyle(scroller));
      }
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: false });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onEnd);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
    };
  }, [scroller, indicator, place]);
}

/**
 * Swipe a row to the side to act on it, as in iOS Mail. A swipe to the left
 * runs `onLeft` and a swipe to the right runs `onRight`. `removes` tells if
 * the action takes the row out of the list. Then the row slides out first.
 * The returned handler stops the click that ends a swipe.
 */
export function useRowSwipe(options: {
  content: React.RefObject<HTMLElement | null>;
  row: React.RefObject<HTMLElement | null>;
  left?: { removes: boolean; run(): void };
  right?: { removes: boolean; run(): void };
}) {
  const latest = useRef(options);
  latest.current = options;
  const swiped = useRef(false);

  useEffect(() => {
    const row = options.row.current;
    if (!row) return;
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let dx = 0;

    const content = () => latest.current.content.current;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      dragging = false;
      swiped.current = false;
      dx = 0;
    };
    const onMove = (event: TouchEvent) => {
      const element = content();
      if (!start || !element) return;
      const x = event.touches[0].clientX - start.x;
      const y = event.touches[0].clientY - start.y;
      if (!dragging) {
        if (Math.abs(x) < 10 && Math.abs(y) < 10) return;
        // A mostly vertical move is a scroll.
        if (Math.abs(x) < Math.abs(y) * 1.2) {
          start = null;
          return;
        }
        dragging = true;
        swiped.current = true;
        element.style.transition = "none";
      }
      const { left, right } = latest.current;
      dx = x < 0 ? (left ? x : 0) : right ? x : 0;
      row.dataset.swipe = dx < 0 ? "left" : dx > 0 ? "right" : "";
      const width = row.offsetWidth;
      const done = Math.abs(dx) > width * 0.35;
      row.toggleAttribute("data-swipe-ready", done);
      element.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      const element = content();
      if (!start || !dragging || !element) {
        start = null;
        return;
      }
      start = null;
      dragging = false;
      const action = dx < 0 ? latest.current.left : latest.current.right;
      const done = action && Math.abs(dx) > row.offsetWidth * 0.35;
      const settle = () => {
        clearStyle(element);
        delete row.dataset.swipe;
        row.removeAttribute("data-swipe-ready");
      };
      if (done && action.removes) {
        slide(element, `translateX(${dx < 0 ? "-100%" : "100%"})`, () => {
          action.run();
          // The list removes the row. A row that stays comes back.
          requestAnimationFrame(settle);
        });
      } else {
        slide(element, "translateX(0px)", settle);
        if (done) action.run();
      }
    };

    row.addEventListener("touchstart", onStart, { passive: true });
    row.addEventListener("touchmove", onMove, { passive: true });
    row.addEventListener("touchend", onEnd);
    row.addEventListener("touchcancel", onEnd);
    return () => {
      row.removeEventListener("touchstart", onStart);
      row.removeEventListener("touchmove", onMove);
      row.removeEventListener("touchend", onEnd);
      row.removeEventListener("touchcancel", onEnd);
    };
    // The row element stays the same for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (event: React.MouseEvent) => {
    if (!swiped.current) return;
    swiped.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
}
