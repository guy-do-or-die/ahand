import { createAPIFileRoute } from "@tanstack/start/api";
import { DeployedAddresses } from "@ahand/abi";
import { AA, SIMPLE_7702_IMPLEMENTATION } from "../config/aa";
import { activeChain } from "../config/web3";
import { aaUpstream, proxyAaRequest } from "../server/aaProxy";

export const APIRoute = createAPIFileRoute("/api/aa")({
  POST: ({ request }) =>
    proxyAaRequest(request, {
      upstream: aaUpstream(process.env, activeChain.id),
      policy: {
        chainId: activeChain.id,
        entryPoint: AA.entryPoint.address,
        implementation: SIMPLE_7702_IMPLEMENTATION,
        core: DeployedAddresses.AHandCore,
        signals: DeployedAddresses.AHandSignals,
        token: DeployedAddresses.mockUSD,
        // The VITE_ name is where the id lived while the client sent it.
        sponsorshipPolicyId:
          process.env.AA_SPONSORSHIP_POLICY_ID || process.env.VITE_AA_SPONSORSHIP_POLICY_ID || undefined,
      },
    }),
});
