import { en, type Key, type Pack } from "@/lib/i18n/en";
import { overlays } from "@/lib/i18n/overlays";

export type { Key };
export type Lang = "en" | "hi" | "ta";

export const LANGS: { id: Lang; native: string }[] = [
  { id: "en", native: "English" },
  { id: "hi", native: "हिन्दी" },
  { id: "ta", native: "தமிழ்" },
];

function pack(index: number): Pack {
  const out = { ...en } as Pack;
  for (const key of Object.keys(overlays) as Key[]) {
    const value = overlays[key][index];
    if (value) out[key] = value;
  }
  return out;
}

export const DICTS: Record<Lang, Pack> = {
  en: en as unknown as Pack,
  hi: pack(0),
  ta: pack(1),
};

export function isLang(v: string | null | undefined): v is Lang {
  return v === "en" || v === "hi" || v === "ta";
}

export function tr(lang: string, key: Key, vars?: Record<string, string | number>): string {
  const table = isLang(lang) ? DICTS[lang] : DICTS.en;
  let s = table[key] ?? en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function localeOf(lang: string): string {
  if (lang === "hi") return "hi-IN";
  if (lang === "ta") return "ta-IN";
  return "en-IN";
}

export function isKey(v: string): v is Key {
  return Object.prototype.hasOwnProperty.call(en, v);
}
