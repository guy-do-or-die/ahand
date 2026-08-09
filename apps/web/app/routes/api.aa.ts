import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/aa")({
  POST: async ({ request }) => {
    try {
      const body = await request.text();

      // Server-held bundler/paymaster upstream: a Pimlico v2 endpoint in
      // production (serves both eth_* and pm_* methods, key stays out of the
      // client bundle), the local alto+mock stand otherwise.
      const upstream =
        process.env.AA_UPSTREAM_URL ??
        process.env.AA_LOCAL_URL ??
        "http://127.0.0.1:4339";

      const res = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
      });
      const resText = await res.text();

      return new Response(resText, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    } catch (err: any) {
      console.error("[AA Proxy Error]", err);
      return new Response(
        JSON.stringify({ error: err?.message || "AA proxy error" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  },
});
