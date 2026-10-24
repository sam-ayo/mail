import type { RouterContextProvider } from "react-router";
import { createContext } from "react-router";

/**
 * Collects the time of each server step for the Server-Timing header. The
 * browser shows the steps in the network panel of its developer tools.
 */
export class ServerTiming {
  private entries: string[] = [];

  async measure<T>(name: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await run();
    } finally {
      this.entries.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
    }
  }

  header() {
    return this.entries.join(", ");
  }
}

export const timingContext = createContext<ServerTiming | null>(null);

/** Measures a step of a request that has a timing context. Other requests only run the step. */
export function timed<T>(context: Readonly<RouterContextProvider>, name: string, run: () => Promise<T>) {
  return context.get(timingContext)?.measure(name, run) ?? run();
}
