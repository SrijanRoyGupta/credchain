import { CcError, isCcError } from "@/lib/credchain/domain";

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function tokenOf(request: Request): string | null {
  const t = request.headers.get("x-token");
  if (!t || t.length > 200) return null;
  return t;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 100_000) throw new CcError("bad_json");
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object") throw new CcError("bad_json");
    return v as Record<string, unknown>;
  } catch (err) {
    if (isCcError(err)) throw err;
    throw new CcError("bad_json");
  }
}

export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (isCcError(e)) {
      const err = e as CcError;
      return json(
        { error: err.message, code: err.code, errors: err.fields, amount: err.amount },
        err.status || 400,
      );
    }
    console.error("[credchain]", e);
    return json({ error: "err_server", code: "err_server" }, 500);
  }
}
