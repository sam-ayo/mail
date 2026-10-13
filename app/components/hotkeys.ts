import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    element.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
  );
}

function keyName(event: KeyboardEvent) {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  // Shift is part of the key for symbols such as "#" and "?". For letters
  // and named keys, it is a modifier: "shift+i", "shift+Enter".
  const letter = /^[a-z]$/i.test(event.key);
  if (event.shiftKey && (letter || event.key.length > 1)) parts.push("shift");
  parts.push(letter ? event.key.toLowerCase() : event.key);
  return parts.join("+");
}

/** An open menu has its own keys: arrows, Return, Escape, and type-ahead. */
function inMenu(target: EventTarget | null) {
  return !!(target as HTMLElement | null)?.closest?.('[role="menu"]');
}

/**
 * Binds keyboard shortcuts. Keys look like "j", "#", "shift+i", "mod+k",
 * "Escape", or a two-key sequence such as "g i". Shortcuts do not fire while
 * the person types in a field, except "mod+" shortcuts and "Escape".
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || inMenu(event.target)) return;
      const key = keyName(event);
      const typing = isTyping(event.target);
      if (typing && !key.startsWith("mod+") && key !== "Escape") return;

      const handlers = mapRef.current;
      if (pending) {
        const sequence = `${pending} ${key}`;
        pending = null;
        clearTimeout(pendingTimer);
        if (handlers[sequence]) {
          event.preventDefault();
          handlers[sequence](event);
          return;
        }
      }
      if (Object.keys(handlers).some((combo) => combo.startsWith(`${key} `))) {
        pending = key;
        pendingTimer = setTimeout(() => (pending = null), 1000);
        return;
      }
      if (handlers[key]) {
        event.preventDefault();
        handlers[key](event);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(pendingTimer);
    };
  }, [enabled]);
}
