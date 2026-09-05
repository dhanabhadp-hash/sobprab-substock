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

/** ยาที่มีรหัสยาเดียวกัน (หลายบาร์โค้ด/หลายบริษัท) ถูกรวมเป็นก้อนเดียว */
export interface MedicineGroup {
  key: string;
  product_code: string;
  drug_name: string;
  strength: string | null;
  form: string | null;
  unit: string;
  price_per_unit: number;
  usage_rate: number;
  /** จุดสั่งซื้อขั้นต่ำของรหัสยา (ใช้ค่าสูงสุดในกลุ่ม ไม่บวกซ้ำ) */
  minimum_stock: number;
  /** ยอดคงเหลือรวมทุกบาร์โค้ด */
  current_stock: number;
  barcodes: string[];
  items: Medicine[];
}

export function groupMedicines(medicines: Medicine[]): MedicineGroup[] {
  const map = new Map<string, MedicineGroup>();
  for (const m of medicines) {
    const key = (m.product_code || m.drug_name).trim().toUpperCase();
    const g = map.get(key);
    if (!g) {
      map.set(key, {
        key,
        product_code: m.product_code,
        drug_name: m.drug_name,
        strength: m.strength,
        form: m.form,
        unit: m.unit,
        price_per_unit: m.price_per_unit,
        usage_rate: m.usage_rate,
        minimum_stock: m.minimum_stock,
        current_stock: m.current_stock,
        barcodes: m.barcode ? [m.barcode] : [],
        items: [m],
      });
    } else {
      g.current_stock += m.current_stock;
      g.usage_rate += m.usage_rate;
      g.minimum_stock = Math.max(g.minimum_stock, m.minimum_stock);
      g.price_per_unit = Math.max(g.price_per_unit, m.price_per_unit);
      if (m.barcode) g.barcodes.push(m.barcode);
      g.items.push(m);
    }
  }
  return [...map.values()].sort((a, b) => a.drug_name.localeCompare(b.drug_name, "th"));
}
