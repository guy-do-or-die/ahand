import { createAPIFileRoute } from "@tanstack/start/api";
import { activeChain } from "../config/web3";
import { proxyDevRpc } from "../server/rpcProxy";

export const APIRoute = createAPIFileRoute("/api/rpc")({
  POST: ({ request }) => proxyDevRpc(request, activeChain.id),
});
