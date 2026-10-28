import { createFileRoute } from "@tanstack/react-router";
import { guard, json, readJson, tokenOf } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/otp/confirm")({
  server: {
    handlers: {
      POST: ({ request }) =>
        guard(async () => {
          const body = await readJson(request);
          const { confirmOtp } = await import("@/lib/credchain/service.server");
          return json(await confirmOtp(String(body.challengeId ?? ""), String(body.code ?? ""), tokenOf(request)));
        }),
    },
  },
});
