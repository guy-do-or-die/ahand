import { createAPIFileRoute } from "@tanstack/start/api";
import { renderOgResponse } from "../server/og/render";

export const APIRoute = createAPIFileRoute("/api/og/$id")({
  GET: async ({ request, params }) => renderOgResponse(request, params.id),
});
