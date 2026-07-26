import { createAPIFileRoute } from "@tanstack/start/api";
import { publishDiscovery } from "../lib/discovery";

/**
 * The flagman app's pinning service: raises post their canonical discovery
 * doc here and the server (which holds the provider key) replicates it to
 * IPFS. This is what keeps public hands renderable on the board after the
 * raiser's tab is gone.
 *
 * Deliberately narrow: a couple KB of valid JSON or nothing — this is a
 * discovery-doc pipe, not a general file host.
 */
const MAX_DOC_BYTES = 2048;

export const APIRoute = createAPIFileRoute("/api/pin")({
  POST: async ({ request }) => {
    try {
      const { b64 } = (await request.json()) as { b64?: string };
      if (typeof b64 !== "string" || b64.length === 0 || b64.length > MAX_DOC_BYTES * 2) {
        return Response.json({ error: "bad request" }, { status: 400 });
      }
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        return Response.json({ error: "bad base64" }, { status: 400 });
      }
      if (bytes.length === 0 || bytes.length > MAX_DOC_BYTES) {
        return Response.json({ error: "too large" }, { status: 413 });
      }
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return Response.json({ error: "not json" }, { status: 400 });
      }
      return Response.json(await publishDiscovery(bytes));
    } catch (err: any) {
      return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
    }
  },
});
