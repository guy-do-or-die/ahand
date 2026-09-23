/**
 * /api/rpc lets the browser reach the local anvil stand through the app's own
 * origin, which is also what a shared dev tunnel exposes. Off anvil it does
 * not exist. On anvil the cheat codes and the unlocked accounts stay off this
 * path; tooling that needs them talks to :8545 directly.
 */
const ANVIL_CHAIN_ID = 31337;
const ANVIL_RPC = "http://127.0.0.1:8545";
const DENIED = /^(anvil|evm|hardhat|debug|admin|personal|txpool|miner)_|^eth_(sendTransaction|sign)/;

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const rpcError = (status: number, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), { status, headers: HEADERS });

export async function proxyDevRpc(
  request: Request,
  chainId: number,
  send: typeof fetch = fetch,
): Promise<Response> {
  if (chainId !== ANVIL_CHAIN_ID) return new Response("Not found", { status: 404 });

  let parsed: any;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return rpcError(400, -32700, "parse error");
  }
  const calls: any[] = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.some((c) => typeof c?.method !== "string" || DENIED.test(c.method))) {
    return rpcError(403, -32601, "method not available through /api/rpc");
  }

  try {
    const body = JSON.stringify(parsed);
    const res = await send(ANVIL_RPC, { method: "POST", headers: HEADERS, body, cache: "no-store" });
    const resText = await res.text();

    // Log the RPC method, params, and result to help debug hangs
    const resultSummary = resText.length > 200 ? resText.slice(0, 200) + "..." : resText;
    console.log(
      `[RPC Proxy] method=${calls.map((c) => c.method).join(",")} params=${JSON.stringify(
        calls.map((c) => c.params),
      )} -> status=${res.status} response=${resultSummary}`,
    );

    return new Response(resText, { status: res.status, headers: HEADERS });
  } catch (err) {
    console.error("[RPC Proxy Error]", err);
    return rpcError(502, -32603, "anvil unavailable");
  }
}
