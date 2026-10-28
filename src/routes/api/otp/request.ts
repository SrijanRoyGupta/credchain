import { createFileRoute } from "@tanstack/react-router";
import { guard, json, readJson, tokenOf } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/otp/request")({
  server: {
    handlers: {
      POST: ({ request }) =>
        guard(async () => {
          const body = await readJson(request);
          const { requestOtp } = await import("@/lib/credchain/service.server");
          return json(await requestOtp(body, tokenOf(request)));
        }),
    },
  },
});
