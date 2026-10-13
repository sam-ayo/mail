import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True after hydration. The server render and the first client render get false. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Shows a date in the reader's time zone. The server does not know that time
 * zone, so the date shows only after hydration.
 */
export function LocalDate({
  iso,
  format,
  className,
}: {
  iso: string;
  format(iso: string): string;
  className?: string;
}) {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso} className={className}>
      {hydrated ? format(iso) : " "}
    </time>
  );
}
