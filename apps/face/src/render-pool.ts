import { Worker } from "node:worker_threads";

import type { CardModel } from "./og.tsx";

/**
 * A fixed number of card renderers (worker threads running render-worker.ts) and a short queue in
 * front of them. A card costs a few hundred milliseconds of CPU; done on the request thread, a
 * burst of cold cards stalled every other answer, /healthz included (review round 1). Here the
 * request thread only posts a message, and a burst beyond `workers + queue` cards is refused at
 * once: `render` returns undefined and the caller answers something cheap instead of waiting.
 */

export interface RenderPool {
  /** The card's PNG, or undefined at once when every renderer is busy and the queue is full. */
  render(model: CardModel): Promise<Uint8Array> | undefined;
  /** Cards being drawn or waiting, for tests and the curious. */
  readonly pending: number;
  close(): Promise<void>;
}

interface Job {
  id: number;
  model: CardModel;
  resolve: (png: Uint8Array) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  job?: Job;
}

type Answer = { id: number; png: Uint8Array } | { id: number; error: true };

export function renderPool(options: { workers?: number; queue?: number } = {}): RenderPool {
  const size = Math.max(1, options.workers ?? 2);
  const limit = Math.max(0, options.queue ?? 16);
  const waiting: Job[] = [];
  let next = 0;
  let closed = false;

  const slots: Slot[] = [];
  const spawn = (slot: Slot) => {
    const worker = new Worker(new URL("./render-worker.ts", import.meta.url));
    // The pool never keeps the process alive on its own; the server does.
    worker.unref();
    worker.on("message", (answer: Answer) => {
      const job = slot.job;
      if (!job || job.id !== answer.id) return;
      slot.job = undefined;
      if ("png" in answer) job.resolve(new Uint8Array(answer.png));
      else job.reject(new Error("the card could not be drawn"));
      feed();
    });
    // A renderer that died takes its card with it; another takes its place.
    worker.on("error", () => {
      slot.job?.reject(new Error("the card renderer stopped"));
      slot.job = undefined;
      if (!closed) {
        spawn(slot);
        feed();
      }
    });
    slot.worker = worker;
  };
  for (let i = 0; i < size; i++) {
    const slot = {} as Slot;
    spawn(slot);
    slots.push(slot);
  }

  function feed() {
    for (const slot of slots) {
      if (slot.job || waiting.length === 0) continue;
      const job = waiting.shift()!;
      slot.job = job;
      slot.worker.postMessage({ id: job.id, model: job.model });
    }
  }

  return {
    render(model) {
      if (closed) return Promise.reject(new Error("the renderers are stopped"));
      const busy = slots.filter((slot) => slot.job).length;
      if (busy === size && waiting.length >= limit) return undefined;
      return new Promise<Uint8Array>((resolve, reject) => {
        waiting.push({ id: next++, model, resolve, reject });
        feed();
      });
    },
    get pending() {
      return waiting.length + slots.filter((slot) => slot.job).length;
    },
    async close() {
      closed = true;
      for (const job of waiting.splice(0)) job.reject(new Error("the renderers are stopped"));
      await Promise.all(
        slots.map(async (slot) => {
          slot.job?.reject(new Error("the renderers are stopped"));
          slot.job = undefined;
          await slot.worker.terminate();
        }),
      );
    },
  };
}
