// Reusable fixed-interval poller for the farm screen.
//
// The farm screen (ticket 35) refreshes saves and requests while it is open.
// This helper owns only the timing; the caller supplies the fetch and decides
// what to do with the data. All scheduling is injected so the helper is DOM-,
// Tauri-, and network-free and can run under `node --test`.
//
// Usage (ticket 35):
//   const poll = createPoll(() => fetchSaves(farmId).then(renderSaves));
//   onMount(() => { poll.start(); return poll.stop; });
//
// Default interval is the spec's 20 s: "While the farm screen is open, saves
// and requests refresh on a 20-second poll."

export const DEFAULT_POLL_INTERVAL_MS = 20_000;

export interface PollScheduler {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const systemScheduler: PollScheduler = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export interface PollOptions {
  intervalMs?: number;
  /** Run once right away, then on the interval. Defaults to true. */
  immediate?: boolean;
  scheduler?: PollScheduler;
  onError?: (error: unknown) => void;
}

export interface Poll {
  start(): void;
  stop(): void;
}

export function createPoll(
  fn: () => void | Promise<void>,
  {
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    immediate = true,
    scheduler = systemScheduler,
    onError,
  }: PollOptions = {},
): Poll {
  let id: unknown = null;
  let running = false;

  const tick = () => {
    if (!running) return;
    // A rejected fetch must not crash the app or block the next tick.
    Promise.resolve()
      .then(fn)
      .catch((error) => onError?.(error));
  };

  const start = () => {
    if (running) return;
    running = true;
    if (immediate) tick();
    id = scheduler.setInterval(tick, intervalMs);
  };

  const stop = () => {
    if (!running) return;
    running = false;
    if (id !== null) scheduler.clearInterval(id);
    id = null;
  };

  return { start, stop };
}
