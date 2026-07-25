import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/rpc")({
  POST: async ({ request }) => {
    try {
      const body = await request.text();
      let parsedBody: any = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {}

      const res = await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
        body,
        cache: "no-store",
      });
      const resText = await res.text();

      // Log the RPC method, params, and result to help debug hangs
      if (parsedBody) {
        let resultSummary = resText;
        if (resText.length > 200) {
          resultSummary = resText.slice(0, 200) + "...";
        }
        console.log(
          `[RPC Proxy] method=${parsedBody.method} params=${JSON.stringify(
            parsedBody.params
          )} -> status=${res.status} response=${resultSummary}`
        );
      }

      return new Response(resText, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    } catch (err: any) {
      console.error("[RPC Proxy Error]", err);
      return new Response(
        JSON.stringify({ error: err?.message || "RPC proxy error" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
          },
        }
      );
    }
  },
});
