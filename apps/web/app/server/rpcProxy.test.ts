import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxyDevRpc } from "./rpcProxy";

const post = (body: unknown) =>
  new Request("https://app.test/api/rpc", { method: "POST", body: JSON.stringify(body) });
const call = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });

const anvil = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x7a69" }));

beforeEach(() => {
  anvil.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("proxyDevRpc", () => {
  it.each([84532, 8453])("does not exist on chain %i", async (chainId) => {
    const res = await proxyDevRpc(post(call("eth_chainId")), chainId, anvil as unknown as typeof fetch);
    expect(res.status).toBe(404);
    expect(anvil).not.toHaveBeenCalled();
  });

  it.each(["eth_chainId", "eth_call", "eth_getLogs", "eth_getCode", "eth_sendRawTransaction", "eth_getTransactionReceipt"])(
    "relays %s to anvil",
    async (method) => {
      const res = await proxyDevRpc(post(call(method)), 31337, anvil as unknown as typeof fetch);
      expect(res.status).toBe(200);
      expect(anvil).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "anvil_setBalance",
    "anvil_setCode",
    "anvil_impersonateAccount",
    "anvil_reset",
    "evm_revert",
    "evm_snapshot",
    "hardhat_setBalance",
    "debug_traceTransaction",
    "personal_sign",
    "eth_sendTransaction",
    "eth_sign",
    "eth_signTypedData_v4",
    "eth_signTransaction",
  ])("keeps %s off the tunnel", async (method) => {
    const res = await proxyDevRpc(post(call(method)), 31337, anvil as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe(-32601);
    expect(anvil).not.toHaveBeenCalled();
  });

  it("screens every request in a batch", async () => {
    const res = await proxyDevRpc(post([call("eth_chainId"), call("anvil_setBalance")]), 31337, anvil as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect(anvil).not.toHaveBeenCalled();
  });

  it("does not echo transport errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8545"));
    const res = await proxyDevRpc(post(call("eth_chainId")), 31337, down as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("127.0.0.1");
  });
});
