import { test } from "node:test";
import assert from "node:assert/strict";
import { createPoll, DEFAULT_POLL_INTERVAL_MS } from "./poll.ts";

// Fake scheduler so the test never waits a real 20 s: it records the interval
// each handler was registered with and lets the test fire ticks on demand.
function fakeScheduler() {
  const registered: Array<{ handler: () => void; ms: number }> = [];
  const cleared: unknown[] = [];
  let nextId = 0;
  return {
    scheduler: {
      setInterval(handler: () => void, ms: number) {
        registered.push({ handler, ms });
        return ++nextId;
      },
      clearInterval(id: unknown) {
        cleared.push(id);
      },
    },
    registered,
    cleared,
    tick() {
      for (const { handler } of [...registered]) handler();
    },
  };
}

// fn runs on a microtask and a rejection is caught a few microtasks later, so
// yield to a macrotask to drain them all before asserting.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("default interval is the spec's 20-second poll", () => {
  assert.equal(DEFAULT_POLL_INTERVAL_MS, 20_000);
});

test("start calls immediately then refreshes on each tick", async () => {
  const calls: number[] = [];
  const { scheduler, registered, tick } = fakeScheduler();
  const poll = createPoll(() => {
    calls.push(calls.length);
  }, { scheduler });

  poll.start();
  await flush();
  assert.equal(calls.length, 1, "immediate call on start");
  assert.equal(registered.length, 1);
  assert.equal(registered[0].ms, 20_000, "registered interval is 20 000 ms");

  tick();
  await flush();
  tick();
  await flush();
  tick();
  await flush();
  assert.equal(calls.length, 4, "each tick refreshes");
});

test("stop halts further refreshes and clears the interval", async () => {
  let calls = 0;
  const { scheduler, cleared, tick } = fakeScheduler();
  const poll = createPoll(() => {
    calls++;
  }, { scheduler });

  poll.start();
  await flush();
  assert.equal(calls, 1);

  poll.stop();
  assert.equal(cleared.length, 1, "interval cleared on stop");

  tick();
  await flush();
  assert.equal(calls, 1, "no refresh after stop");

  poll.stop();
  assert.equal(cleared.length, 1, "stop is idempotent");
});

test("immediate: false waits for the first interval tick", async () => {
  let calls = 0;
  const { scheduler, tick } = fakeScheduler();
  const poll = createPoll(() => {
    calls++;
  }, { scheduler, immediate: false });

  poll.start();
  await flush();
  assert.equal(calls, 0);

  tick();
  await flush();
  assert.equal(calls, 1);
});

test("a rejected fetch is surfaced to onError and does not stop the poll", async () => {
  const errors: unknown[] = [];
  let calls = 0;
  const { scheduler, tick } = fakeScheduler();
  const poll = createPoll(
    async () => {
      calls++;
      throw new Error("offline");
    },
    { scheduler, onError: (e) => errors.push(e) },
  );

  poll.start();
  await flush();
  await flush();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);

  tick();
  await flush();
  await flush();
  assert.equal(calls, 2, "poll keeps running after a failure");
});
