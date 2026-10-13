const LIST_COLLAPSED_KEY = "list-collapsed";
const LIST_COLLAPSED_CLASS = "list-collapsed";

/** The message list closes when a thread is open and the list is collapsed.
    The state is a class on the root element, so CSS can lay out the page
    before React hydrates. The script in root.tsx sets it from storage. */
export function setListCollapsed(collapsed: boolean) {
  const list = document.querySelector<HTMLElement>("[data-list]");
  const thread = document.querySelector<HTMLElement>("[data-list-thread]");
  // The positions now, with the slide that is in progress.
  const listFrom = list && isShown(list) ? list.getBoundingClientRect().left : undefined;
  const threadFrom = thread?.getBoundingClientRect().left;
  [list, thread].forEach((element) => element?.getAnimations().forEach((animation) => animation.cancel()));
  if (list) endLeave(list);

  document.documentElement.classList.toggle(LIST_COLLAPSED_CLASS, collapsed);
  localStorage.setItem(LIST_COLLAPSED_KEY, collapsed ? "1" : "0");
  if (list && thread && threadFrom !== undefined) slide(list, thread, collapsed, listFrom, threadFrom);
}

function isShown(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

/** The layout changes at once, and the panes slide from their old positions
    with a transform, as the sidebar does. The list and the thread view move
    together, so the thread view pushes the list out and pulls it back in.
    The pane that holds them clips the list at its left edge. */
function slide(list: HTMLElement, thread: HTMLElement, collapsed: boolean, listFrom: number | undefined, threadFrom: number) {
  const style = getComputedStyle(document.documentElement);
  // The build can write "300ms" as ".3s".
  const time = style.getPropertyValue("--sidebar-duration").trim();
  const duration = (parseFloat(time) || 0.3) * (time.endsWith("ms") ? 1 : 1000);
  const easing = style.getPropertyValue("--ease-spring").trim() || "ease-out";

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Keep a short fade, so the change is not abrupt. Remove the movement.
    thread.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    return;
  }

  // A closed list leaves the layout. It stays on the screen, out of the flow,
  // until it slides out.
  if (collapsed) {
    if (listFrom === undefined) return;
    startLeave(list);
  } else if (!isShown(list)) {
    return;
  }

  const listRect = list.getBoundingClientRect();
  const distance = threadFrom - thread.getBoundingClientRect().left;
  if (!distance) return endLeave(list);
  const listStart = (listFrom ?? listRect.left - listRect.width) - listRect.left;
  const listEnd = collapsed ? -listRect.width : 0;

  thread.animate([{ transform: `translateX(${distance}px)` }, { transform: "none" }], { duration, easing });
  const animation = list.animate(
    [{ transform: `translateX(${listStart}px)` }, { transform: `translateX(${listEnd}px)` }],
    { duration, easing },
  );
  if (collapsed) animation.finished.then(() => endLeave(list), () => {});
}

function startLeave(list: HTMLElement) {
  Object.assign(list.style, { display: "flex", position: "absolute", top: "0", bottom: "0", left: "0" });
}

function endLeave(list: HTMLElement) {
  for (const property of ["display", "position", "top", "bottom", "left"]) list.style.removeProperty(property);
}
