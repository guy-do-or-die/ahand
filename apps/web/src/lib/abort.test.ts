import { describe, expect, test } from "bun:test";

import { stopWith } from "./abort";

/** A signal that counts who listens for its abort. */
function counted(): { controller: AbortController; listening: () => number } {
  const controller = new AbortController();
  const signal = controller.signal;
  let count = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === "abort") count++;
    return (add as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === "abort") count--;
    return (remove as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof signal.removeEventListener;
  return { controller, listening: () => count };
}

describe("stopWith: one controller for a work's own stop and its caller's signal", () => {
  test("with no caller it is a controller of its own", () => {
    const { stop, release } = stopWith();
    expect(stop.signal.aborted).toBe(false);
    release();
    stop.abort(new Error("own"));
    expect(stop.signal.aborted).toBe(true);
  });

  test("the caller's abort stops the work, with the caller's reason", () => {
    const outer = new AbortController();
    const { stop } = stopWith(outer.signal);
    expect(stop.signal.aborted).toBe(false);
    const reason = new Error("the screen was left");
    outer.abort(reason);
    expect(stop.signal.aborted).toBe(true);
    expect(stop.signal.reason).toBe(reason);
  });

  test("a caller already aborted stops the work at once, with its reason, and is not listened to", () => {
    const { controller, listening } = counted();
    const reason = new Error("left before it began");
    controller.abort(reason);
    const { stop } = stopWith(controller.signal);
    expect(stop.signal.aborted).toBe(true);
    expect(stop.signal.reason).toBe(reason);
    expect(listening()).toBe(0);
  });

  test("the work's own stop does not abort the caller", () => {
    const outer = new AbortController();
    const { stop } = stopWith(outer.signal);
    stop.abort(new Error("stopped following"));
    expect(outer.signal.aborted).toBe(false);
  });

  test("release lets go of the caller: nobody is left listening, and a later abort of the caller changes nothing", () => {
    const { controller, listening } = counted();
    const first = stopWith(controller.signal);
    const second = stopWith(controller.signal);
    expect(listening()).toBe(2);
    first.release();
    second.release();
    expect(listening()).toBe(0);
    controller.abort(new Error("later"));
    expect(first.stop.signal.aborted).toBe(false);
    expect(second.stop.signal.aborted).toBe(false);
  });

  test("it works where AbortSignal.any does not exist (the unit tests run without it)", () => {
    expect("any" in AbortSignal).toBe(false);
  });
});
