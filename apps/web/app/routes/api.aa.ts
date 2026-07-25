import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/aa")({
  POST: async ({ request }) => {
    try {
      const body = await request.text();

      const res = await fetch(process.env.AA_LOCAL_URL ?? "http://127.0.0.1:4339", {
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
