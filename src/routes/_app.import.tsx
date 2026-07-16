import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Download,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useMedicines } from "@/lib/queries";
import { formatNumber } from "@/lib/format";
import type { Medicine } from "@/lib/format";

export const Route = createFileRoute("/_app/import")({
  component: ImportPage,
});

interface ParsedRow {
  rowNum: number;
  rawCode: string;
  rawName: string;
  rawBarcode: string;
  quantity: number;
  note: string;
  matched: Medicine | null;
  matchType: "product_code" | "barcode" | "drug_name" | "none";
  error: string | null;
}

// keys we accept in the header (case-insensitive)
const HEADER_ALIASES: Record<string, string[]> = {
  code: ["code", "product_code", "รหัส", "รหัสยา", "code drugs name", "drug_code"],
  name: ["name", "drug_name", "drug name", "ชื่อยา", "ชื่อ"],
  barcode: ["barcode", "บาร์โค้ด", "รหัสบาร์โค้ด", "ean", "upc"],
  qty: ["qty", "quantity", "จำนวน", "รับเข้า", "amount"],
  note: ["note", "หมายเหตุ", "remark", "notes"],
};

function normalizeHeader(h: string): string {
  return String(h ?? "").trim().toLowerCase();
}

function pickField(row: Record<string, unknown>, aliases: string[]): string {
  const map: Record<string, unknown> = {};
  for (const k of Object.keys(row)) map[normalizeHeader(k)] = row[k];
  for (const a of aliases) {
    const v = map[normalizeHeader(a)];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function matchMedicine(
  row: { code: string; name: string; barcode: string },
  meds: Medicine[],
): { matched: Medicine | null; matchType: ParsedRow["matchType"] } {
  if (row.barcode) {
    const m = meds.find((x) => (x.barcode ?? "").trim() === row.barcode.trim());
    if (m) return { matched: m, matchType: "barcode" };
  }
  if (row.code) {
    const m = meds.find(
      (x) => x.product_code.trim().toLowerCase() === row.code.trim().toLowerCase(),
    );
    if (m) return { matched: m, matchType: "product_code" };
  }
  if (row.name) {
    const needle = row.name.trim().toLowerCase();
    const m = meds.find((x) => x.drug_name.trim().toLowerCase() === needle);
    if (m) return { matched: m, matchType: "drug_name" };
  }
  return { matched: null, matchType: "none" };
}

function downloadTemplate() {
  const rows = [
    { product_code: "PARA500", drug_name: "Paracetamol 500 mg", barcode: "8850001234567", quantity: 100, note: "รับเข้าคลัง" },
    { product_code: "", drug_name: "", barcode: "8850009999999", quantity: 50, note: "" },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "receive");
  XLSX.writeFile(wb, "template-รับยาเข้า.xlsx");
}

function ImportPage() {
  const { data: medicines = [], isLoading: medsLoading } = useMedicines();
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const matched = rows.filter((r) => r.matched && !r.error).length;
    const unmatched = rows.filter((r) => !r.matched).length;
    const invalid = rows.filter((r) => r.error).length;
    const totalQty = rows
      .filter((r) => r.matched && !r.error)
      .reduce((s, r) => s + r.quantity, 0);
    return { matched, unmatched, invalid, totalQty };
  }, [rows]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("ไม่พบชีตข้อมูล");
      const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
      });
      if (json.length === 0) {
        toast.error("ไฟล์ว่าง หรือไม่มีหัวคอลัมน์");
        return;
      }

      const parsed: ParsedRow[] = json.map((r, i) => {
        const code = pickField(r, HEADER_ALIASES.code);
        const name = pickField(r, HEADER_ALIASES.name);
        const barcode = pickField(r, HEADER_ALIASES.barcode);
        const qtyStr = pickField(r, HEADER_ALIASES.qty).replace(/,/g, "");
        const note = pickField(r, HEADER_ALIASES.note);
        const qty = Number(qtyStr);

        const { matched, matchType } = matchMedicine({ code, name, barcode }, medicines);
        let error: string | null = null;
        if (!code && !name && !barcode) error = "ไม่มีรหัสยา/ชื่อยา/บาร์โค้ด";
        else if (!Number.isFinite(qty) || qty <= 0) error = "จำนวนไม่ถูกต้อง";
        else if (!matched) error = "ไม่พบยาในฐานข้อมูล";

        return {
          rowNum: i + 2, // +2 = header row + 1-index
          rawCode: code,
          rawName: name,
          rawBarcode: barcode,
          quantity: Number.isFinite(qty) ? qty : 0,
          note,
          matched,
          matchType,
          error,
        };
      });

      setRows(parsed);
      toast.success(`อ่านไฟล์สำเร็จ ${parsed.length} รายการ`);
    } catch (e: any) {
      toast.error("อ่านไฟล์ล้มเหลว: " + (e?.message ?? "ไม่ทราบสาเหตุ"));
      setRows([]);
    }
  };

  const clearAll = () => {
    setRows([]);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeRow = (rowNum: number) => {
    setRows((rs) => rs.filter((r) => r.rowNum !== rowNum));
  };

  const updateQty = (rowNum: number, qty: number) => {
    setRows((rs) =>
      rs.map((r) =>
        r.rowNum === rowNum
          ? { ...r, quantity: qty, error: qty > 0 && r.matched ? null : r.error }
          : r,
      ),
    );
  };

  const confirmImport = async () => {
    const valid = rows.filter((r) => r.matched && !r.error && r.quantity > 0);
    if (valid.length === 0) {
      toast.error("ไม่มีรายการที่พร้อมนำเข้า");
      return;
    }
    setProcessing(true);
    setProgress({ done: 0, total: valid.length });

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      const { error } = await supabase.rpc("process_transaction", {
        _medicine_id: r.matched!.id,
        _type: "receive",
        _quantity: r.quantity,
        _note: r.note || `นำเข้าไฟล์: ${fileName}`,
      });
      if (error) {
        fail++;
        console.error("import row failed", r, error);
      } else {
        ok++;
      }
      setProgress({ done: i + 1, total: valid.length });
    }

    setProcessing(false);
    if (fail === 0) {
      toast.success(`นำเข้าสำเร็จทั้งหมด ${ok} รายการ · สต๊อกอัปเดตแล้ว`);
      clearAll();
    } else {
      toast.warning(`สำเร็จ ${ok} รายการ · ล้มเหลว ${fail} รายการ`);
      // keep failed rows visible
      setRows((rs) =>
        rs.filter((r) => !valid.slice(0, ok).some((v) => v.rowNum === r.rowNum)),
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Instructions + upload */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">นำเข้าไฟล์รับยาเข้าคลัง (Bulk Receive)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              รองรับไฟล์ <b>.xlsx .xls .csv</b> โดยต้องมีคอลัมน์อย่างน้อยหนึ่งอย่างเพื่อระบุยา
              (รหัสยา <code>product_code</code>, ชื่อยา <code>drug_name</code>, หรือ
              บาร์โค้ด <code>barcode</code>) และคอลัมน์จำนวน <code>quantity</code>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              หัวคอลัมน์รองรับภาษาไทย: <code>รหัสยา · ชื่อยา · บาร์โค้ด · จำนวน · หมายเหตุ</code>
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            onClick={() => inputRef.current?.click()}
            disabled={medsLoading || processing}
          >
            <Upload className="h-4 w-4" /> เลือกไฟล์
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> ดาวน์โหลดเทมเพลต .xlsx
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground">
              📄 {fileName} · {rows.length} รายการ
            </span>
          )}
          {rows.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={processing}>
              <X className="h-4 w-4" /> ล้างไฟล์
            </Button>
          )}
        </div>

        <Input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </Card>

      {/* Stats */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">พร้อมนำเข้า</p>
            <p className="text-xl font-bold text-success">{stats.matched}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">ไม่พบยา</p>
            <p className="text-xl font-bold text-destructive">{stats.unmatched}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">ข้อมูลไม่ถูกต้อง</p>
            <p className="text-xl font-bold text-warning">{stats.invalid}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">จำนวนรวม</p>
            <p className="text-xl font-bold">{formatNumber(stats.totalQty)}</p>
          </Card>
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">แถว</th>
                  <th className="px-3 py-2 text-left">รหัส/บาร์โค้ด/ชื่อ (จากไฟล์)</th>
                  <th className="px-3 py-2 text-left">จับคู่กับยาในฐาน</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2 text-left">หมายเหตุ</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNum} className="border-t border-border">
                    <td className="px-3 py-2 text-xs text-muted-foreground">#{r.rowNum}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        {r.rawCode && <span>รหัส: {r.rawCode} </span>}
                        {r.rawBarcode && <span>· BC: {r.rawBarcode} </span>}
                      </div>
                      <div>{r.rawName || <span className="text-muted-foreground">—</span>}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.matched ? (
                        <div>
                          <div className="font-medium">{r.matched.drug_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.matched.product_code} · คงเหลือ {formatNumber(r.matched.current_stock)} {r.matched.unit}
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              จับคู่ด้วย{
                                r.matchType === "barcode" ? "บาร์โค้ด"
                                : r.matchType === "product_code" ? "รหัสยา"
                                : "ชื่อยา"
                              }
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" /> ไม่พบในฐานข้อมูล
                        </span>
                      )}
                      {r.error && r.matched && (
                        <div className="mt-1 text-xs text-destructive">{r.error}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        value={r.quantity}
                        onChange={(e) => updateQty(r.rowNum, Number(e.target.value))}
                        className="h-8 w-24 text-right"
                        disabled={processing || !r.matched}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.note || "-"}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={processing}
                        onClick={() => removeRow(r.rowNum)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              {processing
                ? `กำลังบันทึก ${progress.done}/${progress.total} รายการ...`
                : `พร้อมนำเข้า ${stats.matched} รายการ · รวม ${formatNumber(stats.totalQty)} หน่วย`}
            </p>
            <Button
              onClick={confirmImport}
              disabled={processing || stats.matched === 0}
              size="lg"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังนำเข้า...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> ยืนยันนำเข้า {stats.matched} รายการ
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
