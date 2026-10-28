import { createFileRoute } from "@tanstack/react-router";
import { guard, json, readJson, tokenOf } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/prefs")({
  server: {
    handlers: {
      POST: ({ request }) =>
        guard(async () => {
          const body = await readJson(request);
          const { updatePrefs } = await import("@/lib/credchain/service.server");
          return json(await updatePrefs(tokenOf(request), String(body.channel ?? "both"), String(body.lang ?? "en")));
        }),
    },
  },
});
