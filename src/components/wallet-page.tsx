import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { bankName, parseKyc, U } from "@/lib/credchain/domain";
import { api } from "@/lib/credchain/http";
import { money } from "@/lib/credchain/money";
import type { OtpStart, WalletState } from "@/lib/credchain/types";
import { useUi } from "@/components/providers";
import { explain, OtpDialog } from "@/components/otp-dialog";

const FIELDS = ["email", "mobile", "aadhaar", "bank", "ifsc"] as const;

function useRotator(words: string[]) {
  const [text, setText] = useState(words[0] ?? "");
  const key = words.join("\n");
  useEffect(() => {
    let i = 0;
    let c = 0;
    let del = false;
    let timer = 0;
    const list = key.split("\n");
    const step = () => {
      const word = list[i] ?? "";
      c += del ? -1 : 1;
      setText(word.slice(0, Math.max(0, c)));
      let wait = del ? 35 : 70;
      if (!del && c >= word.length) {
        del = true;
        wait = 1400;
      } else if (del && c <= 0) {
        del = false;
        i = (i + 1) % list.length;
        wait = 280;
      }
      timer = window.setTimeout(step, wait);
    };
    timer = window.setTimeout(step, 300);
    return () => window.clearTimeout(timer);
  }, [key]);
  return text;
}

function Identicon({ address }: { address: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || address.length < 8) return;
    const x = canvas.getContext("2d");
    if (!x) return;
    const h = address.slice(2);
    const hue = Number.parseInt(h.slice(0, 3), 16) % 360;
    x.clearRect(0, 0, 100, 100);
    x.fillStyle = `hsl(${hue} 70% 62%)`;
    let k = 3;
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        if (Number.parseInt(h[k++] || "0", 16) % 2 === 0) {
          for (const cc of [c, 4 - c]) x.fillRect(8 + cc * 17, 8 + r * 17, 15, 15);
        }
      }
    }
  }, [address]);
  return <canvas ref={ref} width={100} height={100} aria-hidden />;
}

export function WalletPage() {
  const ui = useUi();
  const client = useQueryClient();
  const rot = useRotator([ui.t("wallet_rot_1"), ui.t("wallet_rot_2"), ui.t("wallet_rot_3")]);
  const [form, setForm] = useState({ email: "", mobile: "", aadhaar: "", bank: "", ifsc: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [otp, setOtp] = useState<OtpStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [hide, setHide] = useState(false);
  const [tab, setTab] = useState<"send" | "recv">("send");
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [toState, setToState] = useState<"idle" | "ok" | "bad">("idle");
  const [toMsg, setToMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [bad, setBad] = useState(false);
  const [agree, setAgree] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stateQ = useQuery({
    queryKey: ["state", ui.token],
    enabled: !!ui.token && typeof window !== "undefined",
    queryFn: () => api<WalletState>("/api/state", { token: ui.token }),
    refetchInterval: 6000,
  });
  const S = stateQ.data;

  const parsed = parseKyc(form);
  const fieldError = (k: (typeof FIELDS)[number]) => {
    if (serverErr[k]) return serverErr[k];
    if (!touched[k]) return "";
    if (parsed.ok) return "";
    return parsed.errors[k] ?? "";
  };
  const goodCount = FIELDS.filter((k) => (parsed.ok ? true : !parsed.errors[k])).length;
  const bank = form.ifsc.length >= 4 ? bankName(form.ifsc) : null;

  useEffect(() => {
    const v = to.trim();
    if (!v || !S) {
      setToState("idle");
      setToMsg("");
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const r = await api<{ exists: boolean }>(`/api/lookup?address=${encodeURIComponent(v)}`);
        if (v === S.address) {
          setToState("bad");
          setToMsg(ui.t("own_wallet"));
        } else if (r.exists) {
          setToState("ok");
          setToMsg("");
        } else {
          setToState("bad");
          setToMsg(ui.t("no_wallet_found"));
        }
      } catch {
        setToState("bad");
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [to, S, ui]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function stopScan() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  async function startScan() {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (src: CanvasImageSource) => Promise<{ rawValue?: string }[]> } }).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) {
      ui.toast(ui.t("scan_unsupported"), "bad");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    streamRef.current = stream;
    setScanning(true);
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play();
    const det = new BD({ formats: ["qr_code"] });
    const loop = async () => {
      if (!streamRef.current) return;
      try {
        const codes = await det.detect(video);
        const raw = codes[0]?.rawValue?.trim();
        if (raw) {
          setTo(raw);
          await stopScan();
          return;
        }
      } catch {
        /* frame not ready */
      }
      window.setTimeout(loop, 250);
    };
    window.setTimeout(loop, 300);
  }

  const tierName = S ? ui.t(`tier_${S.terms.tier}` as "tier_new") : "";
  const labelFor = (action: string, toAddr?: string) => {
    if (action === "faucet") return ui.t("type_faucet");
    if (action === "borrow") return ui.t("type_borrow");
    if (action === "repay") return ui.t("type_repay");
    if (action === "fundPool") return ui.t("type_fund");
    if (action === "transfer" && toAddr === S?.address) return ui.t("type_in");
    if (action === "transfer") return ui.t("type_out");
    return action;
  };
  const canSend = !!S && toState === "ok" && Number(amt) > 0 && Number(amt) * U <= S.balance && !busy;

  return (
    <>
      {!ui.token ? (
        <section className="wrap">
          <h1>
            {ui.t("wallet_before")} <em className="caret">{rot}</em>
          </h1>
          <p>{ui.t("wallet_intro")}</p>
          <form
            className="glass"
            onSubmit={async (e) => {
              e.preventDefault();
              setTouched(Object.fromEntries(FIELDS.map((k) => [k, true])));
              if (!parsed.ok) return;
              if (!agree) {
                setBanner(ui.t("agree_need"));
                return;
              }
              setBusy(true);
              setBanner("");
              setServerErr({});
              try {
                const start = await api<OtpStart>("/api/otp/request", {
                  method: "POST",
                  body: { purpose: "signup", ...form, lang: ui.lang },
                });
                setOtp(start);
              } catch (err) {
                if (err instanceof Error && "fields" in err) {
                  const fields = (err as { fields?: Record<string, string> }).fields;
                  if (fields) setServerErr(fields);
                }
                setBanner(explain(err, ui.t, ui.locale));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="prog">
              {FIELDS.map((k, i) => (
                <span key={k} className={i < goodCount ? "on" : ""} />
              ))}
            </div>
            <div className="two">
              {(["email", "mobile"] as const).map((k) => (
                <div key={k} className={`f fld${fieldError(k) ? " no" : touched[k] && !fieldError(k) ? " ok" : ""}`}>
                  <label htmlFor={k}>{ui.t(k === "email" ? "lbl_email" : "lbl_mobile")}</label>
                  <input
                    id={k}
                    value={form[k]}
                    inputMode={k === "mobile" ? "numeric" : "email"}
                    autoComplete={k === "email" ? "email" : "tel"}
                    placeholder={ui.t(k === "email" ? "ph_email" : "ph_mobile")}
                    onBlur={() => setTouched({ ...touched, [k]: true })}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  />
                  <i className="mark">{fieldError(k) ? "✕" : touched[k] ? "✓" : ""}</i>
                  <div className="err">{fieldError(k) ? ui.t(fieldError(k) as "err_email") : ""}</div>
                </div>
              ))}
            </div>
            <div className={`f fld${fieldError("aadhaar") ? " no" : touched.aadhaar && !fieldError("aadhaar") ? " ok" : ""}`}>
              <label htmlFor="aadhaar">{ui.t("lbl_aadhaar")}</label>
              <input
                id="aadhaar"
                inputMode="numeric"
                maxLength={14}
                placeholder={ui.t("ph_aadhaar")}
                autoComplete="off"
                value={form.aadhaar}
                onBlur={() => setTouched({ ...touched, aadhaar: true })}
                onChange={(e) =>
                  setForm({
                    ...form,
                    aadhaar: e.target.value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").slice(0, 14),
                  })
                }
              />
              <i className="mark">{fieldError("aadhaar") ? "✕" : touched.aadhaar ? "✓" : ""}</i>
              <div className="err">{fieldError("aadhaar") ? ui.t(fieldError("aadhaar") as "err_aadhaar") : ""}</div>
            </div>
            <div className="two">
              <div className={`f fld${fieldError("bank") ? " no" : touched.bank && !fieldError("bank") ? " ok" : ""}`}>
                <label htmlFor="bank">{ui.t("lbl_bank")}</label>
                <input
                  id="bank"
                  inputMode="numeric"
                  maxLength={18}
                  placeholder={ui.t("ph_bank")}
                  value={form.bank}
                  onBlur={() => setTouched({ ...touched, bank: true })}
                  onChange={(e) => setForm({ ...form, bank: e.target.value.replace(/\D/g, "") })}
                />
                <i className="mark">{fieldError("bank") ? "✕" : touched.bank ? "✓" : ""}</i>
                <div className="err">{fieldError("bank") ? ui.t("err_bank") : ""}</div>
              </div>
              <div className={`f fld${fieldError("ifsc") ? " no" : touched.ifsc && !fieldError("ifsc") ? " ok" : ""}`}>
                <label htmlFor="ifsc">IFSC</label>
                <input
                  id="ifsc"
                  maxLength={11}
                  placeholder={ui.t("ph_ifsc")}
                  value={form.ifsc}
                  style={{ textTransform: "uppercase" }}
                  onBlur={() => setTouched({ ...touched, ifsc: true })}
                  onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                />
                <i className="mark">{fieldError("ifsc") ? "✕" : touched.ifsc ? "✓" : ""}</i>
                <div className="err">{fieldError("ifsc") ? ui.t("err_ifsc") : ""}</div>
                {bank && !fieldError("ifsc") && touched.ifsc ? <span className="bankchip">{bank}</span> : null}
              </div>
            </div>
            <p style={{ fontSize: 12 }}>{ui.t("wallet_privacy")}</p>
            <div className="check">
              <input id="agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <label htmlFor="agree">{ui.t("agree_terms")}</label>
              <Link to="/about" hash="terms">
                {ui.t("see_terms")}
              </Link>
            </div>
            <button className="btn" style={{ width: "100%" }} disabled={!parsed.ok || !agree || busy}>
              {busy ? <span className="spin" /> : null}
              {busy ? ui.t("creating") : ui.t("btn_create")}
            </button>
            {banner ? <div className="msg bad">{banner}</div> : null}
          </form>
        </section>
      ) : (
        <section>
          <div className="grid2" style={{ alignItems: "start" }}>
            <div>
              <div className="vcard">
                <div className="top">
                  <span>CredChain Wallet</span>
                  {S ? <Identicon address={S.address} /> : <span />}
                </div>
                <div className="bal">{hide || !S ? "₹ ••••••" : money(S.balance, ui.locale)}</div>
                <small>
                  {ui.t("available")} ·{" "}
                  <button className="mini" type="button" onClick={() => setHide((v) => !v)}>
                    {hide ? ui.t("show") : ui.t("hide")}
                  </button>
                </small>
                <div className="ad">
                  <span>{S?.address ?? "…"}</span>
                  <button
                    className="mini"
                    type="button"
                    onClick={async () => {
                      if (!S) return;
                      await navigator.clipboard.writeText(S.address);
                      ui.toast(ui.t("toast_copied"), "ok");
                    }}
                  >
                    {ui.t("copy")}
                  </button>
                </div>
              </div>
              <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="glass stat">
                  <span>{ui.t("chart_score")}</span>
                  <b>{S ? `${S.terms.score} · ${tierName}` : "—"}</b>
                </div>
                <div className="glass stat">
                  <span>{ui.t("stat_max")}</span>
                  <b style={{ fontSize: 20 }}>{S ? money(S.terms.maxLoan, ui.locale) : "—"}</b>
                </div>
              </div>
              <div className="row">
                <Link className="btn" to="/" style={{ flex: 1 }}>
                  {ui.t("open_dash")}
                </Link>
                <button className="btn ghost" style={{ flex: 1 }} type="button" disabled={!S?.faucetReady || busy} onClick={() => run("faucet")}>
                  {ui.t("btn_claim")}
                </button>
              </div>
              <div className="glass" style={{ marginTop: 14 }}>
                <h2>{ui.t("details_title")}</h2>
                <div className="kv">
                  <div>
                    <span>{ui.t("lbl_email")}</span>
                    <b>{S?.kyc.email ?? "—"}</b>
                  </div>
                  <div>
                    <span>{ui.t("lbl_mobile")}</span>
                    <b>{S?.kyc.mobile ?? "—"}</b>
                  </div>
                  <div>
                    <span>{ui.t("lbl_aadhaar")}</span>
                    <b>{S?.kyc.aadhaar ?? "—"}</b>
                  </div>
                  <div>
                    <span>{ui.t("lbl_bank")}</span>
                    <b>{S ? `${S.kyc.bank} · ${S.kyc.ifsc}` : "—"}</b>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: 12 }}>{S ? ui.t("since", { date: new Date(S.created).toLocaleDateString(ui.locale, { day: "numeric", month: "long", year: "numeric" }) }) : ""}</p>
              </div>
            </div>
            <div>
              <div className="glass">
                <div className="tabs">
                  <button type="button" className={tab === "send" ? "on" : ""} onClick={() => setTab("send")}>
                    {ui.t("tab_send")}
                  </button>
                  <button type="button" className={tab === "recv" ? "on" : ""} onClick={() => setTab("recv")}>
                    {ui.t("tab_recv")}
                  </button>
                </div>
                {tab === "send" ? (
                  <div>
                    <div className={`f fld${toState === "ok" ? " ok" : toState === "bad" ? " no" : ""}`}>
                      <label htmlFor="to">{ui.t("to_label")}</label>
                      <input id="to" value={to} placeholder="0x…" autoComplete="off" spellCheck={false} onChange={(e) => setTo(e.target.value.trim())} />
                      <i className="mark">{toState === "ok" ? "✓" : toState === "bad" ? "✕" : ""}</i>
                      <div className="err">{toMsg}</div>
                    </div>
                    <video ref={videoRef} className="video" muted playsInline hidden={!scanning} />
                    <div className="f">
                      <label htmlFor="send-amt">{ui.t("amt_label")}</label>
                      <input id="send-amt" type="number" min={1} value={amt} placeholder="500" onChange={(e) => setAmt(e.target.value)} />
                    </div>
                    <div className="chips">
                      {[25, 50, 100].map((p) => (
                        <button
                          key={p}
                          className="chip"
                          type="button"
                          onClick={() => S && setAmt(String(Math.floor((S.balance / U) * (p / 100))))}
                        >
                          {p === 100 ? "Max" : `${p}%`}
                        </button>
                      ))}
                      <button className="chip" type="button" onClick={() => (scanning ? stopScan() : startScan())}>
                        {scanning ? ui.t("scan_stop") : ui.t("scan")}
                      </button>
                    </div>
                    <button className="btn" style={{ width: "100%" }} type="button" disabled={!canSend} onClick={() => startSend()}>
                      {ui.t("send_btn")}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p>{ui.t("recv_help")}</p>
                    {S?.qr ? <img src={S.qr} alt={ui.t("qr_alt")} style={{ width: 220, height: 220, borderRadius: 16 }} /> : null}
                    <div className="msg" style={{ overflowWrap: "anywhere" }}>
                      {S?.address}
                    </div>
                    <div className="row">
                      <button
                        className="btn"
                        type="button"
                        onClick={async () => {
                          if (!S) return;
                          await navigator.clipboard.writeText(S.address);
                          ui.toast(ui.t("toast_copied"), "ok");
                        }}
                      >
                        {ui.t("copy_addr")}
                      </button>
                      {S?.qr ? (
                        <a className="btn ghost" href={S.qr} download="credchain-wallet-qr.png">
                          {ui.t("download_qr")}
                        </a>
                      ) : null}
                    </div>
                  </div>
                )}
                <div className={`msg${bad ? " bad" : ""}`}>{msg || ui.t("msg_ready")}</div>
              </div>
              <div className="glass" style={{ marginTop: 14 }}>
                <h2>
                  {ui.t("recent")} <span className="pill">{S?.statement.length ?? 0}</span>
                </h2>
                {S?.statement.length ? (
                  S.statement.slice(0, 8).map((x) => {
                    const incoming = x.action === "faucet" || x.action === "borrow" || x.to === S.address;
                    return (
                      <div className="tx" key={`${x.index}-${x.action}`}>
                        <div>
                        <b>{labelFor(x.action, x.to)}</b>
                          <small>{new Date(x.ts).toLocaleString(ui.locale)}</small>
                        </div>
                        <b className={incoming ? "up" : "dn"}>{incoming ? "+" : "−"}{money(x.credit || x.debit || x.amount, ui.locale)}</b>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty">{ui.t("no_activity")}</div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {done ? (
        <div className="sheet">
          <div className="glass panel" style={{ textAlign: "center" }}>
            <h2>{ui.t("wallet_created")}</h2>
            <p>{ui.t("wallet_ready")}</p>
            <Link className="btn" to="/" onClick={() => setDone(false)}>
              {ui.t("open_dash")}
            </Link>
          </div>
        </div>
      ) : null}

      {otp ? (
        <OtpDialog
          start={otp}
          onClose={() => setOtp(null)}
          onResend={async () => {
            const start = await api<OtpStart>("/api/otp/request", {
              method: "POST",
              token: ui.token,
              body: ui.token
                ? { purpose: "send", to, amount: Number(amt), lang: ui.lang }
                : { purpose: "signup", ...form, lang: ui.lang },
            });
            setOtp(start);
          }}
          onConfirm={async (code) => {
            const res = await api<{ kind: string; token?: string; address?: string; index?: number }>("/api/otp/confirm", {
              method: "POST",
              token: ui.token,
              body: { challengeId: otp.challengeId, code },
            });
            setOtp(null);
            if (res.token) {
              ui.setToken(res.token);
              setDone(true);
              window.setTimeout(() => setDone(false), 1600);
            } else {
              setTo("");
              setAmt("");
              setToState("idle");
              setBad(false);
              setMsg(ui.t("confirmed_in", { label: ui.t("act_send"), n: res.index ?? 0 }));
              ui.toast(ui.t("toast_confirmed", { label: ui.t("act_send") }), "ok");
              await client.invalidateQueries({ queryKey: ["state", res.token ?? ui.token] });
            }
          }}
        />
      ) : null}
    </>
  );

  async function run(action: string) {
    if (!ui.token) return;
    setBusy(true);
    setBad(false);
    setMsg(ui.t("mining_label", { label: ui.t("act_claim") }));
    try {
      const r = await api<{ index: number }>("/api/tx", { method: "POST", token: ui.token, body: { action } });
      setMsg(ui.t("confirmed_in", { label: ui.t("act_claim"), n: r.index }));
      ui.toast(ui.t("toast_confirmed", { label: ui.t("act_claim") }), "ok");
      await client.invalidateQueries({ queryKey: ["state", ui.token] });
    } catch (e) {
      const text = explain(e, ui.t, ui.locale);
      setBad(true);
      setMsg(text);
      ui.toast(text, "bad");
    } finally {
      setBusy(false);
    }
  }

  async function startSend() {
    if (!ui.token) return;
    setBusy(true);
    try {
      const start = await api<OtpStart>("/api/otp/request", {
        method: "POST",
        token: ui.token,
        body: { purpose: "send", to, amount: Number(amt), lang: ui.lang },
      });
      setOtp(start);
    } catch (e) {
      const text = explain(e, ui.t, ui.locale);
      setBad(true);
      setMsg(text);
    } finally {
      setBusy(false);
    }
  }
}
