import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isLang, localeOf, tr, type Key, type Lang } from "@/lib/i18n/strings";

type Theme = "dark" | "light";

type Ui = {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  locale: string;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  token: string | null;
  ready: boolean;
  setToken: (t: string | null) => void;
  toast: (text: string, kind?: "" | "ok" | "bad") => void;
};

const Ctx = createContext<Ui | null>(null);

export function useUi(): Ui {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi outside provider");
  return v;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 2000 },
    },
  });
}

let browserClient: QueryClient | undefined;

function getClient() {
  if (typeof window === "undefined") return makeClient();
  return (browserClient ??= makeClient());
}

export function AppProviders({ children }: { children: ReactNode }) {
  const client = useMemo(() => getClient(), []);
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setThemeState] = useState<Theme>("dark");
  const [readyUi, setReadyUi] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: string } | null>(null);

  useEffect(() => {
    const storedTheme = localStorage.getItem("cc_theme");
    const nextTheme: Theme = storedTheme === "light" ? "light" : "dark";
    const storedLang = localStorage.getItem("cc_lang");
    const nextLang: Lang = isLang(storedLang) ? storedLang : "en";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.lang = nextLang;
    setThemeState(nextTheme);
    setLangState(nextLang);
    setTokenState(localStorage.getItem("cc_token"));
    setReadyUi(true);
    setSessionReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cc_token") setTokenState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!readyUi) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    localStorage.setItem("cc_theme", theme);
    localStorage.setItem("cc_lang", lang);
  }, [theme, lang, readyUi]);

  useEffect(() => {
    if (!toastMsg) return;
    const id = window.setTimeout(() => setToastMsg(null), 3800);
    return () => window.clearTimeout(id);
  }, [toastMsg]);

  const api = useMemo<Ui>(
    () => ({
      lang,
      setLang: setLangState,
      theme,
      setTheme: setThemeState,
      locale: localeOf(lang),
      t: (key, vars) => tr(lang, key, vars),
      token,
      ready: sessionReady,
      setToken: (next) => {
        if (next) localStorage.setItem("cc_token", next);
        else localStorage.removeItem("cc_token");
        setTokenState(next);
      },
      toast: (text, kind = "") => setToastMsg({ text, kind }),
    }),
    [lang, theme, token, sessionReady],
  );

  return (
    <QueryClientProvider client={client}>
      <Ctx.Provider value={api}>
        {children}
        <div className={`toast${toastMsg ? " show" : ""} ${toastMsg?.kind ?? ""}`} role="status" aria-live="polite">
          {toastMsg?.text ?? ""}
        </div>
      </Ctx.Provider>
    </QueryClientProvider>
  );
}
