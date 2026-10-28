/**
 * CredChain backend. Postgres (Neon in production, PGLite in the preview).
 * The chain is the source of truth; wallets are custodial and authorized by a
 * random session token (only its hash is stored). OTP codes are hashed too.
 */
import { createHash, createHmac, randomBytes, randomInt, generateKeyPairSync, sign, verify } from "node:crypto";
import QRCode from "qrcode";
import { getSql, type Sql } from "@/lib/db";
import { tr, isLang, localeOf, type Key, type Lang } from "@/lib/i18n/strings";
import {
  CcError,
  Contract,
  DIFFICULTY,
  U,
  calendarEvents,
  mask,
  parseKyc,
  project,
  reminderPlan,
  replay,
  type Block,
  type Loan,
  type Tx,
} from "@/lib/credchain/domain";

type Wallet = {
  address: string;
  pub: string;
  priv: string;
  token_hash: string;
  created: number;
  email: string;
  mobile_mask: string;
  mobile_hash: string;
  aadhaar_mask: string;
  aadhaar_hash: string;
  bank_mask: string;
  ifsc: string;
  channel: string;
  lang: string;
};

type OtpRow = {
  id: string;
  purpose: string;
  mobile_hash: string;
  mobile_mask: string;
  code_hash: string;
  expires_at: number;
  attempts: number;
  consumed: boolean;
  created_at: number;
  address: string | null;
  payload: { kind: "signup"; stored: StoredKyc } | { kind: "tx"; action: string; amount: number; to?: string };
  sms: string;
  email_text: string;
};

type StoredKyc = {
  email: string;
  mobileMask: string;
  mobileHash: string;
  aadhaarMask: string;
  aadhaarHash: string;
  bankMask: string;
  ifsc: string;
  lang: Lang;
};

type Mem = {
  version: number;
  blocks: Block[] | null;
  pubs: Map<string, string> | null;
  secret: string | null;
  lock: Promise<void>;
  validation: { height: number; valid: boolean } | null;
  chainBody: { height: number; body: ChainBody } | null;
  qr: Map<string, string>;
};

const ENGINE = 1;
const g = globalThis as typeof globalThis & { __credchain?: Mem };

function mem(): Mem {
  if (!g.__credchain || g.__credchain.version !== ENGINE) {
    g.__credchain = {
      version: ENGINE,
      blocks: null,
      pubs: null,
      secret: null,
      lock: Promise.resolve(),
      validation: null,
      chainBody: null,
      qr: new Map(),
    };
  }
  return g.__credchain;
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const m = mem();
  const prev = m.lock;
  let release: () => void = () => {};
  m.lock = new Promise<void>((r) => {
    release = r;
  });
  return prev.then(fn, fn).finally(() => release());
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");

function payload(t: Tx): string {
  return JSON.stringify([t.from, t.action, t.amount ?? 0, t.nonce, t.ts, t.to ?? ""]);
}

function hashBlock(b: Omit<Block, "hash"> & { hash?: string }): string {
  return sha(b.index + b.prev + b.ts + JSON.stringify(b.txs) + b.nonce);
}

function mine(index: number, prev: string, txs: Tx[], ts: number): Block {
  const b: Block = { index, prev, ts, txs, nonce: 0, hash: "" };
  while (!(b.hash = hashBlock(b)).startsWith(DIFFICULTY)) b.nonce += 1;
  return b;
}

async function sql(): Promise<Sql> {
  return getSql();
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function asTxs(v: unknown): Tx[] {
  if (typeof v === "string") return JSON.parse(v) as Tx[];
  return v as Tx[];
}

async function loadBlocks(db: Sql): Promise<Block[]> {
  const m = mem();
  if (m.blocks) return m.blocks;
  const rows = await db.query<{
    idx: number;
    prev: string;
    ts: number;
    nonce: number;
    hash: string;
    txs: unknown;
  }>("select idx, prev, ts, nonce, hash, txs from cc_blocks order by idx asc");
  const blocks: Block[] = rows.map((r) => ({
    index: num(r.idx),
    prev: r.prev,
    ts: num(r.ts),
    nonce: num(r.nonce),
    hash: r.hash,
    txs: asTxs(r.txs),
  }));
  if (!blocks.length) {
    const genesis = mine(0, "0".repeat(64), [{ from: "system", action: "init", amount: 1_000_000 * U, ts: Date.now() }], Date.now());
    await db.query(
      "insert into cc_blocks (idx, prev, ts, nonce, hash, txs) values ($1,$2,$3,$4,$5,$6)",
      [genesis.index, genesis.prev, genesis.ts, genesis.nonce, genesis.hash, JSON.stringify(genesis.txs)],
    );
    blocks.push(genesis);
  }
  m.blocks = blocks;
  m.validation = null;
  m.chainBody = null;
  return blocks;
}

async function loadPubs(db: Sql): Promise<Map<string, string>> {
  const m = mem();
  if (m.pubs) return m.pubs;
  const rows = await db.query<{ address: string; pub: string }>("select address, pub from cc_wallets");
  m.pubs = new Map(rows.map((r) => [r.address, r.pub]));
  return m.pubs;
}

async function secretOf(db: Sql): Promise<string> {
  const m = mem();
  if (m.secret) return m.secret;
  const rows = await db.query<{ secret: string }>("select secret from cc_meta where id = 1");
  if (rows[0]?.secret) {
    m.secret = rows[0].secret;
    return m.secret;
  }
  const created = randomBytes(32).toString("hex");
  await db.query("insert into cc_meta (id, secret) values (1, $1) on conflict (id) do nothing", [created]);
  const again = await db.query<{ secret: string }>("select secret from cc_meta where id = 1");
  m.secret = again[0].secret;
  return m.secret;
}

function validate(blocks: Block[], pubs: Map<string, string>): boolean {
  const m = mem();
  if (m.validation && m.validation.height === blocks.length) return m.validation.valid;
  let valid = true;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.hash !== hashBlock(b) || !b.hash.startsWith(DIFFICULTY)) {
      valid = false;
      break;
    }
    if (i && b.prev !== blocks[i - 1].hash) {
      valid = false;
      break;
    }
    for (const t of b.txs) {
      if (t.from === "system") continue;
      const pub = pubs.get(t.from);
      if (!pub || !t.sig || !verify("sha256", Buffer.from(payload(t)), pub, Buffer.from(t.sig, "hex"))) {
        valid = false;
        break;
      }
    }
    if (!valid) break;
  }
  m.validation = { height: blocks.length, valid };
  return valid;
}

export type ChainBody = {
  pool: number;
  wallets: number;
  lastTs: number;
  validation: { valid: boolean; blocks: number };
  blocks: {
    index: number;
    hash: string;
    prev: string;
    ts: number;
    nonce: number;
    tx: { from: string; action: string; amount?: number }[];
  }[];
};

export async function publicChain(): Promise<ChainBody> {
  const db = await sql();
  const blocks = await loadBlocks(db);
  const pubs = await loadPubs(db);
  const m = mem();
  if (m.chainBody && m.chainBody.height === blocks.length) return m.chainBody.body;
  const sc = replay(blocks);
  const valid = validate(blocks, pubs);
  const body: ChainBody = {
    pool: sc.pool,
    wallets: pubs.size,
    lastTs: blocks.at(-1)?.ts ?? Date.now(),
    validation: { valid, blocks: blocks.length },
    blocks: blocks
      .slice(-12)
      .reverse()
      .map((b) => ({
        index: b.index,
        hash: b.hash,
        prev: b.prev,
        ts: b.ts,
        nonce: b.nonce,
        tx: b.txs.map((t) => ({ from: t.from, action: t.action, amount: t.amount })),
      })),
  };
  m.chainBody = { height: blocks.length, body };
  return body;
}

export async function lookup(address: string): Promise<{ exists: boolean }> {
  const db = await sql();
  const pubs = await loadPubs(db);
  return { exists: pubs.has(address) };
}

async function walletByToken(db: Sql, token: string | null): Promise<Wallet> {
  if (!token || token.length < 20) throw new CcError("err_not_signed_in", 401);
  const rows = await db.query<Wallet>("select * from cc_wallets where token_hash = $1", [sha(token)]);
  const w = rows[0];
  if (!w) throw new CcError("err_not_signed_in", 401);
  w.created = num(w.created);
  return w;
}

function asLang(v: string | undefined): Lang {
  return isLang(v) ? v : "en";
}

function inr(units: number, lang: Lang): string {
  return `₹${(units / U).toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(ts: number, lang: Lang): string {
  const locale = lang === "en" ? "en-IN" : `${lang}-IN`;
  return new Date(ts).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

async function qrFor(address: string): Promise<string> {
  const m = mem();
  const hit = m.qr.get(address);
  if (hit) return hit;
  const url = await QRCode.toDataURL(address, {
    margin: 1,
    width: 280,
    errorCorrectionLevel: "M",
    color: { dark: "#1a1030", light: "#ffffff" },
  });
  m.qr.set(address, url);
  return url;
}

async function dispatchReminders(db: Sql, w: Wallet, loan: Loan | null) {
  if (!loan) return;
  const plan = reminderPlan(loan);
  const now = Date.now();
  const dueNow = plan.filter((p) => p.at <= now);
  if (!dueNow.length) return;
  const sent = await db.query<{ kind: string }>(
    "select kind from cc_reminder_sent where address = $1 and loan_due = $2",
    [w.address, loan.due],
  );
  const have = new Set(sent.map((r) => r.kind));
  const lang = asLang(w.lang);
  const channels = w.channel === "email" ? ["email"] : w.channel === "sms" ? ["sms"] : ["sms", "email"];
  for (const item of dueNow) {
    if (have.has(item.kind)) continue;
    const vars = { amount: inr(loan.principal, lang), date: when(loan.due, lang) };
    const keys = reminderKeys(item.kind);
    for (const ch of channels) {
      const title = tr(lang, ch === "sms" ? "sms_brand" : keys.title, vars);
      const body = tr(lang, keys.body, vars);
      await db.query(
        "insert into cc_messages (address, channel, title, body, kind, created_at) values ($1,$2,$3,$4,$5,$6)",
        [w.address, ch, title, body, item.kind, now],
      );
    }
    await db.query(
      "insert into cc_reminder_sent (address, loan_due, kind, sent_at) values ($1,$2,$3,$4) on conflict do nothing",
      [w.address, loan.due, item.kind, now],
    );
  }
}

export async function getState(token: string | null) {
  const db = await sql();
  const w = await walletByToken(db, token);
  const blocks = await loadBlocks(db);
  const now = Date.now();
  const view = project(blocks, w.address, now);
  await dispatchReminders(db, w, view.loan);
  const messages = await db.query<{
    id: number;
    channel: string;
    title: string;
    body: string;
    kind: string;
    created_at: number;
  }>("select id, channel, title, body, kind, created_at from cc_messages where address = $1 order by id desc limit 40", [
    w.address,
  ]);
  const sentRows = view.loan
    ? await db.query<{ kind: string }>("select kind from cc_reminder_sent where address = $1 and loan_due = $2", [
        w.address,
        view.loan.due,
      ])
    : [];
  const sent = new Set(sentRows.map((r) => r.kind));
  const schedule = view.loan
    ? reminderPlan(view.loan).map((p) => ({
        kind: p.kind,
        at: p.at,
        status: sent.has(p.kind) ? "sent" : p.at <= now ? "due" : "scheduled",
      }))
    : [];
  const points = [{ ts: num(w.created), score: 300 }, ...view.points.filter((p) => p.ts >= num(w.created))];
  // Collapse a duplicate opening point if the first real point is also 300 at the same moment.
  const scoreHistory =
    points.length > 1 && points[1].score === 300 && Math.abs(points[1].ts - points[0].ts) < 5000
      ? points.slice(1)
      : points;
  return {
    address: w.address,
    created: num(w.created),
    kyc: {
      email: w.email,
      mobile: w.mobile_mask,
      aadhaar: w.aadhaar_mask,
      bank: w.bank_mask,
      ifsc: w.ifsc,
    },
    balance: view.balance,
    pool: view.pool,
    terms: view.terms,
    history: view.history,
    loan: view.loan,
    quote: view.quote,
    faucetReady: view.faucetReady,
    height: blocks.length,
    statement: view.rows.slice(0, 200),
    receipts: view.receipts,
    scoreHistory,
    calendar: calendarEvents(view.loan, view.receipts),
    messages: messages.map((m) => ({ ...m, id: num(m.id), created_at: num(m.created_at) })),
    schedule,
    prefs: { channel: w.channel, lang: w.lang },
    qr: await qrFor(w.address),
  };
}

async function submit(db: Sql, w: Wallet, action: string, amountUnits: number, to?: string) {
  return withLock(async () => {
    const blocks = await loadBlocks(db);
    const pubs = await loadPubs(db);
    if (action === "transfer") {
      if (!to || !pubs.has(to)) throw new CcError("err_unknown_wallet");
      if (to === w.address) throw new CcError("err_own_wallet");
    }
    const sc = replay(blocks);
    const tx: Tx = {
      from: w.address,
      action,
      amount: action === "repay" || action === "faucet" ? 0 : amountUnits,
      nonce: sc.nonce[w.address] || 0,
      ts: Date.now(),
    };
    if (to && action === "transfer") tx.to = to;
    tx.sig = sign("sha256", Buffer.from(payload(tx)), w.priv).toString("hex");
    const trial = new Contract();
    for (const b of blocks) for (const t of b.txs) trial.exec(t);
    trial.exec(tx);
    const last = blocks[blocks.length - 1];
    const blk = mine(last.index + 1, last.hash, [tx], tx.ts);
    await db.query(
      "insert into cc_blocks (idx, prev, ts, nonce, hash, txs) values ($1,$2,$3,$4,$5,$6)",
      [blk.index, blk.prev, blk.ts, blk.nonce, blk.hash, JSON.stringify(blk.txs)],
    );
    blocks.push(blk);
    mem().validation = null;
    mem().chainBody = null;
    return { hash: blk.hash, index: blk.index };
  });
}

export async function simpleTx(token: string | null, action: string, amountRupees?: number) {
  if (action !== "faucet" && action !== "fundPool") throw new CcError("err_otp_required");
  const db = await sql();
  const w = await walletByToken(db, token);
  const amount = action === "faucet" ? 0 : Math.round(Number(amountRupees) * U);
  if (action === "fundPool" && !(amount > 0)) throw new CcError("invalid_amount");
  return submit(db, w, action, amount);
}

const OTP_TTL = 5 * 60 * 1000;
const RESEND = 30 * 1000;

function codeHash(secret: string, id: string, code: string) {
  return hmac(secret, `${id}:${code}`);
}

type OtpPurpose = "signup" | "send" | "borrow" | "repay";

function purposeKey(p: OtpPurpose): "otp_sms_signup" | "otp_sms_send" | "otp_sms_borrow" | "otp_sms_repay" {
  if (p === "signup") return "otp_sms_signup";
  if (p === "send") return "otp_sms_send";
  if (p === "borrow") return "otp_sms_borrow";
  return "otp_sms_repay";
}

export async function requestOtp(body: Record<string, unknown>, token: string | null) {
  const purpose = String(body.purpose ?? "");
  if (purpose !== "signup" && purpose !== "send" && purpose !== "borrow" && purpose !== "repay") {
    throw new CcError("bad_json");
  }
  const db = await sql();
  const secret = await secretOf(db);
  const lang = asLang(typeof body.lang === "string" ? body.lang : undefined);
  let mobileHash = "";
  let mobileMask = "";
  let address: string | null = null;
  let payload: OtpRow["payload"];

  if (purpose === "signup") {
    const parsed = parseKyc(body);
    if (!parsed.ok) throw new CcError("kyc", 422, { fields: parsed.errors });
    const v = parsed.value;
    const aadhaarHash = hmac(secret, `aadhaar:${v.aadhaar}`);
    const taken = await db.query<{ address: string }>("select address from cc_wallets where aadhaar_hash = $1", [
      aadhaarHash,
    ]);
    if (taken.length) throw new CcError("err_aadhaar_taken", 409, { fields: { aadhaar: "err_aadhaar_taken" } });
    mobileHash = hmac(secret, `mobile:${v.mobile}`);
    mobileMask = mask(v.mobile, 2);
    payload = {
      kind: "signup",
      stored: {
        email: v.email,
        mobileMask,
        mobileHash,
        aadhaarMask: mask(v.aadhaar),
        aadhaarHash,
        bankMask: mask(v.bank),
        ifsc: v.ifsc,
        lang,
      },
    };
  } else {
    const w = await walletByToken(db, token);
    address = w.address;
    mobileHash = w.mobile_hash;
    mobileMask = w.mobile_mask;
    const blocks = await loadBlocks(db);
    const view = project(blocks, w.address, Date.now());
    if (purpose === "repay") {
      if (!view.loan) throw new CcError("err_no_loan");
      payload = { kind: "tx", action: "repay", amount: 0 };
    } else if (purpose === "borrow") {
      const amount = Math.round(Number(body.amount) * U);
      if (!(amount > 0)) throw new CcError("invalid_amount");
      payload = { kind: "tx", action: "borrow", amount };
    } else {
      const to = String(body.to ?? "").trim();
      const amount = Math.round(Number(body.amount) * U);
      const pubs = await loadPubs(db);
      if (!pubs.has(to)) throw new CcError("err_unknown_wallet");
      if (to === w.address) throw new CcError("err_own_wallet");
      if (!(amount > 0)) throw new CcError("invalid_amount");
      payload = { kind: "tx", action: "transfer", amount, to };
    }
  }

  const recent = await db.query<{ id: string; created_at: number; consumed: boolean; expires_at: number }>(
    "select id, created_at, consumed, expires_at from cc_otp where mobile_hash = $1 and purpose = $2 order by created_at desc limit 1",
    [mobileHash, purpose],
  );
  const last = recent[0];
  const now = Date.now();
  if (last && !last.consumed && num(last.expires_at) > now && now - num(last.created_at) < RESEND) {
    return {
      challengeId: last.id,
      masked: mobileMask,
      expiresAt: num(last.expires_at),
      resendIn: RESEND - (now - num(last.created_at)),
      reused: true,
    };
  }

  const id = randomBytes(16).toString("hex");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const sms = tr(lang, purposeKey(purpose), { code });
  const emailBody = tr(lang, "otp_email_body", { code });
  await db.query(
    `insert into cc_otp (id, purpose, mobile_hash, mobile_mask, code_hash, expires_at, attempts, consumed, created_at, address, payload, sms, email_text)
     values ($1,$2,$3,$4,$5,$6,0,false,$7,$8,$9,$10,$11)`,
    [
      id,
      purpose,
      mobileHash,
      mobileMask,
      codeHash(secret, id, code),
      now + OTP_TTL,
      now,
      address,
      JSON.stringify(payload),
      sms,
      emailBody,
    ],
  );
  return { challengeId: id, masked: mobileMask, expiresAt: now + OTP_TTL, resendIn: RESEND, reused: false };
}

function parsePayload(v: unknown): OtpRow["payload"] {
  const obj = typeof v === "string" ? (JSON.parse(v) as OtpRow["payload"]) : (v as OtpRow["payload"]);
  return obj;
}

export async function otpInbox(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CcError("not_found", 404);
  const db = await sql();
  const rows = await db.query<OtpRow>("select * from cc_otp where id = $1", [id]);
  const row = rows[0];
  if (!row) throw new CcError("not_found", 404);
  const created = num(row.created_at);
  const expires = num(row.expires_at);
  const now = Date.now();
  if (row.consumed || expires < now) return { ready: false, expired: true, masked: row.mobile_mask };
  if (now < created + 900) return { ready: false, expired: false, wait: created + 900 - now, masked: row.mobile_mask };
  return { ready: true, expired: false, masked: row.mobile_mask, sms: row.sms, email: row.email_text, expiresAt: expires };
}

export async function confirmOtp(challengeId: string, code: string, token: string | null) {
  if (!/^[a-f0-9]{32}$/.test(challengeId) || !/^\d{6}$/.test(code)) throw new CcError("err_bad_otp");
  const db = await sql();
  const secret = await secretOf(db);
  const rows = await db.query<OtpRow>("select * from cc_otp where id = $1", [challengeId]);
  const row = rows[0];
  if (!row) throw new CcError("err_bad_otp");
  if (row.consumed) throw new CcError("err_otp_expired");
  if (num(row.expires_at) < Date.now()) throw new CcError("err_otp_expired");
  if (num(row.attempts) >= 5) throw new CcError("err_otp_locked", 429);
  const expect = codeHash(secret, row.id, code);
  const a = Buffer.from(expect);
  const b = Buffer.from(row.code_hash);
  const match = a.length === b.length && timingEqual(a, b);
  if (!match) {
    const next = await db.query<{ attempts: number }>(
      "update cc_otp set attempts = attempts + 1 where id = $1 returning attempts",
      [row.id],
    );
    if (num(next[0]?.attempts) >= 5) {
      await db.query("update cc_otp set consumed = true where id = $1", [row.id]);
      throw new CcError("err_otp_locked", 429);
    }
    throw new CcError("err_bad_otp");
  }
  const payload = parsePayload(row.payload);
  const locked = await db.query<{ id: string }>(
    "update cc_otp set consumed = true where id = $1 and consumed = false returning id",
    [row.id],
  );
  if (!locked.length) throw new CcError("err_otp_expired");
  try {
    if (payload.kind === "signup") {
      const result = await createWallet(db, payload.stored);
      return { kind: "signup" as const, ...result };
    }
    const w = await walletByToken(db, token);
    if (row.address !== w.address) throw new CcError("err_bad_otp");
    const blk = await submit(db, w, payload.action, payload.amount, payload.to);
    return { kind: "tx" as const, ...blk };
  } catch (err) {
    await db.query("update cc_otp set consumed = false where id = $1", [row.id]);
    throw err;
  }
}

function timingEqual(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function createWallet(db: Sql, stored: StoredKyc) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const address = `0x${sha(pub).slice(-40)}`;
  const token = randomBytes(32).toString("hex");
  try {
    await db.query(
      `insert into cc_wallets (address, pub, priv, token_hash, created, email, mobile_mask, mobile_hash, aadhaar_mask, aadhaar_hash, bank_mask, ifsc, channel, lang)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'both',$13)`,
      [
        address,
        pub,
        priv,
        sha(token),
        Date.now(),
        stored.email,
        stored.mobileMask,
        stored.mobileHash,
        stored.aadhaarMask,
        stored.aadhaarHash,
        stored.bankMask,
        stored.ifsc,
        stored.lang,
      ],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    const msg = String((err as { message?: string }).message ?? "");
    if (code === "23505" || /unique|duplicate/i.test(msg)) {
      throw new CcError("err_aadhaar_taken", 409, { fields: { aadhaar: "err_aadhaar_taken" } });
    }
    throw err;
  }
  const pubs = await loadPubs(db);
  pubs.set(address, pub);
  mem().chainBody = null;
  return { address, token };
}

export async function updatePrefs(token: string | null, channel: string, lang: string) {
  if (channel !== "sms" && channel !== "email" && channel !== "both") throw new CcError("bad_json");
  const db = await sql();
  const w = await walletByToken(db, token);
  const l = asLang(lang);
  await db.query("update cc_wallets set channel = $1, lang = $2 where address = $3", [channel, l, w.address]);
  return { ok: true, channel, lang: l };
}

export async function remindNow(token: string | null) {
  const db = await sql();
  const w = await walletByToken(db, token);
  const blocks = await loadBlocks(db);
  const view = project(blocks, w.address, Date.now());
  if (!view.loan) throw new CcError("err_no_active_loan");
  const recent = await db.query<{ created_at: number }>(
    "select created_at from cc_messages where address = $1 and kind = 'manual' order by id desc limit 1",
    [w.address],
  );
  const now = Date.now();
  if (recent[0] && now - num(recent[0].created_at) < 60_000) throw new CcError("err_remind_wait", 429);
  const lang = asLang(w.lang);
  const vars = { amount: inr(view.loan.principal, lang), date: when(view.loan.due, lang) };
  const channels = w.channel === "email" ? ["email"] : w.channel === "sms" ? ["sms"] : ["sms", "email"];
  for (const ch of channels) {
    await db.query(
      "insert into cc_messages (address, channel, title, body, kind, created_at) values ($1,$2,$3,$4,$5,$6)",
      [w.address, ch, tr(lang, "rem_manual_title", vars), tr(lang, "rem_manual_body", vars), "manual", now],
    );
  }
  return { ok: true };
}

function reminderKeys(kind: string): { title: Key; body: Key } {
  if (kind === "t3") return { title: "rem_t3_title", body: "rem_t3_body" };
  if (kind === "t1") return { title: "rem_t1_title", body: "rem_t1_body" };
  if (kind === "due") return { title: "rem_due_title", body: "rem_due_body" };
  if (kind === "overdue") return { title: "rem_overdue_title", body: "rem_overdue_body" };
  return { title: "rem_opened_title", body: "rem_opened_body" };
}
