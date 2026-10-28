import { downloadBytes, pdfBytes, toCsv } from "@/lib/credchain/pdf";
import { inr } from "@/lib/credchain/money";
import type { Receipt, StatementRow } from "@/lib/credchain/domain";
import type { WalletState } from "@/lib/credchain/types";
import { tr, type Key, type Lang } from "@/lib/i18n/strings";

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function typeKey(row: StatementRow, me: string): Key {
  if (row.action === "faucet") return "type_faucet";
  if (row.action === "borrow") return "type_borrow";
  if (row.action === "repay") return "type_repay";
  if (row.action === "fundPool") return "type_fund";
  if (row.action === "transfer" && row.to === me) return "type_in";
  return "type_out";
}

export function downloadStatement(state: WalletState, lang: Lang, format: "csv" | "pdf") {
  const rows = [...state.statement].reverse();
  if (format === "csv") {
    const headers = ["stmt_date", "stmt_type", "stmt_debit", "stmt_credit", "stmt_balance", "stmt_block"].map((k) =>
      tr(lang, k as Key),
    );
    const body = rows.map((r) => [
      new Date(r.ts).toLocaleString(lang === "en" ? "en-IN" : `${lang}-IN`),
      tr(lang, typeKey(r, state.address)),
      inr(r.debit),
      inr(r.credit),
      inr(r.balance),
      String(r.index),
    ]);
    downloadBytes(`credchain-statement.csv`, "text/csv;charset=utf-8", toCsv(headers, body));
    return;
  }
  const lines = [
    tr("en", "pdf_wallet") + ": " + state.address,
    tr("en", "pdf_generated", { date: stamp(Date.now()) }),
    "",
    ...rows.map(
      (r) =>
        `${stamp(r.ts)}  ${tr("en", typeKey(r, state.address))}  Dr ${inr(r.debit)}  Cr ${inr(r.credit)}  Bal ${inr(r.balance)}  #${r.index}`,
    ),
  ];
  downloadBytes("credchain-statement.pdf", "application/pdf", pdfBytes(tr("en", "pdf_statement"), lines));
}

export function downloadReceipt(state: WalletState, receipt: Receipt) {
  const lines = [
    receipt.id,
    tr("en", "pdf_generated", { date: stamp(receipt.ts) }),
    tr("en", "pdf_wallet") + ": " + state.address,
    tr("en", "pdf_principal") + ": INR " + inr(receipt.principal),
    tr("en", "pdf_interest") + ": INR " + inr(receipt.interest),
    tr("en", "pdf_total") + ": INR " + inr(receipt.total),
    tr("en", "pdf_collateral") + ": INR " + inr(receipt.collateral),
    tr("en", "pdf_score") + ": " + String(receipt.scoreAfter),
    tr("en", "stmt_block") + ": " + String(receipt.block),
    "",
    tr("en", "pdf_thanks"),
  ];
  downloadBytes(`${receipt.id}.pdf`, "application/pdf", pdfBytes(tr("en", "pdf_receipt"), lines));
}
