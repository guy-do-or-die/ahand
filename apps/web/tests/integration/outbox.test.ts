import "fake-indexeddb/auto";

import { afterEach, expect, test } from "bun:test";
import { newChatKey, nostrTransport, openOutbox, type Envelope, type OutboxEntry } from "@ahand/deliver";

import { closeDb, configureDb, outboxStore } from "../../src/store/db";

/**
 * The giver's outbox as the app will open it: packages/deliver's openOutbox over the app's own
 * IndexedDB `outbox` store (fake-indexeddb under Bun), sending through the stand's relay run as a
 * real process. The entry survives the outbox being closed and opened again, as after a reload.
 * Port 19060 is this test's; HAND_TEST_PORT_BASE=B moves it to B+4.
 */

const RELAY = `${import.meta.dir}/../../../../infra/relay/relay.ts`;
const PORT = process.env.HAND_TEST_PORT_BASE ? Number(process.env.HAND_TEST_PORT_BASE) + 4 : 19060;

async function startRelay() {
  const proc = Bun.spawn(["bun", RELAY], { env: { ...process.env, PORT: String(PORT) }, stdout: "pipe", stderr: "inherit" });
  const reader = proc.stdout.getReader();
  let out = "";
  const deadline = Date.now() + 10_000;
  while (!out.includes("listening")) {
    if (Date.now() > deadline) throw new Error("relay did not start");
    const { value, done } = await reader.read();
    if (done) throw new Error(`relay exited: ${out}`);
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return {
    url: `ws://127.0.0.1:${PORT}`,
    async stop() {
      proc.kill("SIGTERM");
      await proc.exited;
    },
  };
}

async function until(pred: () => boolean | Promise<boolean>, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

afterEach(() => closeDb());

test("a give written into the app's IndexedDB outbox reaches the inbox through the relay, and stays after a reopen", async () => {
  configureDb({ name: `ahand-outbox-${process.pid}` });
  const relay = await startRelay();
  try {
    const inbox = newChatKey();
    const heard: Envelope[] = [];
    const transport = nostrTransport([relay.url]);
    const stop = transport.listen(inbox.secret, (envelope) => heard.push(envelope));

    const give: Omit<Envelope, "replyTo"> = {
      v: 1,
      kind: "give",
      hand: { chainId: 31337, core: "0x0f0555972388151D2C187f636A0855b6eE9B9685", handId: "7" },
      giveLink: "http://127.0.0.1:18300/#AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
    };
    const box = openOutbox(transport, outboxStore<OutboxEntry>(), { retryMs: 60_000 });
    const sent = await box.send(inbox.pub, give);
    box.close();
    expect({ acks: sent.acks, of: sent.of }).toEqual({ acks: 1, of: 1 });

    await until(() => heard.length === 1, 5000, "the inbox to hear the give");
    expect(heard[0]).toEqual({ ...give, replyTo: sent.envelope.replyTo });
    stop();

    // A new outbox over the same database, as after a reload: the entry and its chat key are there.
    closeDb();
    const again = openOutbox(transport, outboxStore<OutboxEntry>(), { retryMs: 60_000 });
    const kept = await again.list();
    again.close();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.key).toBe(sent.key);
    expect(kept[0]!.chatKey).toBe(sent.chatKey);
    expect(kept[0]!.deliveredAt).toBeNumber();
    expect(kept[0]!.id).toBe(sent.id!);
  } finally {
    await relay.stop();
  }
}, 30_000);
