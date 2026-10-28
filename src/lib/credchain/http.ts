import { CcError } from "@/lib/credchain/domain";

export async function api<T>(
  path: string,
  opts?: { method?: string; token?: string | null; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? (opts?.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(opts?.token ? { "x-token": opts.token } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const body = (data ?? {}) as { error?: string; code?: string; fields?: Record<string, string>; amount?: number };
    throw new CcError(body.code || "err_server", res.status, {
      message: body.error,
      fields: body.fields,
      amount: body.amount,
    });
  }
  return data as T;
}
