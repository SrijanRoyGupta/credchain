-- CredChain ledger, wallets, OTP challenges, and reminder inbox.
-- Amounts are integer micro-rupees (1 INR = 1_000_000). Raw Aadhaar,
-- bank account, and mobile numbers are never stored.

create table if not exists cc_meta (
  id int primary key,
  secret text not null
);

create table if not exists cc_blocks (
  idx int primary key,
  prev text not null,
  ts bigint not null,
  nonce int not null,
  hash text not null,
  txs text not null
);

create table if not exists cc_wallets (
  address text primary key,
  pub text not null,
  priv text not null,
  token_hash text not null unique,
  created bigint not null,
  email text not null,
  mobile_mask text not null,
  mobile_hash text not null,
  aadhaar_mask text not null,
  aadhaar_hash text not null unique,
  bank_mask text not null,
  ifsc text not null,
  channel text not null default 'both',
  lang text not null default 'en'
);

create index if not exists cc_wallets_token_idx on cc_wallets (token_hash);

create table if not exists cc_otp (
  id text primary key,
  purpose text not null,
  mobile_hash text not null,
  mobile_mask text not null,
  code_hash text not null,
  expires_at bigint not null,
  attempts int not null default 0,
  consumed boolean not null default false,
  created_at bigint not null,
  address text,
  payload text not null,
  sms text not null,
  email_text text not null
);

create index if not exists cc_otp_mobile_idx on cc_otp (mobile_hash, purpose, created_at desc);

create table if not exists cc_messages (
  id serial primary key,
  address text not null,
  channel text not null,
  title text not null,
  body text not null,
  kind text not null,
  created_at bigint not null
);

create index if not exists cc_messages_addr_idx on cc_messages (address, created_at desc);

create table if not exists cc_reminder_sent (
  address text not null,
  loan_due bigint not null,
  kind text not null,
  sent_at bigint not null,
  primary key (address, loan_due, kind)
);
