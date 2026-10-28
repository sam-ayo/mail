import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";

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

/** The list under a pushed pane moves left by this part of its width, as in iOS. */
const UNDER_SHIFT = 0.3;

/**
 * Moves a value with a spring, from its current position and speed. A spring
 * has no fixed duration, so a fast swipe ends fast and a slow one ends slowly.
 * `response` is in seconds. The returned function stops the spring.
 */
function spring(options: {
  from: number;
  to: number;
  velocity: number;
  response?: number;
  damping?: number;
  /** The spring stops this near its target, in px. */
  rest?: number;
  onUpdate(value: number): void;
  onDone(): void;
}) {
  const { from, to, onUpdate, onDone, response = 0.4, damping = 1, rest = 0.5 } = options;
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let value = from;
  let velocity = options.velocity;
  let last = performance.now();
  let frame = 0;
  const step = (now: number) => {
    // Small steps keep the spring stable when a frame comes late.
    let time = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (time > 0) {
      const dt = Math.min(time, 1 / 240);
      velocity += (-stiffness * (value - to) - friction * velocity) * dt;
      value += velocity * dt;
      time -= dt;
    }
    if (Math.abs(value - to) < rest && Math.abs(velocity) < 40 * rest) {
      onUpdate(to);
      onDone();
      return;
    }
    onUpdate(value);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** Where a swipe that ends at this speed, in px/s, would stop by itself. */
function project(velocity: number) {
  const deceleration = 0.998;
  return ((velocity / 1000) * deceleration) / (1 - deceleration);
}

/** The colour behind an element: its own, or that of the first parent with one. */
function backgroundOf(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return "";
}

/**
 * A pane that slides in from the right, as a pushed screen in iOS. A swipe
 * from the left edge drags it back out, and `back` slides it out. The pane
 * stays out of view until `reset`, so it does not show again while the route
 * changes. The `under` element moves and the `dim` element fades with the
 * pane. Their styles give their positions while the pane is open.
 */
export function usePaneSwipeBack(options: {
  enabled: boolean;
  onBack(): void;
  under?: React.RefObject<HTMLElement | null>;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const { enabled, onBack, under } = options;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const closing = useRef(false);
  const offset = useRef(0);
  const stop = useRef<(() => void) | null>(null);

  // Puts the pane `x` px to the right, and the list and the dim in proportion.
  const place = useCallback(
    (x: number) => {
      const element = pane.current;
      if (!element) return;
      offset.current = x;
      const progress = Math.min(1, x / element.offsetWidth);
      element.style.transition = "none";
      element.style.transform = `translateX(${x}px)`;
      const list = under?.current;
      if (list) {
        list.style.transition = "none";
        list.style.transform = `translateX(${-UNDER_SHIFT * element.offsetWidth * (1 - progress)}px)`;
      }
      if (dim.current) {
        dim.current.style.transition = "none";
        dim.current.style.opacity = String(1 - progress);
      }
    },
    [under],
  );

  const clear = useCallback(() => {
    stop.current?.();
    stop.current = null;
    offset.current = 0;
    for (const element of [pane.current, under?.current, dim.current]) {
      if (!element) continue;
      element.style.transition = element.style.transform = element.style.opacity = "";
    }
  }, [under]);

  // Moves the pane out, or back in, at the speed of the finger.
  const release = useCallback(
    (velocity: number, out: boolean) => {
      const element = pane.current;
      if (!element) return;
      stop.current?.();
      closing.current = out;
      stop.current = spring({
        from: offset.current,
        to: out ? element.offsetWidth : 0,
        velocity,
        // Past the edge, the last px do not show. The list comes back sooner.
        rest: out ? 4 : 0.5,
        // A pane that goes back in stops at its place, without a bounce past it.
        onUpdate: (x) => place(out ? x : Math.max(0, x)),
        onDone: () => {
          stop.current = null;
          if (out) onBackRef.current();
          else clear();
        },
      });
    },
    [place, clear],
  );

  const back = useCallback(() => {
    if (!pane.current || closing.current) return;
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onBackRef.current();
      return;
    }
    release(0, true);
  }, [enabled, release]);

  const reset = useCallback(() => {
    closing.current = false;
    clear();
  }, [clear]);

  useEffect(() => {
    const element = pane.current;
    if (!element || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    // The last positions of the finger, to get its speed at the release.
    let history: { x: number; time: number }[] = [];

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      // The edge of the screen only. A swipe on the content scrolls it. A
      // pane that moves back in can be caught again at its edge.
      if (event.touches.length !== 1 || closing.current) return;
      if (touch.clientX > offset.current + 28) return;
      start = { x: touch.clientX, y: touch.clientY };
      dragging = false;
      history = [{ x: touch.clientX, time: event.timeStamp }];
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dx <= Math.abs(dy) && !stop.current) {
          start = null;
          return;
        }
        dragging = true;
        // The finger holds the pane where it is now. The drag continues from
        // there, so the pane does not jump to the finger.
        stop.current?.();
        stop.current = null;
        start.x = touch.clientX - offset.current;
      }
      event.preventDefault();
      history.push({ x: touch.clientX, time: event.timeStamp });
      while (history.length > 2 && event.timeStamp - history[0].time > 100) history.shift();
      place(Math.max(0, touch.clientX - start.x));
    };
    const onEnd = (event: TouchEvent) => {
      if (!start || !dragging) {
        start = null;
        return;
      }
      start = null;
      dragging = false;
      const first = history[0];
      const lastX = event.changedTouches[0]?.clientX ?? history[history.length - 1].x;
      const elapsed = event.timeStamp - first.time;
      const velocity = elapsed > 0 ? ((lastX - first.x) / elapsed) * 1000 : 0;
      // The pane goes to where the swipe would take it. A finger that moves
      // back to the left at the end keeps the pane open.
      const out = velocity > -100 && offset.current + project(velocity) > element.offsetWidth / 2;
      release(velocity, out);
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
  }, [enabled, place, release]);

  useEffect(() => () => stop.current?.(), []);

  return { pane, dim, back, reset };
}

/**
 * A copy of a page over the screen, with a dim layer under it. The page
 * hides. The copy moves with the finger while the next page loads and shows
 * under it. The parent of the page moves and dims with the copy, as the list
 * under a pushed screen in iOS.
 */
function pageCopy(page: HTMLElement) {
  const rect = page.getBoundingClientRect();
  const box = {
    position: "fixed",
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
  const dim = document.createElement("div");
  dim.className = "pointer-events-none bg-black/10 dark:bg-black/40";
  Object.assign(dim.style, { ...box, zIndex: "49" });
  const copy = page.cloneNode(true) as HTMLElement;
  copy.inert = true;
  Object.assign(copy.style, {
    ...box,
    zIndex: "50",
    background: backgroundOf(page),
    boxShadow: "-1px 0 16px rgb(0 0 0 / 0.12)",
    transition: "none",
  });
  document.body.append(dim, copy);
  copy.scrollTop = page.scrollTop;
  page.style.visibility = "hidden";
  const under = page.parentElement;
  return {
    page,
    width: rect.width,
    scrollTop: page.scrollTop,
    x: 0,
    place(x: number) {
      this.x = x;
      const progress = Math.min(1, x / rect.width);
      copy.style.transform = `translateX(${x}px)`;
      dim.style.opacity = String(1 - progress);
      if (under) {
        under.style.transition = "none";
        under.style.transform = `translateX(${-UNDER_SHIFT * rect.width * (1 - progress)}px)`;
      }
    },
    remove() {
      copy.remove();
      dim.remove();
      if (under) under.style.transition = under.style.transform = "";
    },
  };
}

/** The copy of a page that a swipe moved back in. It goes when the page shows again. */
let returning: ReturnType<typeof pageCopy> | null = null;

/**
 * A swipe from the left edge goes back from a page to `to`, as the back
 * gesture in iOS. The next page loads at the start of the swipe and shows
 * under a copy of this page. A swipe that does not go far enough comes back
 * to this page.
 */
export function usePageSwipeBack(options: { enabled: boolean; to: string }) {
  const { enabled, to } = options;
  const page = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  // After a swipe that came back, the copy stays until this page shows again.
  useLayoutEffect(() => {
    if (!returning || location.pathname !== path) return;
    const element = page.current;
    if (element && element !== returning.page) element.scrollTop = returning.scrollTop;
    returning.page.style.visibility = "";
    returning.remove();
    returning = null;
  }, [location.key, location.pathname, path]);

  useEffect(() => {
    const element = page.current;
    if (!element || !enabled) return;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.clientX > 28 || returning) return;
      // The page unmounts during the swipe, so the listeners are on the
      // element under the finger. A touch keeps its element after the element
      // leaves the page.
      const target = event.target as EventTarget;
      const start = { x: touch.clientX, y: touch.clientY };
      let history = [{ x: touch.clientX, time: event.timeStamp }];
      let copy: ReturnType<typeof pageCopy> | null = null;

      const stopListening = () => {
        target.removeEventListener("touchmove", onMove);
        target.removeEventListener("touchend", onEnd);
        target.removeEventListener("touchcancel", onEnd);
      };
      const onMove = (event: Event) => {
        const touch = (event as TouchEvent).touches[0];
        if (!copy) {
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (dx <= Math.abs(dy)) {
            stopListening();
            return;
          }
          // The copy starts where the page is, so it does not jump to the finger.
          start.x = touch.clientX;
          copy = pageCopy(element);
          copy.place(0);
          navigate(to);
        }
        event.preventDefault();
        history.push({ x: touch.clientX, time: event.timeStamp });
        while (history.length > 2 && event.timeStamp - history[0].time > 100) history.shift();
        copy.place(Math.max(0, touch.clientX - start.x));
      };
      const onEnd = (event: Event) => {
        stopListening();
        const moving = copy;
        if (!moving) return;
        const first = history[0];
        const lastX = (event as TouchEvent).changedTouches[0]?.clientX ?? history[history.length - 1].x;
        const elapsed = event.timeStamp - first.time;
        const velocity = elapsed > 0 ? ((lastX - first.x) / elapsed) * 1000 : 0;
        const out = velocity > -100 && moving.x + project(velocity) > moving.width / 2;
        spring({
          from: moving.x,
          to: out ? moving.width : 0,
          velocity,
          rest: out ? 4 : 0.5,
          onUpdate: (x) => moving.place(out ? x : Math.max(0, x)),
          onDone: () => {
            if (out) {
              moving.remove();
              return;
            }
            returning = moving;
            // Before the next page shows, a move to this page stops its load.
            // After, the page comes back from the history.
            if (window.location.pathname === path) navigate(path, { replace: true });
            else navigate(-1);
            // The copy does not stay if this page does not show again.
            setTimeout(() => {
              if (returning !== moving) return;
              moving.page.style.visibility = "";
              moving.remove();
              returning = null;
            }, 5000);
          },
        });
      };
      target.addEventListener("touchmove", onMove, { passive: false });
      target.addEventListener("touchend", onEnd);
      target.addEventListener("touchcancel", onEnd);
    };
    element.addEventListener("touchstart", onStart, { passive: true });
    return () => element.removeEventListener("touchstart", onStart);
  }, [enabled, navigate, path, to]);

  return page;
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

/** iOS sheets move more slowly than pushed screens. */
const SHEET_DURATION = 500;
/** The page behind a sheet gets this much narrower, in px, as in Vaul. */
const PAGE_INSET = 26;
const PAGE_RADIUS = 8;

/** Calls `done` once, after the transform transition of `element`. */
function afterTransition(element: HTMLElement, duration: number, done: () => void) {
  let finished = false;
  const finish = (event?: TransitionEvent) => {
    if (finished || (event && (event.target !== element || event.propertyName !== "transform"))) return;
    finished = true;
    element.removeEventListener("transitionend", finish);
    done();
  };
  element.addEventListener("transitionend", finish);
  // A transition to the same position sends no transitionend event.
  setTimeout(finish, duration + 50);
}

/**
 * A sheet that slides up over the page, as a new message in iOS Messages. The
 * page behind it (the element with `data-sheet-page`) gets smaller and moves
 * back. A swipe down on `handle` drags the sheet down. A long or fast swipe
 * calls `onDismiss`. When `open` changes to false, the sheet slides down, then
 * the hook calls `onClosed`. When `enabled` is false, the hook does nothing.
 */
export function useSheet(options: { enabled: boolean; open: boolean; onDismiss(): void; onClosed(): void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const { enabled, open } = options;
  const latest = useRef(options);
  latest.current = options;
  const moves = useRef(0);

  // `amount` is 1 when the sheet is open and 0 when it is closed. The page
  // changes in proportion, so a drag moves the page back to its place too.
  const pose = useCallback((amount: number, animate: boolean, done?: () => void) => {
    const element = sheet.current;
    const page = document.querySelector<HTMLElement>("[data-sheet-page]");
    if (!element) return;
    const transition = animate ? `${SHEET_DURATION}ms ${EASE}` : "";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion keeps the fade of the backdrop, without movement.
    if (backdrop.current) {
      backdrop.current.style.transition = transition && `opacity ${transition}`;
      backdrop.current.style.opacity = String(amount);
    }
    if (reduce) {
      if (done) setTimeout(done, animate ? SHEET_DURATION : 0);
      return;
    }
    // The screen around the smaller page is black.
    document.documentElement.classList.add("sheet-open");
    element.style.transition = transition ? `transform ${transition}` : "none";
    // The full height of the screen, not of the sheet. With the keyboard up,
    // the sheet is shorter and would stop at the top of the keyboard.
    element.style.transform = `translateY(${(1 - amount) * window.innerHeight}px)`;
    // iOS draws the caret on its own layer, which does not move with the
    // sheet. Thus the caret shows only when the sheet stops in its place.
    const move = ++moves.current;
    element.style.caretColor = "transparent";
    if (page) {
      const scale = 1 - (PAGE_INSET / window.innerWidth) * amount;
      page.style.transition = transition ? `transform ${transition}, border-radius ${transition}` : "none";
      page.style.transformOrigin = "top";
      page.style.transform = `translateY(calc((env(safe-area-inset-top) + 2px) * ${amount})) scale(${scale})`;
      page.style.borderRadius = `${PAGE_RADIUS * amount}px`;
    }
    const settle = () => {
      if (amount === 1 && move === moves.current) element.style.caretColor = "";
      done?.();
    };
    if (animate) afterTransition(element, SHEET_DURATION, settle);
    else settle();
  }, []);

  // After a close, the sheet and the backdrop stay down until React removes
  // them. A reset of their styles before that would show them for a frame.
  const clear = useCallback((all = true) => {
    document.documentElement.classList.remove("sheet-open");
    const page = document.querySelector<HTMLElement>("[data-sheet-page]");
    for (const element of all ? [sheet.current, page, backdrop.current] : [page]) {
      if (!element) continue;
      element.style.transition = element.style.transform = element.style.transformOrigin = "";
      element.style.borderRadius = element.style.opacity = element.style.caretColor = "";
    }
  }, []);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!enabled || !element) {
      clear();
      return;
    }
    if (open) {
      // A new sheet starts below the screen. A sheet that closes goes back up
      // from where it is.
      if (!element.style.transform) {
        pose(0, false);
        void element.offsetHeight;
      }
      pose(1, true);
    } else {
      // The keyboard goes down with the sheet.
      if (element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      pose(0, true, () => {
        clear(false);
        latest.current.onClosed();
      });
    }
  }, [enabled, open, pose, clear]);

  useEffect(() => () => clear(), [clear]);

  useEffect(() => {
    const element = handle.current;
    if (!element || !enabled) return;
    let start: { x: number; y: number; time: number } | null = null;
    let dragging = false;
    let dy = 0;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || dragging) return;
      start = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        time: event.timeStamp,
      };
      dy = 0;
    };
    const onMove = (event: TouchEvent) => {
      const panel = sheet.current;
      if (!start || !panel) return;
      const dx = event.touches[0].clientX - start.x;
      dy = event.touches[0].clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dy <= Math.abs(dx)) {
          start = null;
          return;
        }
        dragging = true;
      }
      event.preventDefault();
      pose(1 - Math.max(0, dy) / window.innerHeight, false);
    };
    const onEnd = (event: TouchEvent) => {
      const panel = sheet.current;
      if (!start || !dragging || !panel) {
        start = null;
        return;
      }
      // A flick closes the sheet, not only a long drag.
      const speed = dy / Math.max(1, event.timeStamp - start.time);
      start = null;
      dragging = false;
      if (dy > 0 && (dy > panel.offsetHeight * 0.25 || speed > 0.11)) latest.current.onDismiss();
      else pose(1, true);
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
  }, [enabled, pose]);

  return { sheet, handle, backdrop };
}
