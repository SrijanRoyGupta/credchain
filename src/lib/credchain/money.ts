import { U } from "@/lib/credchain/domain";

export function money(units: number, locale: string): string {
  return `₹${(units / U).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rupees(n: number, locale: string): string {
  return `₹${Math.round(n).toLocaleString(locale)}`;
}

export function inr(units: number): string {
  return (units / U).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
