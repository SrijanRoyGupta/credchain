import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useState } from "react";
import { CcError, U, previewLoan, scoreOf, tierOf, type Terms } from "@/lib/credchain/domain";
import { api } from "@/lib/credchain/http";
import { money, rupees } from "@/lib/credchain/money";
import type { ChainView, OtpStart, WalletState } from "@/lib/credchain/types";
import { downloadReceipt, downloadStatement } from "@/lib/credchain/export-docs";
import { useUi } from "@/components/providers";
import { OtpDialog, explain } from "@/components/otp-dialog";

const CIRC = 339.3;
const TIERS = [
  { id: "new" as const, lo: 0, max: 5000, col: 100, apr: 24 },
  { id: "developing" as const, lo: 400, max: 20000, col: 50, apr: 18 },
  { id: "established" as const, lo: 600, max: 100000, col: 25, apr: 12 },
  { id: "strong" as const, lo: 800, max: 200000, col: 10, apr: 8 },
];

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
        wait = 1600;
      } else if (del && c <= 0) {
        del = false;
        i = (i + 1) % list.length;
        wait = 300;
      }
      timer = window.setTimeout(step, wait);
    };
    timer = window.setTimeout(step, 400);
    return () => window.clearTimeout(timer);
  }, [key]);
  return text;
}

function monthCells(anchor: Date) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const start = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < start; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function Dashboard() {
  const ui = useUi();
  const client = useQueryClient();
  const chainQ = useQuery({
    queryKey: ["chain"],
    enabled: typeof window !== "undefined",
    queryFn: () => api<ChainView>("/api/chain"),
    refetchInterval: 6000,
    staleTime: 2000,
  });
  const stateQ = useQuery({
    queryKey: ["state", ui.token],
    enabled: !!ui.token && typeof window !== "undefined",
    queryFn: () => api<WalletState>("/api/state", { token: ui.token }),
    refetchInterval: 6000,
  });
  const signed = !!ui.token;
  const S = signed ? stateQ.data : undefined;
  const [amt, setAmt] = useState("");
  const [sel, setSel] = useState(-1);
  const [msg, setMsg] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lab, setLab] = useState({ r: 0, l: 0, d: 0, ready: false });
  const [now, setNow] = useState(() => Date.now());
  const [otp, setOtp] = useState<OtpStart | null>(null);
  const [otpBody, setOtpBody] = useState<Record<string, unknown> | null>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmt, setFundAmt] = useState("");
  const [month, setMonth] = useState(() => new Date());
  const [chartOn, setChartOn] = useState(false);
  const rot = useRotator([ui.t("hero_rot_1"), ui.t("hero_rot_2"), ui.t("hero_rot_3"), ui.t("hero_rot_4")]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => setChartOn(true), []);
  useEffect(() => {
    if (S && !lab.ready) setLab({ r: S.history.repaid, l: S.history.largest, d: S.history.defaults, ready: true });
  }, [S, lab.ready]);

  const terms: Terms | null = S?.terms ?? null;
  const maxUnits = useMemo(() => {
    if (!S || !terms) return 0;
    const byBal = Math.floor((S.balance * 10000) / terms.collateralBps);
    return Math.max(0, Math.min(terms.maxLoan, S.pool, byBal));
  }, [S, terms]);

  const preview = useMemo(() => {
    if (!terms) return null;
    const rupee = Number(amt);
    if (!amt || !(rupee > 0)) return null;
    return previewLoan(Math.round(rupee * U), terms);
  }, [amt, terms]);

  let warn = "";
  if (S?.loan) warn = ui.t("warn_active");
  else if (preview && terms) {
    const a = Math.round(Number(amt) * U);
    if (a < 1000 * U) warn = ui.t("warn_min");
    else if (a > terms.maxLoan) warn = ui.t("warn_max", { max: money(terms.maxLoan, ui.locale) });
    else if (a > (S?.pool ?? 0)) warn = ui.t("warn_pool");
    else if ((S?.balance ?? 0) < preview.col) warn = ui.t("warn_col", { amount: money(preview.col, ui.locale) });
  }
  const canBorrow = !!S && signed && !busy && !S.loan && !!preview && !warn;

  const refresh = () => client.invalidateQueries({ queryKey: ["state", ui.token] });

  async function runSimple(action: string, amount?: number, label?: string) {
    if (!ui.token) {
      ui.toast(ui.t("toast_need_wallet"), "bad");
      return;
    }
    setBusy(true);
    setBad(false);
    setMsg(ui.t("mining_label", { label: label ?? action }));
    try {
      const r = await api<{ index: number }>("/api/tx", { method: "POST", token: ui.token, body: { action, amount } });
      setMsg(ui.t("confirmed_in", { label: label ?? action, n: r.index }));
      ui.toast(ui.t("toast_confirmed", { label: label ?? action }), "ok");
      await refresh();
    } catch (e) {
      const text = explain(e, ui.t, ui.locale);
      setBad(true);
      setMsg(text);
      ui.toast(text, "bad");
    } finally {
      setBusy(false);
    }
  }

  async function startOtp(body: Record<string, unknown>) {
    if (!ui.token) {
      ui.toast(ui.t("toast_need_wallet"), "bad");
      return;
    }
    setBusy(true);
    try {
      const start = await api<OtpStart>("/api/otp/request", {
        method: "POST",
        token: ui.token,
        body: { ...body, lang: ui.lang },
      });
      setOtpBody(body);
      setOtp(start);
    } catch (e) {
      const text = explain(e, ui.t, ui.locale);
      setBad(true);
      setMsg(text);
      ui.toast(text, "bad");
    } finally {
      setBusy(false);
    }
  }

  const chain = chainQ.data;
  const tier = terms ? tierOf(terms.score) : TIERS[0];
  const labScore = scoreOf({ repaid: lab.r, largest: lab.l, defaults: lab.d });
  const labTier = tierOf(labScore);
  const loan = S?.loan;
  const left = loan ? loan.due - now : 0;
  const cd = !loan
    ? ui.t("loan_none")
    : left > 0
      ? ui.t("countdown", {
          d: Math.floor(left / 86400000),
          h: Math.floor((left % 86400000) / 3600000),
          m: Math.floor((left % 3600000) / 60000),
          s: Math.floor((left % 60000) / 1000),
        })
      : ui.t("loan_overdue");
  const barPct = loan ? Math.min(100, Math.max(0, ((now - loan.start) / (loan.due - loan.start)) * 100)) : 0;
  const cells = monthCells(month);
  const today = ymd(new Date());
  const events = S?.calendar ?? [];
  const kindOn = (day: number) => {
    const date = ymd(new Date(month.getFullYear(), month.getMonth(), day));
    return events.filter((e) => e.date === date).map((e) => e.kind);
  };

  const histLabel = (action: string, to?: string) => {
    if (action === "faucet") return ui.t("type_faucet");
    if (action === "borrow") return ui.t("type_borrow");
    if (action === "repay") return ui.t("type_repay");
    if (action === "fundPool") return ui.t("type_fund");
    if (action === "transfer" && to === S?.address) return ui.t("type_in");
    return ui.t("type_out");
  };

  return (
    <>
      {!signed ? (
        <section className="hero">
          <div>
            <h1>
              {ui.t("hero_before")} <em className="caret">{rot}</em>.
            </h1>
            <p>{ui.t("hero_body")}</p>
            <Link className="btn" to="/wallet">
              {ui.t("hero_cta")}
            </Link>
          </div>
          <div className="glass live">
            <h2>
              <i />
              {ui.t("live_title")}
            </h2>
            <p>{ui.t("live_body")}</p>
            <div className="kv">
              <div>
                <span>{ui.t("stat_blocks")}</span>
                <b>{chain ? chain.validation.blocks : "—"}</b>
              </div>
              <div>
                <span>{ui.t("stat_pool")}</span>
                <b>{chain ? money(chain.pool, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("stat_status")}</span>
                <b>{chain ? (chain.validation.valid ? ui.t("status_secure") : ui.t("status_broken")) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("stat_last")}</span>
                <b>{chain ? new Date(chain.lastTs).toLocaleTimeString(ui.locale) : "—"}</b>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="row" style={{ marginTop: 0 }}>
        <span className={`pill ${chain?.validation.valid ? "ok" : chain ? "bad" : ""}`}>
          {chain
            ? `${chain.validation.valid ? ui.t("chain_ok") : ui.t("chain_bad")} · ${chain.validation.blocks}`
            : "…"}
        </span>
      </div>

      <div className="grid4">
        <div className="glass stat">
          <span>{ui.t("stat_balance")}</span>
          <b>{S ? money(S.balance, ui.locale) : "—"}</b>
        </div>
        <div className="glass stat">
          <span>{ui.t("stat_max")}</span>
          <b>{S ? money(S.terms.maxLoan, ui.locale) : "—"}</b>
        </div>
        <div className="glass stat">
          <span>{ui.t("stat_debt")}</span>
          <b>{S ? money(S.loan?.principal ?? 0, ui.locale) : "—"}</b>
        </div>
        <div className="glass stat">
          <span>{ui.t("stat_pool")}</span>
          <b>{chain ? money(chain.pool, ui.locale) : S ? money(S.pool, ui.locale) : "—"}</b>
        </div>
      </div>

      <div className="grid2">
        <div className="glass">
          <h2>{ui.t("passport_title")}</h2>
          <p style={{ overflowWrap: "anywhere", fontSize: 12 }}>
            {signed && S ? ui.t("wallet_line", { address: S.address }) : ui.t("guest_addr")}
          </p>
          <div className="gauge">
            <svg viewBox="0 0 120 120" width="170" height="170">
              <defs>
                <linearGradient id="g">
                  <stop offset="0" stopColor="#22d3ee" />
                  <stop offset="0.5" stopColor="#8b5cf6" />
                  <stop offset="1" stopColor="#f472b6" />
                </linearGradient>
              </defs>
              <circle className="t" cx="60" cy="60" r="54" />
              <circle
                className="v"
                cx="60"
                cy="60"
                r="54"
                style={{ strokeDashoffset: CIRC * (1 - (terms?.score ?? 0) / 1000) }}
              />
            </svg>
            <div className="n">
              <b>{terms ? terms.score : "—"}</b>
              <small>{terms ? ui.t("score_tier", { tier: ui.t(`tier_${tier.id}` as "tier_new") }) : ui.t("score_of")}</small>
            </div>
          </div>
          <div className="kv">
            <div>
              <span>{ui.t("hist_repaid")}</span>
              <b>{S ? S.history.repaid : "—"}</b>
            </div>
            <div>
              <span>{ui.t("hist_largest")}</span>
              <b>{S ? rupees(S.history.largest * 1000, ui.locale) : "—"}</b>
            </div>
            <div>
              <span>{ui.t("hist_defaults")}</span>
              <b>{S ? S.history.defaults : "—"}</b>
            </div>
            <div>
              <span>{ui.t("hist_terms")}</span>
              <b>{terms ? ui.t("terms_short", { col: tier.col, apr: tier.apr }) : "—"}</b>
            </div>
          </div>
          <h2 style={{ marginTop: 18 }}>{ui.t("tiers_title")}</h2>
          <p>{ui.t("tiers_help")}</p>
          <div className="tiers">
            {TIERS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                className={`tier${terms && tier.id === t.id ? " on" : ""}${sel === i ? " sel" : ""}`}
                onClick={() => setSel(i)}
              >
                <b>{ui.t(`tier_${t.id}` as "tier_new")}</b>
                <span>
                  {ui.t("tier_range", {
                    range:
                      i === 0
                        ? ui.t("range_below", { n: TIERS[1].lo })
                        : i === TIERS.length - 1
                          ? ui.t("range_above", { n: t.lo })
                          : ui.t("range_between", { a: t.lo, b: TIERS[i + 1].lo - 1 }),
                  })}
                </span>
              </button>
            ))}
          </div>
          <div className="msg">
            {sel < 0
              ? ui.t("tier_tap")
              : ui.t("tier_blurb", {
                  name: ui.t(`tier_${TIERS[sel].id}` as "tier_new"),
                  max: rupees(TIERS[sel].max, ui.locale),
                  col: TIERS[sel].col,
                  apr: TIERS[sel].apr,
                })}
          </div>
          <details style={{ marginTop: 18 }}>
            <summary>{ui.t("lab_title")}</summary>
            <p style={{ marginTop: 10 }}>{ui.t("lab_help")}</p>
            <div className="lab">
              <span>R</span>
              <input type="range" min={0} max={10} value={lab.r} aria-label="R" onChange={(e) => setLab({ ...lab, r: Number(e.target.value) })} />
              <b>{lab.r}</b>
            </div>
            <div className="lab">
              <span>L</span>
              <input type="range" min={0} max={300} value={lab.l} aria-label="L" onChange={(e) => setLab({ ...lab, l: Number(e.target.value) })} />
              <b>₹{lab.l}k</b>
            </div>
            <div className="lab">
              <span>D</span>
              <input type="range" min={0} max={3} value={lab.d} aria-label="D" onChange={(e) => setLab({ ...lab, d: Number(e.target.value) })} />
              <b>{lab.d}</b>
            </div>
            <div className="msg">
              {ui.t("lab_out", {
                score: labScore,
                tier: ui.t(`tier_${labTier.id}` as "tier_new"),
                max: rupees(labTier.max, ui.locale),
                col: labTier.col,
                apr: labTier.apr,
              })}
            </div>
          </details>
        </div>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="glass">
            <h2>{ui.t("borrow_title")}</h2>
            <p>{ui.t("borrow_help")}</p>
            <p className="msg bad" style={{ marginTop: 0 }}>
              {ui.t("borrow_risk")}{" "}
              <Link to="/about" hash="terms">
                {ui.t("see_terms")}
              </Link>
            </p>
            <label htmlFor="amt">{ui.t("amount_label")}</label>
            <input id="amt" type="number" min={1000} step={100} placeholder="25000" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <input
              type="range"
              min={0}
              max={Math.max(0, Math.floor(maxUnits / U))}
              step={100}
              value={Math.min(Number(amt) || 0, Math.floor(maxUnits / U))}
              aria-label={ui.t("amount_label")}
              disabled={maxUnits < 1000 * U}
              onChange={(e) => setAmt(e.target.value)}
            />
            <div className="chips">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  className="chip"
                  type="button"
                  onClick={() => {
                    const mx = maxUnits / U;
                    if (mx < 1000) {
                      ui.toast(ui.t("toast_faucet_low"), "bad");
                      return;
                    }
                    setAmt(String(Math.max(1000, Math.floor((mx * p) / 100 / 100) * 100)));
                  }}
                >
                  {p === 100 ? "Max" : `${p}%`}
                </button>
              ))}
            </div>
            <div className="prev">
              <div>
                <span>{ui.t("col_locked")}</span>
                <b>{preview ? money(preview.col, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("net_receive")}</span>
                <b>{preview ? money(preview.net, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("interest_30")}</span>
                <b>{preview ? money(preview.interest, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("total_repay")}</span>
                <b>{preview ? money(preview.total, ui.locale) : "—"}</b>
              </div>
            </div>
            <div className="warnline">{warn}</div>
            <div className="row" style={{ marginTop: 0 }}>
              <button className="btn" type="button" disabled={!canBorrow} onClick={() => startOtp({ purpose: "borrow", amount: Number(amt) })}>
                {ui.t("btn_borrow")}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={busy || !signed || !S?.loan || (S.quote ? S.balance < S.quote.total : true)}
                onClick={() => {
                  if (!S?.quote) return;
                  if (!confirm(ui.t("repay_confirm", { amount: money(S.quote.total, ui.locale) }))) return;
                  void startOtp({ purpose: "repay" });
                }}
              >
                {ui.t("btn_repay")}
              </button>
              <button className="btn ghost" type="button" disabled={busy || !signed || !S?.faucetReady} onClick={() => runSimple("faucet", 0, ui.t("act_claim"))}>
                {ui.t("btn_claim")}
              </button>
              <button className="btn ghost" type="button" disabled={busy || !signed} onClick={() => setFundOpen(true)}>
                {ui.t("btn_fund")}
              </button>
            </div>
            <div className={`msg${bad ? " bad" : ""}`}>{msg || ui.t("msg_ready")}</div>
          </div>
          <div className="glass">
            <h2>{ui.t("loan_title")}</h2>
            <div className="kv">
              <div>
                <span>{ui.t("loan_principal")}</span>
                <b>{S?.quote ? money(S.quote.principal, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("loan_interest")}</span>
                <b>{S?.quote ? money(S.quote.interest, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("loan_total")}</span>
                <b>{S?.quote ? money(S.quote.total, ui.locale) : "—"}</b>
              </div>
              <div>
                <span>{ui.t("loan_time")}</span>
                <b>{cd}</b>
              </div>
            </div>
            <div className="bar">
              <div style={{ width: `${barPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="glass">
          <h2>
            {ui.t("chart_title")}
          </h2>
          <p>{ui.t("chart_sub")}</p>
          {signed && S && S.scoreHistory.length && chartOn ? (
            <div className="chartbox">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={S.scoreHistory.map((p) => ({ t: new Date(p.ts).toLocaleDateString(ui.locale, { day: "numeric", month: "short" }), score: p.score }))}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="t" stroke="var(--mut)" fontSize={11} />
                  <YAxis domain={[0, 1000]} stroke="var(--mut)" fontSize={11} width={36} />
                  <Tooltip />
                  <Area type="monotone" dataKey="score" name={ui.t("chart_score")} stroke="var(--c)" fill="var(--v)" fillOpacity={0.25} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty">{ui.t("chart_empty")}</div>
          )}
        </div>
        <div className="glass">
          <h2>{ui.t("cal_title")}</h2>
          <p>{ui.t("cal_sub")}</p>
          <div className="calhead">
            <button className="btn ghost" type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              ‹
            </button>
            <b>{month.toLocaleString(ui.locale, { month: "long", year: "numeric" })}</b>
            <button className="btn ghost" type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              ›
            </button>
          </div>
          <div className="calgrid">
            {(["wd_mon", "wd_tue", "wd_wed", "wd_thu", "wd_fri", "wd_sat", "wd_sun"] as const).map((k) => (
              <span key={k}>{ui.t(k)}</span>
            ))}
            {cells.map((d, i) =>
              d == null ? (
                <span key={`e${i}`} />
              ) : (
                <button key={d} type="button" className={ymd(new Date(month.getFullYear(), month.getMonth(), d)) === today ? "today" : ""}>
                  {d}
                  {kindOn(d).slice(0, 1).map((k) => (
                    <i key={k} className={k} />
                  ))}
                </button>
              ),
            )}
          </div>
          <div className="legend">
            <span><b style={{ background: "var(--p)" }} />{ui.t("cal_due")}</span>
            <span><b style={{ background: "var(--c)" }} />{ui.t("cal_remind")}</span>
            <span><b style={{ background: "var(--ok)" }} />{ui.t("cal_paid")}</span>
            <span><b style={{ background: "var(--v)" }} />{ui.t("cal_opened")}</span>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="glass">
          <h2>{ui.t("stmt_title")}</h2>
          <p>{ui.t("stmt_sub")}</p>
          <div className="row">
            <button className="btn" type="button" disabled={!signed || !S?.statement.length} onClick={() => S && downloadStatement(S, ui.lang, "csv")}>
              {ui.t("stmt_csv")}
            </button>
            <button className="btn ghost" type="button" disabled={!signed || !S?.statement.length} onClick={() => S && downloadStatement(S, ui.lang, "pdf")}>
              {ui.t("stmt_pdf")}
            </button>
          </div>
          {!signed || !S?.statement.length ? <div className="empty">{ui.t("stmt_empty")}</div> : null}
          <h2 style={{ marginTop: 18 }}>{ui.t("receipt_title")}</h2>
          {S?.receipts.length ? (
            S.receipts.map((r) => (
              <div className="tx" key={r.id}>
                <div>
                  <b>{r.id}</b>
                  <small>
                    {new Date(r.ts).toLocaleString(ui.locale)} · {money(r.total, ui.locale)}
                  </small>
                </div>
                <button className="btn ghost" type="button" onClick={() => S && downloadReceipt(S, r)}>
                  {ui.t("receipt_download")}
                </button>
              </div>
            ))
          ) : (
            <div className="empty">{ui.t("receipt_none")}</div>
          )}
        </div>
        <div className="glass" id="inbox">
          <h2>{ui.t("inbox_title")}</h2>
          <p>{ui.t("inbox_sub")}</p>
          <div className="chips">
            {(["sms", "email", "both"] as const).map((c) => (
              <button
                key={c}
                className="chip"
                type="button"
                style={{ borderColor: S?.prefs.channel === c ? "var(--c)" : undefined }}
                disabled={!signed}
                onClick={async () => {
                  if (!ui.token) return;
                  await api("/api/prefs", { method: "POST", token: ui.token, body: { channel: c, lang: ui.lang } });
                  await refresh();
                }}
              >
                {ui.t(c === "sms" ? "ch_sms" : c === "email" ? "ch_email" : "ch_both")}
              </button>
            ))}
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={!signed || busy}
            onClick={async () => {
              if (!ui.token) return;
              setBusy(true);
              try {
                await api("/api/remind", { method: "POST", token: ui.token });
                ui.toast(ui.t("toast_confirmed", { label: ui.t("btn_remind") }), "ok");
                await refresh();
              } catch (e) {
                ui.toast(explain(e, ui.t, ui.locale), "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            {ui.t("btn_remind")}
          </button>
          <div className="schedule">
            {(S?.schedule ?? []).map((item) => (
              <div key={item.kind}>
                <span>
                  {ui.t(
                    item.kind === "opened"
                      ? "kind_opened"
                      : item.kind === "t3"
                        ? "kind_t3"
                        : item.kind === "t1"
                          ? "kind_t1"
                          : item.kind === "due"
                            ? "kind_due"
                            : "kind_overdue",
                  )}
                </span>
                <b>
                  {new Date(item.at).toLocaleString(ui.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} ·{" "}
                  {item.status === "sent" ? ui.t("remind_sent") : item.status === "due" ? ui.t("remind_due") : ui.t("remind_scheduled")}
                </b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="glass">
          <h2>
            {ui.t("tx_title")} <span className="pill">{S?.statement.length ?? 0}</span>
          </h2>
          <p>{ui.t("tx_sub")}</p>
          {S && signed && S.statement.length ? (
            S.statement.slice(0, 12).map((x) => {
              const incoming = x.action === "faucet" || x.action === "borrow" || (x.action === "transfer" && x.to === S.address);
              const show = x.action === "faucet" ? 100000 * U : x.action === "repay" ? x.debit || x.amount : x.amount || x.credit || x.debit;
              return (
                <div className="tx" key={`${x.index}-${x.action}`}>
                  <div>
                    <b>{histLabel(x.action, x.to)}</b>
                    <small>
                      {new Date(x.ts).toLocaleString(ui.locale)} · {ui.t("block_label", { n: x.index })}
                    </small>
                  </div>
                  <b className={x.action === "repay" ? "up" : incoming ? "up" : "dn"}>
                    {x.action === "repay" ? "✓" : `${incoming ? "+" : "−"}${money(show, ui.locale)}`}
                  </b>
                </div>
              );
            })
          ) : (
            <div className="empty">{signed ? ui.t("empty_tx") : ui.t("empty_tx_guest")}</div>
          )}
        </div>
        <div className="glass">
          <details>
            <summary>{ui.t("explorer_title")}</summary>
            <p style={{ marginTop: 10 }}>{ui.t("explorer_sub")}</p>
            {(chain?.blocks ?? []).map((b) => (
              <div className="blk" key={b.index}>
                <b>
                  {ui.t("block_label", { n: b.index })} · nonce {b.nonce}
                </b>
                <br />
                hash <code>{b.hash}</code>
              </div>
            ))}
          </details>
          <details style={{ marginTop: 16 }}>
            <summary>{ui.t("details_title")}</summary>
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
                <b>{S ? `${S.kyc.bank}${S.kyc.ifsc ? ` · ${S.kyc.ifsc}` : ""}` : "—"}</b>
              </div>
            </div>
          </details>
        </div>
      </div>

      {fundOpen ? (
        <div className="sheet" role="dialog" aria-modal="true">
          <form
            className="glass panel"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(fundAmt);
              if (n > 0) void runSimple("fundPool", n, ui.t("act_fund"));
              setFundOpen(false);
            }}
          >
            <h2>{ui.t("fund_title")}</h2>
            <p>{ui.t("fund_help")}</p>
            <input type="number" min={1} value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} />
            <div className="row">
              <button className="btn" type="submit">
                {ui.t("fund_go")}
              </button>
              <button className="btn ghost" type="button" onClick={() => setFundOpen(false)}>
                {ui.t("cancel")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {otp && otpBody ? (
        <OtpDialog
          start={otp}
          onClose={() => setOtp(null)}
          onResend={async () => {
            const start = await api<OtpStart>("/api/otp/request", {
              method: "POST",
              token: ui.token,
              body: { ...otpBody, lang: ui.lang },
            });
            setOtp(start);
          }}
          onConfirm={async (code) => {
            const r = await api<{ index: number }>("/api/otp/confirm", {
              method: "POST",
              token: ui.token,
              body: { challengeId: otp.challengeId, code },
            });
            setOtp(null);
            setAmt("");
            setBad(false);
            setMsg(ui.t("confirmed_in", { label: ui.t("act_borrow"), n: r.index }));
            ui.toast(ui.t("toast_confirmed", { label: String(otpBody.purpose) }), "ok");
            await refresh();
            client.invalidateQueries({ queryKey: ["chain"] });
          }}
        />
      ) : null}
      {stateQ.error instanceof CcError && stateQ.error.code === "err_not_signed_in" ? null : null}
    </>
  );
}
