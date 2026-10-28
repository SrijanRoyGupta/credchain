import { useEffect, useState } from "react";
import { api } from "@/lib/credchain/http";
import { CcError } from "@/lib/credchain/domain";
import { isKey } from "@/lib/i18n/strings";
import type { OtpInbox, OtpStart } from "@/lib/credchain/types";
import { useUi } from "@/components/providers";

export function explain(err: unknown, t: (k: "err_server", vars?: Record<string, string | number>) => string, locale: string) {
  if (err instanceof CcError) {
    const key = isKey(err.code) ? err.code : "err_server";
    const amount =
      typeof err.amount === "number"
        ? `₹${(err.amount / 1_000_000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";
    return t(key as "err_server", amount ? { amount } : undefined);
  }
  return t("err_server");
}

export function OtpDialog({
  start,
  onClose,
  onConfirm,
  onResend,
}: {
  start: OtpStart;
  onClose: () => void;
  onConfirm: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
}) {
  const ui = useUi();
  const [code, setCode] = useState("");
  const [box, setBox] = useState<OtpInbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(start.resendIn);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        const next = await api<OtpInbox>(`/api/otp/inbox?id=${start.challengeId}`);
        if (stop) return;
        setBox(next);
        if (!next.ready && !next.expired) timer = window.setTimeout(tick, 450);
      } catch {
        if (!stop) timer = window.setTimeout(tick, 800);
      }
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [start.challengeId]);

  useEffect(() => {
    setLeft(Math.ceil(start.resendIn / 1000));
  }, [start.challengeId, start.resendIn]);

  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="otp-title">
      <form
        className="glass panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await onConfirm(code);
          } catch (error) {
            setErr(explain(error, ui.t, ui.locale));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="otp-title">{ui.t("otp_title")}</h2>
        <p>{ui.t("otp_sub", { mask: start.masked })}</p>
        <p>{ui.t("otp_expire")}</p>
        <div className="phone" aria-live="polite">
          <small>
            {ui.t("otp_sms_from")} · ••••{start.masked.slice(-2)}
          </small>
          {box?.ready && box.sms ? <div className="bubble">{box.sms}</div> : <div className="bubble">{ui.t("otp_wait_sms")}</div>}
          {box?.ready && box.email ? (
            <>
              <small>{ui.t("otp_email_from")}</small>
              <div className="bubble">{box.email}</div>
            </>
          ) : null}
        </div>
        <div className="f" style={{ marginTop: 14 }}>
          <label htmlFor="otp">{ui.t("otp_title")}</label>
          <input
            id="otp"
            className="otpinput"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        {err ? <div className="msg bad">{err}</div> : null}
        <div className="row">
          <button className="btn" type="submit" disabled={busy || code.length !== 6}>
            {busy ? <span className="spin" /> : null}
            {ui.t("otp_verify")}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={left > 0 || busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onResend();
              } catch (error) {
                setErr(explain(error, ui.t, ui.locale));
              } finally {
                setBusy(false);
              }
            }}
          >
            {left > 0 ? ui.t("otp_resend_in", { s: left }) : ui.t("otp_resend")}
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            {ui.t("cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
