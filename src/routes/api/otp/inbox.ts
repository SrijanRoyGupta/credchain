import { createFileRoute } from "@tanstack/react-router";
import { guard, json } from "@/lib/credchain/routekit";

export const Route = createFileRoute("/api/otp/inbox")({
  server: {
    handlers: {
      GET: ({ request }) =>
        guard(async () => {
          const id = new URL(request.url).searchParams.get("id") ?? "";
          const { otpInbox } = await import("@/lib/credchain/service.server");
          return json(await otpInbox(id), 200, { "cache-control": "no-store" });
        }),
    },
  },
});
