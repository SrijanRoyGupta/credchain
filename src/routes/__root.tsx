import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppProviders } from "@/components/providers";
import { Shell } from "@/components/shell";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CredChain · Credit built on-chain" },
      { name: "description", content: "Borrow rupees against a credit score you earn by repaying. CredChain keeps the rules on a transparent chain." },
      { name: "theme-color", content: "#07070f" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Sans+Tamil:wght@400;600;700&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('cc_theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';var l=localStorage.getItem('cc_lang');if(l)document.documentElement.lang=l}catch(e){}",
          }}
        />
        <PreviewHostBridge />
        <AuthProvider>
          <AppProviders>
            <Shell>
              <Outlet />
            </Shell>
          </AppProviders>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
