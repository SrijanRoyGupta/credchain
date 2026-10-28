import { createFileRoute } from "@tanstack/react-router";
import { guard, json, tokenOf } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/remind")({
  server: {
    handlers: {
      POST: ({ request }) =>
        guard(async () => {
          const { remindNow } = await import("@/lib/credchain/service.server");
          return json(await remindNow(tokenOf(request)));
        }),
    },
  },
});
