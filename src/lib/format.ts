export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString("th-TH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(n: number | null | undefined): string {
  return "฿" + formatNumber(n, 2);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("th-TH", { dateStyle: "medium" });
}

export interface Medicine {
  id: string;
  product_code: string;
  drug_name: string;
  strength: string | null;
  form: string | null;
  unit: string;
  barcode: string | null;
  price_per_unit: number;
  usage_rate: number;
  minimum_stock: number;
  current_stock: number;
  created_at: string;
  updated_at: string;
}

export type StockStatus = "out" | "low" | "ok";

export function stockStatus(m: Pick<Medicine, "current_stock" | "minimum_stock">): StockStatus {
  if (m.current_stock <= 0) return "out";
  if (m.current_stock < m.minimum_stock) return "low";
  return "ok";
}

export const TX_TYPE_LABELS: Record<string, string> = {
  disburse: "เบิกจ่าย",
  receive: "รับเข้า",
  adjust: "ปรับยอด",
};
