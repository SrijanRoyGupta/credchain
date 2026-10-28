import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Download, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { LANGS } from "@/lib/i18n/strings";
import { api } from "@/lib/credchain/http";
import type { WalletState } from "@/lib/credchain/types";
import { useUi } from "@/components/providers";

type BeforeInstall = Event & { prompt: () => Promise<void> };

export function Shell({ children }: { children: ReactNode }) {
  const ui = useUi();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [glow, setGlow] = useState({ x: "50%", y: "30%" });
  const [installEvt, setInstallEvt] = useState<BeforeInstall | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const client = useQueryClient();
  const stateQ = useQuery({
    queryKey: ["state", ui.token],
    enabled: !!ui.token && typeof window !== "undefined",
    queryFn: () => api<WalletState>("/api/state", { token: ui.token }),
    refetchInterval: 8000,
  });

  useEffect(() => {
    const fine = window.matchMedia("(pointer:fine)").matches;
    if (!fine) return;
    const move = (e: PointerEvent) => setGlow({ x: `${e.clientX}px`, y: `${e.clientY}px` });
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstall);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if (!ui.token || !ui.ready || !stateQ.data) return;
    const channel = stateQ.data.prefs.channel || "both";
    if (stateQ.data.prefs.lang === ui.lang) return;
    api("/api/prefs", { method: "POST", token: ui.token, body: { channel, lang: ui.lang } })
      .then(() => client.invalidateQueries({ queryKey: ["state", ui.token] }))
      .catch(() => undefined);
  }, [ui.lang, ui.token, ui.ready, stateQ.data, client]);

  const on = (href: string) => (path === href ? "on" : "");
  const unread = stateQ.data?.messages.length ?? 0;

  return (
    <>
      <div className="glow" style={{ left: glow.x, top: glow.y }} />
      <main>
        <nav className="nav">
          <Link className="logo" to="/">
            <i />
            CredChain
          </Link>
          <div className="links">
            <Link className={on("/")} to="/">
              {ui.t("nav_home")}
            </Link>
            <Link className={on("/wallet")} to="/wallet">
              {ui.t("nav_wallet")}
            </Link>
            <Link className={on("/about")} to="/about">
              {ui.t("nav_about")}
            </Link>
          </div>
          <div className="tools">
            <select
              className="field lang"
              aria-label={ui.t("nav_language")}
              value={ui.lang}
              onChange={(e) => ui.setLang(e.target.value as typeof ui.lang)}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.native}
                </option>
              ))}
            </select>
            <button
              className="iconbtn"
              type="button"
              aria-label={ui.theme === "dark" ? ui.t("nav_theme_light") : ui.t("nav_theme_dark")}
              onClick={() => ui.setTheme(ui.theme === "dark" ? "light" : "dark")}
            >
              {ui.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {ui.token ? (
              <button className="iconbtn" type="button" aria-label={ui.t("nav_inbox")} onClick={() => setInboxOpen(true)}>
                <Bell size={18} />
                {unread > 0 ? <span className="badge">{unread > 9 ? "9+" : unread}</span> : null}
              </button>
            ) : null}
            {standalone ? (
              <span className="pill ok">{ui.t("nav_installed")}</span>
            ) : (
              <button className="iconbtn" type="button" aria-label={ui.t("nav_install")} onClick={() => setInstallOpen(true)}>
                <Download size={18} />
              </button>
            )}
            {ui.token ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  if (!confirm(ui.t("signout_confirm"))) return;
                  ui.setToken(null);
                  client.removeQueries({ queryKey: ["state"] });
                }}
              >
                {ui.t("nav_signout")}
              </button>
            ) : path !== "/wallet" ? (
              <Link className="btn" to="/wallet">
                {ui.t("nav_connect")}
              </Link>
            ) : null}
          </div>
        </nav>
        {children}
      </main>
      {installOpen ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
          <div className="glass panel">
            <h2 id="install-title">{ui.t("install_title")}</h2>
            <p>{ui.t("install_body")}</p>
            <p>{ui.t("install_ios")}</p>
            <div className="row">
              {installEvt ? (
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    await installEvt.prompt();
                    setInstallOpen(false);
                  }}
                >
                  {ui.t("install_go")}
                </button>
              ) : null}
              <button className="btn ghost" type="button" onClick={() => setInstallOpen(false)}>
                {ui.t("install_later")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {inboxOpen ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="inbox-title">
          <div className="glass panel">
            <h2 id="inbox-title">{ui.t("inbox_title")}</h2>
            <p>{ui.t("inbox_sub")}</p>
            <div style={{ maxHeight: 360, overflow: "auto" }}>
              {stateQ.data?.messages.length ? (
                stateQ.data.messages.map((m) => (
                  <div className="tx" key={m.id}>
                    <div>
                      <b>
                        {m.channel === "sms" ? ui.t("ch_sms") : ui.t("ch_email")} · {m.title}
                      </b>
                      <small>
                        {new Date(m.created_at).toLocaleString(ui.locale)} · {m.body}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">{ui.t("inbox_empty")}</div>
              )}
            </div>
            <button className="btn ghost" type="button" onClick={() => setInboxOpen(false)}>
              {ui.t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
