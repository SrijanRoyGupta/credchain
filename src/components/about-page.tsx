import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/credchain/http";
import { money } from "@/lib/credchain/money";
import type { ChainView } from "@/lib/credchain/types";
import { useUi } from "@/components/providers";

const STEP_KEYS = [
  ["step1_t", "step1_d", "step1_p"],
  ["step2_t", "step2_d", "step2_p"],
  ["step3_t", "step3_d", "step3_p"],
  ["step4_t", "step4_d", "step4_p"],
] as const;

export function AboutPage() {
  const ui = useUi();
  const [step, setStep] = useState(0);
  const [pause, setPause] = useState(false);
  const chainQ = useQuery({
    queryKey: ["chain"],
    enabled: typeof window !== "undefined",
    queryFn: () => api<ChainView>("/api/chain"),
    refetchInterval: 6000,
  });
  const c = chainQ.data;
  const words = [ui.t("about_rot_1"), ui.t("about_rot_2"), ui.t("about_rot_3")];
  const [rot, setRot] = useState(words[0]);
  useEffect(() => {
    let i = 0;
    let n = 0;
    let del = false;
    let timer = 0;
    const stepFn = () => {
      const word = words[i] ?? "";
      n += del ? -1 : 1;
      setRot(word.slice(0, Math.max(0, n)));
      let wait = del ? 35 : 70;
      if (!del && n >= word.length) {
        del = true;
        wait = 1500;
      } else if (del && n <= 0) {
        del = false;
        i = (i + 1) % words.length;
        wait = 280;
      }
      timer = window.setTimeout(stepFn, wait);
    };
    timer = window.setTimeout(stepFn, 300);
    return () => window.clearTimeout(timer);
    // words identity changes with language; join keeps the effect honest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.lang]);

  useEffect(() => {
    if (pause) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % 4), 5000);
    return () => window.clearInterval(id);
  }, [pause]);

  const current = STEP_KEYS[step];

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            {ui.t("about_before")} <em className="caret">{rot}</em>.
          </h1>
          <p>{ui.t("about_body")}</p>
          <div className="row">
            <Link className="btn" to="/wallet">
              {ui.t("about_cta")}
            </Link>
            <Link className="btn ghost" to="/">
              {ui.t("about_dash")}
            </Link>
          </div>
        </div>
        <div className="glass live">
          <h2>
            <i />
            {ui.t("about_live")}
          </h2>
          <div className="kv">
            <div>
              <span>{ui.t("stat_blocks")}</span>
              <b>{c ? c.validation.blocks : "—"}</b>
            </div>
            <div>
              <span>{ui.t("about_wallets")}</span>
              <b>{c ? c.wallets : "—"}</b>
            </div>
            <div>
              <span>{ui.t("stat_pool")}</span>
              <b style={{ fontSize: 16 }}>{c ? money(c.pool, ui.locale) : "—"}</b>
            </div>
            <div>
              <span>{ui.t("stat_status")}</span>
              <b>{c ? (c.validation.valid ? ui.t("status_secure") : ui.t("status_broken")) : "—"}</b>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <h2>{ui.t("belief_title")}</h2>
        <p>{ui.t("belief_sub")}</p>
        <div className="grid3">
          <div className="glass card">
            <div className="ic"><Eye size={22} /></div>
            <h2>{ui.t("b1_t")}</h2>
            <p>{ui.t("b1_d")}</p>
          </div>
          <div className="glass card">
            <div className="ic"><TrendingUp size={22} /></div>
            <h2>{ui.t("b2_t")}</h2>
            <p>{ui.t("b2_d")}</p>
          </div>
          <div className="glass card">
            <div className="ic"><ShieldCheck size={22} /></div>
            <h2>{ui.t("b3_t")}</h2>
            <p>{ui.t("b3_d")}</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <h2>{ui.t("how_title")}</h2>
        <p>{ui.t("how_sub")}</p>
        <div className="steps">
          <div className="stepnav">
            {STEP_KEYS.map((k, i) => (
              <button
                key={k[0]}
                type="button"
                className={i === step ? "on" : ""}
                onClick={() => {
                  setPause(true);
                  setStep(i);
                }}
              >
                {i + 1}. {ui.t(k[0])}
              </button>
            ))}
          </div>
          <div className="glass stage">
            <div className="big grad">0{step + 1}</div>
            <h2>{ui.t(current[0])}</h2>
            <p>{ui.t(current[1])}</p>
            <span className="pill">{ui.t(current[2])}</span>
          </div>
        </div>
      </section>

      <section className="sec">
        <h2>{ui.t("terms_title")}</h2>
        <p>{ui.t("terms_sub")}</p>
        <div className="glass tbl">
          <table>
            <thead>
              <tr>
                <th>{ui.t("th_tier")}</th>
                <th>{ui.t("th_score")}</th>
                <th>{ui.t("th_max")}</th>
                <th>{ui.t("th_col")}</th>
                <th>{ui.t("th_apr")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{ui.t("tier_new")}</td>
                <td>{ui.t("range_below", { n: 400 })}</td>
                <td>₹5,000</td>
                <td>100%</td>
                <td>24%</td>
              </tr>
              <tr>
                <td>{ui.t("tier_developing")}</td>
                <td>{ui.t("range_between", { a: 400, b: 599 })}</td>
                <td>₹20,000</td>
                <td>50%</td>
                <td>18%</td>
              </tr>
              <tr>
                <td>{ui.t("tier_established")}</td>
                <td>{ui.t("range_between", { a: 600, b: 799 })}</td>
                <td>₹1,00,000</td>
                <td>25%</td>
                <td>12%</td>
              </tr>
              <tr>
                <td>{ui.t("tier_strong")}</td>
                <td>{ui.t("range_above", { n: 800 })}</td>
                <td>₹2,00,000</td>
                <td>10%</td>
                <td>8%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec" id="security">
        <h2>{ui.t("sec_title")}</h2>
        <p>{ui.t("sec_sub")}</p>
        <div className="grid2">
          {(
            [
              ["sec_1_t", "sec_1_d"],
              ["sec_2_t", "sec_2_d"],
              ["sec_3_t", "sec_3_d"],
              ["sec_4_t", "sec_4_d"],
            ] as const
          ).map(([title, body]) => (
            <div className="glass" key={title}>
              <h2>{ui.t(title)}</h2>
              <p style={{ margin: 0 }}>{ui.t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sec" id="terms">
        <h2>{ui.t("legal_title")}</h2>
        <p>{ui.t("legal_sub")}</p>
        <div className="glass legal">
          <h3>{ui.t("legal_s1_t")}</h3>
          <p>{ui.t("legal_s1_d")}</p>
          <h3>{ui.t("legal_s2_t")}</h3>
          <p>{ui.t("legal_s2_d")}</p>
          <h3>{ui.t("legal_s3_t")}</h3>
          <p>{ui.t("legal_s3_d")}</p>
          <h3>{ui.t("legal_s4_t")}</h3>
          <div className="risk">
            <p style={{ margin: 0 }}>{ui.t("legal_s4_d")}</p>
          </div>
          <h3>{ui.t("legal_s5_t")}</h3>
          <p>{ui.t("legal_s5_d")}</p>
        </div>
      </section>

      <section className="sec">
        <h2>{ui.t("faq_title")}</h2>
        <div style={{ marginTop: 16 }}>
          {(["q1", "q2", "q3", "q4", "q5"] as const).map((q) => (
            <details key={q} className="q">
              <summary>{ui.t(q)}</summary>
              <p>{ui.t(q.replace("q", "a") as "a1")}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="glass cta">
        <h1 style={{ fontSize: "clamp(28px, 5vw, 44px)" }}>{ui.t("cta_title")}</h1>
        <p>{ui.t("cta_sub")}</p>
        <Link className="btn" to="/wallet">
          {ui.t("about_cta")}
        </Link>
      </section>
    </>
  );
}
