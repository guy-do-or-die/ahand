import { spawn, type Subprocess } from "bun";
import { dirname, join } from "path";
import { paymaster } from "@pimlico/mock-paymaster";
import { AA_CONTRACTS, ANVIL_KEY_0 } from "./constants";

export type AaStack = {
  bundlerUrl: string;
  paymasterUrl: string;
  stop: () => Promise<void>;
};

/**
 * Spawns the alto bundler CLI directly (prool's alto instance rejects on ANY
 * stderr output, which node's ExperimentalWarning banner trips). alto
 * self-deploys its simulation contracts via the utility key on boot.
 */
async function startAlto({ anvilRpc, port }: { anvilRpc: string; port: number }) {
  const altoCli = join(
    dirname(Bun.resolveSync("@pimlico/alto", import.meta.dir)),
    "cli/alto.js",
  );
  const entrypoints = AA_CONTRACTS.filter((c) => c.name.startsWith("EntryPoint"))
    .map((c) => c.canonical)
    .join(",");

  const proc = spawn(
    [
      "node", "--no-warnings", altoCli,
      "--entrypoints", entrypoints,
      "--rpc-url", anvilRpc,
      "--executor-private-keys", ANVIL_KEY_0,
      "--utility-private-key", ANVIL_KEY_0,
      "--safe-mode", "false", // anvil lacks the tracer safe mode requires
      "--polling-interval", "100",
      "--port", String(port),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  // ONE consumer per pipe, kept open for the process's whole life: breaking
  // out of a for-await closes the pipe, alto's next write EPIPEs, and node
  // exits 0 — a silent death that looks like a crash with no cause.
  // Output tees into a log file; readiness is detected inside the same loop.
  const logPath = process.env.AHAND_ALTO_LOG ?? join(import.meta.dirname, "../.alto.log");
  const sink = Bun.file(logPath).writer();
  let markReady: (v: boolean) => void = () => {};
  const ready = new Promise<boolean>((r) => (markReady = r));
  const decoder = new TextDecoder();
  let tail = "";
  const tee = (stream: AsyncIterable<Uint8Array>, scan: boolean) =>
    (async () => {
      for await (const chunk of stream) {
        sink.write(chunk);
        sink.flush();
        if (scan) {
          tail = (tail + decoder.decode(chunk)).slice(-4096);
          if (tail.includes("Server listening at")) markReady(true);
        }
      }
    })().catch(() => {});
  void tee(proc.stdout, true);
  void tee(proc.stderr, false);
  void proc.exited.then((code) => {
    markReady(false);
    sink.write(`\n[stack.ts] alto exited with code ${code} at ${new Date().toISOString()}\n`);
    return sink.end();
  });

  const ok = await Promise.race([
    ready,
    new Promise<false>((r) => setTimeout(() => r(false), 30_000)),
  ]);
  if (!ok) {
    proc.kill();
    throw new Error(`alto did not become ready on :${port} — see ${logPath}`);
  }
  console.log(`[aa] alto log: ${logPath}`);
  return proc;
}

/**
 * Boots the local AA stack against a running anvil:
 *  - alto bundler (eth_sendUserOperation & friends for EP 0.6/0.7/0.8)
 *  - Pimlico mock paymaster (self-deploys its singleton paymasters, deposits
 *    into each EntryPoint, serves pm_* AND proxies bundler methods to alto —
 *    so the app needs only the paymaster URL).
 * AA contracts must already be deployed (see deploy.ts).
 */
export async function startAaStack({
  anvilRpc,
  altoPort = Number(process.env.AHAND_ALTO_PORT ?? 4337),
  paymasterPort = Number(process.env.AHAND_PAYMASTER_PORT ?? 4339),
}: {
  anvilRpc: string;
  altoPort?: number;
  paymasterPort?: number;
}): Promise<AaStack> {
  const altoProc: Subprocess = await startAlto({ anvilRpc, port: altoPort });

  const altoRpc = `http://localhost:${altoPort}`;
  const pm = paymaster({ anvilRpc, altoRpc, port: paymasterPort });
  try {
    await pm.start();
  } catch (err) {
    altoProc.kill();
    throw err;
  }

  return {
    bundlerUrl: altoRpc,
    paymasterUrl: `http://localhost:${paymasterPort}`,
    stop: async () => {
      await pm.stop().catch(() => {});
      altoProc.kill();
      await altoProc.exited.catch(() => {});
    },
  };
}
