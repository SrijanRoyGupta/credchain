/** Pure CredChain rules. No Node, no database — safe on the client and the server. */

export const U = 1_000_000;
export const DAY = 86_400_000;
export const LOAN_DAYS = 30;
export const MIN_LOAN = 1000 * U;
export const FAUCET = 100_000 * U;
export const DIFFICULTY = "000";

export const TIERS = [
  { id: "new", lo: 0, max: 5000, col: 100, apr: 24 },
  { id: "developing", lo: 400, max: 20000, col: 50, apr: 18 },
  { id: "established", lo: 600, max: 100000, col: 25, apr: 12 },
  { id: "strong", lo: 800, max: 200000, col: 10, apr: 8 },
] as const;

export type TierId = (typeof TIERS)[number]["id"];

export type Hist = { repaid: number; largest: number; defaults: number };

export type Loan = {
  principal: number;
  collateral: number;
  aprBps: number;
  start: number;
  due: number;
};

export type Tx = {
  from: string;
  action: string;
  amount?: number;
  nonce?: number;
  ts: number;
  to?: string;
  sig?: string;
};

export type Block = {
  index: number;
  prev: string;
  ts: number;
  nonce: number;
  hash: string;
  txs: Tx[];
};

export type Terms = {
  score: number;
  maxLoan: number;
  collateralBps: number;
  aprBps: number;
  tier: TierId;
};

export type Quote = {
  principal: number;
  interest: number;
  total: number;
  due: number;
};

export type Fx =
  | { type: "default"; address: string; score: number }
  | {
      type: "repay";
      address: string;
      principal: number;
      interest: number;
      total: number;
      collateral: number;
      score: number;
      ts: number;
    }
  | { type: "borrow"; address: string; principal: number; due: number; ts: number };

export class CcError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  amount?: number;

  constructor(
    code: string,
    status = 400,
    extra?: { fields?: Record<string, string>; amount?: number; message?: string },
  ) {
    super(extra?.message ?? code);
    this.name = "CcError";
    this.code = code;
    this.status = status;
    this.fields = extra?.fields;
    this.amount = extra?.amount;
  }
}

export function isCcError(e: unknown): e is CcError {
  return (
    e instanceof CcError ||
    (!!e && typeof e === "object" && (e as { name?: string }).name === "CcError")
  );
}

export function tierOf(score: number): (typeof TIERS)[number] {
  return TIERS[score < 400 ? 0 : score < 600 ? 1 : score < 800 ? 2 : 3];
}

export function scoreOf(h: Hist): number {
  const { repaid: R, largest: L, defaults: D } = h;
  return Math.min(1000, Math.max(0, 300 + 50 * Math.min(R, 6) + Math.min(L, 200) - 150 * D));
}

export function termsFrom(h: Hist): Terms {
  const score = scoreOf(h);
  const t = tierOf(score);
  return {
    score,
    maxLoan: t.max * U,
    collateralBps: t.col * 100,
    aprBps: t.apr * 100,
    tier: t.id,
  };
}

const BANKS: Record<string, string> = {
  HDFC: "HDFC Bank",
  SBIN: "State Bank of India",
  ICIC: "ICICI Bank",
  UTIB: "Axis Bank",
  PUNB: "Punjab National Bank",
  KKBK: "Kotak Mahindra Bank",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  YESB: "YES Bank",
  IDIB: "Indian Bank",
  UBIN: "Union Bank of India",
  IOBA: "Indian Overseas Bank",
  BKID: "Bank of India",
  INDB: "IndusInd Bank",
  FDRL: "Federal Bank",
};

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeff(n: string): boolean {
  let c = 0;
  [...n].reverse().forEach((x, i) => {
    c = VD[c][VP[i % 8][+x]];
  });
  return c === 0;
}

export function bankName(ifsc: string): string | null {
  return BANKS[ifsc.slice(0, 4).toUpperCase()] ?? null;
}

export function mask(s: string, keep = 4): string {
  return "X".repeat(Math.max(0, s.length - keep)) + s.slice(-keep);
}

export type KycClean = {
  email: string;
  aadhaar: string;
  bank: string;
  ifsc: string;
  mobile: string;
};

/** Field errors are translation codes, not English sentences. */
export function parseKyc(raw: Record<string, unknown>):
  | { ok: true; value: KycClean }
  | { ok: false; errors: Record<string, string> } {
  const s = (v: unknown) => String(v ?? "").trim();
  const email = s(raw.email).toLowerCase();
  const aadhaar = s(raw.aadhaar).replace(/\s/g, "");
  const bank = s(raw.bank);
  const ifsc = s(raw.ifsc).toUpperCase();
  const mobile = s(raw.mobile).replace(/^\+?91/, "").replace(/\s/g, "");
  const errors: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "err_email";
  if (!/^[2-9]\d{11}$/.test(aadhaar) || !verhoeff(aadhaar)) errors.aadhaar = "err_aadhaar";
  if (!/^\d{9,18}$/.test(bank)) errors.bank = "err_bank";
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) errors.ifsc = "err_ifsc";
  if (!/^[6-9]\d{9}$/.test(mobile)) errors.mobile = "err_mobile";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email, aadhaar, bank, ifsc, mobile } };
}

export function previewLoan(amountUnits: number, terms: Terms) {
  const col = Math.ceil((amountUnits * terms.collateralBps) / 10000);
  const interest = Math.floor((amountUnits * terms.aprBps) / 10000 * (30 / 365));
  return { col, interest, net: amountUnits - col, total: amountUnits + interest };
}

export class Contract {
  bal: Record<string, number> = {};
  pool = 0;
  loans: Record<string, Loan> = {};
  hist: Record<string, Hist> = {};
  faucetAt: Record<string, number> = {};
  nonce: Record<string, number> = {};

  h(a: string): Hist {
    return (this.hist[a] ??= { repaid: 0, largest: 0, defaults: 0 });
  }

  score(a: string): number {
    return scoreOf(this.h(a));
  }

  terms(a: string): Terms {
    return termsFrom(this.h(a));
  }

  quote(a: string, now: number): Quote | null {
    const l = this.loans[a];
    if (!l) return null;
    const interest = Math.floor(
      ((l.principal * l.aprBps) / 10000) * (Math.max(0, now - l.start) / (365 * DAY)),
    );
    return { principal: l.principal, interest, total: l.principal + interest, due: l.due };
  }

  exec(tx: Tx, audit = false): Fx[] {
    const fx: Fx[] = [];
    const { from, action, ts } = tx;
    const amount = tx.amount ?? 0;
    if (action === "init") {
      this.pool = amount;
      return fx;
    }
    if ((this.nonce[from] || 0) !== (tx.nonce ?? 0)) throw new CcError("bad_nonce");
    for (const [a, l] of Object.entries(this.loans)) {
      if (ts > l.due) {
        this.pool += l.collateral;
        this.h(a).defaults += 1;
        delete this.loans[a];
        if (audit) fx.push({ type: "default", address: a, score: this.score(a) });
      }
    }
    const b = this.bal[from] || 0;
    if (action !== "faucet" && action !== "repay" && !(Number.isInteger(amount) && amount > 0)) {
      throw new CcError("invalid_amount");
    }
    if (action === "faucet") {
      if (ts - (this.faucetAt[from] || 0) < DAY) throw new CcError("err_faucet_wait");
      this.faucetAt[from] = ts;
      this.bal[from] = b + FAUCET;
    } else if (action === "fundPool") {
      if (b < amount) throw new CcError("err_insufficient");
      this.bal[from] = b - amount;
      this.pool += amount;
    } else if (action === "borrow") {
      const t = this.terms(from);
      const col = Math.ceil((amount * t.collateralBps) / 10000);
      if (this.loans[from]) throw new CcError("err_active_loan");
      if (amount < MIN_LOAN) throw new CcError("err_min_loan");
      if (amount > t.maxLoan) throw new CcError("err_above_max", 400, { amount: t.maxLoan });
      if (amount > this.pool) throw new CcError("err_low_liquidity");
      if (b < col) throw new CcError("err_need_collateral", 400, { amount: col });
      this.pool -= amount;
      this.bal[from] = b - col + amount;
      const due = ts + LOAN_DAYS * DAY;
      this.loans[from] = { principal: amount, collateral: col, aprBps: t.aprBps, start: ts, due };
      if (audit) fx.push({ type: "borrow", address: from, principal: amount, due, ts });
    } else if (action === "repay") {
      const l = this.loans[from];
      if (!l) throw new CcError("err_no_loan");
      const q = this.quote(from, ts);
      if (!q) throw new CcError("err_no_loan");
      if (b < q.total) throw new CcError("err_need_repay", 400, { amount: q.total });
      this.bal[from] = b - q.total + l.collateral;
      this.pool += q.total;
      const hist = this.h(from);
      hist.repaid += 1;
      hist.largest = Math.max(hist.largest, Math.floor(l.principal / U / 1000));
      delete this.loans[from];
      if (audit) {
        fx.push({
          type: "repay",
          address: from,
          principal: q.principal,
          interest: q.interest,
          total: q.total,
          collateral: l.collateral,
          score: this.score(from),
          ts,
        });
      }
    } else if (action === "transfer") {
      if (!tx.to || tx.to === from) throw new CcError("err_own_wallet");
      if (b < amount) throw new CcError("err_insufficient");
      this.bal[from] = b - amount;
      this.bal[tx.to] = (this.bal[tx.to] || 0) + amount;
    } else {
      throw new CcError("unknown_action");
    }
    this.nonce[from] = (tx.nonce ?? 0) + 1;
    return fx;
  }
}

export type StatementRow = {
  ts: number;
  index: number;
  hash: string;
  action: string;
  amount: number;
  from: string;
  to: string;
  debit: number;
  credit: number;
  balance: number;
};

export type Receipt = {
  id: string;
  ts: number;
  principal: number;
  interest: number;
  total: number;
  collateral: number;
  scoreAfter: number;
  block: number;
};

export type ScorePoint = { ts: number; score: number };

export function project(blocks: Block[], address: string, now: number) {
  const sc = new Contract();
  const rows: StatementRow[] = [];
  const points: ScorePoint[] = [];
  const receipts: Receipt[] = [];
  let lastScore: number | null = null;
  for (const b of blocks) {
    for (const t of b.txs) {
      const before = sc.bal[address] || 0;
      const scoreBefore = address ? sc.score(address) : 0;
      const fx = sc.exec(t, true);
      const after = sc.bal[address] || 0;
      const involved = t.from === address || t.to === address;
      if (involved) {
        const delta = after - before;
        rows.push({
          ts: t.ts,
          index: b.index,
          hash: b.hash,
          action: t.action,
          amount: t.amount ?? 0,
          from: t.from,
          to: t.to ?? "",
          debit: delta < 0 ? -delta : 0,
          credit: delta > 0 ? delta : 0,
          balance: after,
        });
      }
      const score = sc.score(address);
      if (involved || score !== scoreBefore) {
        if (lastScore !== score) {
          points.push({ ts: t.ts, score });
          lastScore = score;
        }
      }
      for (const f of fx) {
        if (f.type === "repay" && f.address === address) {
          receipts.push({
            id: `CC-R-${b.index}`,
            ts: f.ts,
            principal: f.principal,
            interest: f.interest,
            total: f.total,
            collateral: f.collateral,
            scoreAfter: f.score,
            block: b.index,
          });
        }
      }
    }
  }
  return {
    sc,
    rows: rows.reverse(),
    points,
    receipts: receipts.reverse(),
    loan: sc.loans[address] ?? null,
    quote: sc.quote(address, now),
    balance: sc.bal[address] || 0,
    pool: sc.pool,
    terms: sc.terms(address),
    history: sc.h(address),
    faucetReady: now - (sc.faucetAt[address] || 0) >= DAY,
  };
}

export function replay(blocks: Block[]): Contract {
  const sc = new Contract();
  for (const b of blocks) for (const t of b.txs) sc.exec(t);
  return sc;
}

export type CalEvent = {
  date: string;
  kind: "due" | "reminder" | "repaid" | "opened";
  ts: number;
};

export function ymd(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function calendarEvents(loan: Loan | null, receipts: Receipt[]): CalEvent[] {
  const out: CalEvent[] = [];
  for (const r of receipts) out.push({ date: ymd(r.ts), kind: "repaid", ts: r.ts });
  if (loan) {
    out.push({ date: ymd(loan.start), kind: "opened", ts: loan.start });
    const marks = [loan.due - 3 * DAY, loan.due - DAY, loan.due - 2 * 60 * 60 * 1000];
    for (const ts of marks) {
      if (ts > loan.start) out.push({ date: ymd(ts), kind: "reminder", ts });
    }
    out.push({ date: ymd(loan.due), kind: "due", ts: loan.due });
  }
  return out;
}

export type ReminderPlan = { kind: string; at: number };

export function reminderPlan(loan: Loan): ReminderPlan[] {
  const due = loan.due;
  const all: ReminderPlan[] = [
    { kind: "opened", at: loan.start },
    { kind: "t3", at: due - 3 * DAY },
    { kind: "t1", at: due - DAY },
    { kind: "due", at: due - 2 * 60 * 60 * 1000 },
    { kind: "overdue", at: due + 60 * 60 * 1000 },
  ];
  return all.filter((e) => e.kind === "opened" || e.at > loan.start + 60_000);
}
