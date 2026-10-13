import { useRef } from "react";
import { cx } from "./ui";

/** The root element has this class while a drag is in progress, so panels can
    turn off their size transitions. */
export const RESIZING_CLASS = "resizing";

type Edge = "left" | "right" | "top" | "bottom";

/** A handle on one edge of a panel that changes the size of the panel.
    A drag moves the edge. The arrow keys move the edge by 16px, or by 48px
    with Shift. A double click sets the default size again.

    The handle does not keep the size. It reads the size with `size` and
    writes it with `onResize`, so the panel can keep it in a CSS variable and
    React does not render each frame. */
export function ResizeHandle({
  edge,
  label,
  min,
  max,
  size,
  onResize,
  onReset,
  onOvershoot,
  onExtend,
  straddle = false,
  className,
}: {
  edge: Edge;
  label: string;
  min: number;
  max: number | (() => number);
  /** The size of the panel now, in px. */
  size(): number;
  /** `done` is true at the end of a drag or after a key press. Save the size then. */
  onResize(size: number, done: boolean): void;
  onReset(): void;
  /** Called when a drag goes this far past the minimum. The drag stops. */
  onOvershoot?: { distance: number; run(): void };
  /** Called when a drag goes this far past the maximum, or when an arrow key
      moves the edge past the maximum. The drag stops. */
  onExtend?: { distance: number; run(): void };
  /** Puts the handle across the edge, half inside the panel and half outside.
      Use it for an edge that is a thin line between two panes. */
  straddle?: boolean;
  className?: string;
}) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const vertical = edge === "left" || edge === "right";
  // The size gets larger when the edge moves away from the panel.
  const sign = edge === "right" || edge === "bottom" ? 1 : -1;

  function upper() {
    return Math.max(min, typeof max === "function" ? max() : max);
  }

  function clamp(value: number) {
    return Math.round(Math.min(upper(), Math.max(min, value)));
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    const root = document.documentElement;
    root.style.cursor = "";
    root.style.userSelect = "";
    root.classList.remove(RESIZING_CLASS);
    onResize(clamp(size()), true);
  }

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuemin={min}
      tabIndex={0}
      className={cx(
        "absolute z-10 touch-none",
        vertical ? "inset-y-0 w-2 cursor-col-resize" : "inset-x-0 h-2 cursor-row-resize",
        edge === "left" && (straddle ? "-left-1" : "left-0"),
        edge === "right" && (straddle ? "-right-1" : "right-0"),
        edge === "top" && (straddle ? "-top-1" : "top-0"),
        edge === "bottom" && (straddle ? "-bottom-1" : "bottom-0"),
        className,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: vertical ? e.clientX : e.clientY, size: size() };
        // Keep the resize cursor and stop text selection while the pointer
        // is over the other panes.
        const root = document.documentElement;
        root.style.cursor = vertical ? "col-resize" : "row-resize";
        root.style.userSelect = "none";
        // The size follows the pointer with no transition.
        root.classList.add(RESIZING_CLASS);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const value = drag.current.size + sign * ((vertical ? e.clientX : e.clientY) - drag.current.start);
        if (onOvershoot && value < min - onOvershoot.distance) {
          // End the drag first, so the panel closes with its transition.
          endDrag();
          onOvershoot.run();
          return;
        }
        if (onExtend && value > upper() + onExtend.distance) {
          endDrag();
          onExtend.run();
          return;
        }
        onResize(clamp(value), false);
      }}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const keys = vertical ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        const direction = e.key === keys[0] ? -1 : e.key === keys[1] ? 1 : 0;
        if (!direction) return;
        e.preventDefault();
        const value = size() + sign * direction * step;
        if (onExtend && value > upper()) onExtend.run();
        else onResize(clamp(value), true);
      }}
    />
  );
}
