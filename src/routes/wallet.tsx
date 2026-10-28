import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-page";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});
