import type { CalEvent, Hist, Loan, Quote, Receipt, ScorePoint, StatementRow, Terms } from "@/lib/credchain/domain";

export type KycView = {
  email: string;
  mobile: string;
  aadhaar: string;
  bank: string;
  ifsc: string;
};

export type InboxMessage = {
  id: number;
  channel: string;
  title: string;
  body: string;
  kind: string;
  created_at: number;
};

export type ScheduleItem = { kind: string; at: number; status: string };

export type WalletState = {
  address: string;
  created: number;
  kyc: KycView;
  balance: number;
  pool: number;
  terms: Terms;
  history: Hist;
  loan: Loan | null;
  quote: Quote | null;
  faucetReady: boolean;
  height: number;
  statement: StatementRow[];
  receipts: Receipt[];
  scoreHistory: ScorePoint[];
  calendar: CalEvent[];
  messages: InboxMessage[];
  schedule: ScheduleItem[];
  prefs: { channel: string; lang: string };
  qr: string;
};

export type ChainView = {
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

export type OtpStart = {
  challengeId: string;
  masked: string;
  expiresAt: number;
  resendIn: number;
  reused: boolean;
};

export type OtpInbox = {
  ready: boolean;
  expired?: boolean;
  wait?: number;
  masked: string;
  sms?: string;
  email?: string;
  expiresAt?: number;
};
