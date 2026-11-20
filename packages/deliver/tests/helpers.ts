/** Test helpers: ports in this package's range, and the stand relay run as its own process. */
import type { Subprocess } from "bun";

const RELAY = `${import.meta.dir}/../../../infra/relay/relay.ts`;
const handedOut = new Set<number>();

/** This package's range, 15120–15149 (the relay package's tests use 15100–15119); DELIVER_TEST_PORTS="from-to" picks another. */
const [PORTS_FROM, PORTS_TO] = (process.env.DELIVER_TEST_PORTS ?? "15120-15149").split("-").map(Number) as [number, number];

/** A port nobody listens on, from this package's range. */
export function freePort(): number {
  for (let port = PORTS_FROM; port <= PORTS_TO; port++) {
    if (handedOut.has(port)) continue;
    try {
      const probe = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
      probe.stop(true);
      handedOut.add(port);
      return port;
    } catch {
      // taken
    }
  }
  throw new Error(`no free port in ${PORTS_FROM}–${PORTS_TO}`);
}

export interface RelayProcess {
  url: string;
  port: number;
  /** Everything the relay printed. */
  log(): string;
  stop(): Promise<void>;
}

/** Starts `infra/relay/relay.ts` with PORT and waits until it listens. */
export async function spawnRelay(port: number): Promise<RelayProcess> {
  const proc: Subprocess<"ignore", "pipe", "inherit"> = Bun.spawn(["bun", RELAY], {
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  let out = "";
  const deadline = Date.now() + 10_000;
  while (!out.includes("listening")) {
    if (Date.now() > deadline) throw new Error("relay did not start");
    const { value, done } = await reader.read();
    if (done) throw new Error(`relay exited: ${out}`);
    out += new TextDecoder().decode(value);
  }
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      out += new TextDecoder().decode(value);
    }
  })();
  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    log: () => out,
    async stop() {
      proc.kill("SIGTERM");
      await proc.exited;
    },
  };
}

/** Waits until `pred` holds, polling every 25 ms. */
export async function until(pred: () => boolean, ms = 5000, what = "condition"): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

export const HAND = { chainId: 31337, core: "0x65ac707E2AE7392583de5d6192C619F1D8862309", handId: "7" } as const;

/** A string shaped like a give address, exactly `bytes` characters long. */
export function longGiveLink(bytes: number): string {
  const head = "http://127.0.0.1:18300/#"; // a stand-in of the right size; the SDK writes real ones
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let body = "";
  for (let i = 0; body.length < bytes - head.length; i++) body += alphabet[(i * 7 + 3) % alphabet.length];
  return head + body;
}
