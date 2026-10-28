import { createFileRoute } from "@tanstack/react-router";
import { guard, json, tokenOf } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/state")({
  server: {
    handlers: {
      GET: ({ request }) =>
        guard(async () => {
          const { getState } = await import("@/lib/credchain/service.server");
          return json(await getState(tokenOf(request)));
        }),
    },
  },
});
