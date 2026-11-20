import { parentPort } from "node:worker_threads";

import { renderCard, type CardModel } from "./og.tsx";

/**
 * One renderer of preview cards, run as a worker thread by render-pool.ts. satori and resvg spend
 * a few hundred milliseconds of CPU on a card; here they spend it off the thread that answers
 * requests. It takes `{ id, model }` and answers `{ id, png }` or `{ id, error: true }` (nothing
 * about the failure: it could carry what the address held).
 */

const port = parentPort;
if (!port) throw new Error("render-worker.ts runs only as a worker thread");

port.on("message", async ({ id, model }: { id: number; model: CardModel }) => {
  try {
    const png = await renderCard(model);
    port.postMessage({ id, png }, [png.buffer as ArrayBuffer]);
  } catch {
    port.postMessage({ id, error: true });
  }
});
