import { createFileRoute } from "@tanstack/react-router";
import { guard, json, readJson, tokenOf } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/tx")({
  server: {
    handlers: {
      POST: ({ request }) =>
        guard(async () => {
          const body = await readJson(request);
          const { simpleTx } = await import("@/lib/credchain/service.server");
          const amount = body.amount === undefined ? undefined : Number(body.amount);
          return json(await simpleTx(tokenOf(request), String(body.action ?? ""), amount));
        }),
    },
  },
});
