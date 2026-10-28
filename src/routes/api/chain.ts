import { createFileRoute } from "@tanstack/react-router";
import { guard, json } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/chain")({
  server: {
    handlers: {
      GET: () =>
        guard(async () => {
          const { publicChain } = await import("@/lib/credchain/service.server");
          const body = await publicChain();
          return json(body, 200, { "cache-control": "public, max-age=2, stale-while-revalidate=10" });
        }),
    },
  },
});
