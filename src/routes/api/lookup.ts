import { createFileRoute } from "@tanstack/react-router";
import { guard, json } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/lookup")({
  server: {
    handlers: {
      GET: ({ request }) =>
        guard(async () => {
          const address = new URL(request.url).searchParams.get("address") ?? "";
          const { lookup } = await import("@/lib/credchain/service.server");
          return json(await lookup(address.trim()));
        }),
    },
  },
});
