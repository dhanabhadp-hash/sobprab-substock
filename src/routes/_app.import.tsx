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
  Sparkles,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useMedicines } from "@/lib/queries";
import { formatNumber } from "@/lib/format";
import type { Medicine } from "@/lib/format";
import { fuzzyFindMedicines } from "@/lib/fuzzy-match";

export const Route = createFileRoute("/_app/import")({
  component: ImportPage,
  head: () => ({
    meta: [
      { title: "นำเข้าไฟล์รับยา | สับสต๊อก" },
      {
        name: "description",
        content:
          "นำเข้าไฟล์ดิบรับยาเข้าคลัง วิเคราะห์และจับคู่รายการยาอัตโนมัติจากชื่อยา ความแรง และรูปแบบ พร้อมตรวจสอบก่อนบันทึก",
      },
      { property: "og:title", content: "นำเข้าไฟล์รับยา | สับสต๊อก" },
      {
        property: "og:description",
        content: "จับคู่รายการยาอัตโนมัติจากไฟล์ดิบก่อนอัปเดตสต๊อกจริง",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type MatchType = "barcode" | "product_code" | "exact_name" | "fuzzy" | "manual" | "none";

interface Suggestion {
  med: Medicine;
  score: number;
}

interface ParsedRow {
  rowNum: number;
  rawCode: string;
  rawName: string;
  rawBarcode: string;
  quantity: number;
  note: string;
  matched: Medicine | null;
  matchType: MatchType;
  score: number;
  suggestions: Suggestion[];
  skip: boolean;
  error: string | null;
}

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["code", "code1", "product_code", "รหัส", "รหัสยา", "code drugs name", "drug_code", "codedrug"],
  name: ["name", "name1", "drug_name", "drug name", "ชื่อยา", "ชื่อ", "รายการ", "รายการยา", "description"],
  barcode: ["barcode", "บาร์โค้ด", "รหัสบาร์โค้ด", "ean", "upc"],
  qty: ["qty", "quantity", "amount", "amount1", "จำนวน", "รับเข้า", "จำนวนรับ", "จน."],
  note: ["note", "หมายเหตุ", "remark", "notes", "vendor", "ven", "expdate"],
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** ค้นหาแถวหัวคอลัมน์ในไฟล์ดิบ (อาจไม่ได้อยู่แถวแรก) */
function detectHeaderRow(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 15);
  for (let i = 0; i < limit; i++) {
    const cells = (grid[i] ?? []).map(norm);
    const hasName = cells.some((c) => HEADER_ALIASES.name.includes(c));
    const hasQty = cells.some((c) => HEADER_ALIASES.qty.includes(c));
    if (hasName && hasQty) return i;
  }
  return -1;
}

function indexOfAlias(headers: string[], aliases: string[]): number {
  return headers.findIndex((h) => aliases.includes(h));
}

/** เดาคอลัมน์จากเนื้อหา เมื่อไม่พบหัวคอลัมน์ */
function guessColumns(rows: unknown[][]): { name: number; qty: number; code: number } {
  const width = Math.max(...rows.map((r) => r.length), 0);
  let name = -1;
  let bestTextScore = 0;
  let qty = -1;
  let bestNumScore = 0;
  for (let c = 0; c < width; c++) {
    let textLen = 0;
    let numCount = 0;
    let filled = 0;
    for (const r of rows) {
      const v = String(r[c] ?? "").trim();
      if (!v) continue;
      filled++;
      const n = Number(v.replace(/,/g, ""));
      if (Number.isFinite(n)) numCount++;
      else textLen += v.length;
    }
    if (!filled) continue;
    const textScore = textLen / filled;
    if (textScore > bestTextScore) {
      bestTextScore = textScore;
      name = c;
    }
    const numScore = numCount / filled;
    if (numScore > bestNumScore && c !== name) {
      bestNumScore = numScore;
      qty = c;
    }
  }
  const code = name > 0 ? name - 1 : -1;
  return { name, qty, code };
}

function medText(m: Medicine): string {
  return [m.drug_name, m.strength, m.form].filter(Boolean).join(" ");
}

function analyzeRow(
  raw: { code: string; name: string; barcode: string },
  meds: Medicine[],
): { matched: Medicine | null; matchType: MatchType; score: number; suggestions: Suggestion[] } {
  if (raw.barcode) {
    const m = meds.find((x) => (x.barcode ?? "").trim() === raw.barcode.trim());
    if (m) return { matched: m, matchType: "barcode", score: 1, suggestions: [] };
  }
  if (raw.name) {
    const needle = norm(raw.name);
    const exact = meds.find((x) => norm(medText(x)) === needle || norm(x.drug_name) === needle);
    if (exact) return { matched: exact, matchType: "exact_name", score: 1, suggestions: [] };

    const cands = fuzzyFindMedicines([raw.name], meds, medText, 0.55);
    if (cands.length) {
      const suggestions = cands.map((c) => ({ med: c.item, score: c.score }));
      const top = suggestions[0];
      if (top.score >= 0.7) {
        return { matched: top.med, matchType: "fuzzy", score: top.score, suggestions };
      }
      return { matched: null, matchType: "none", score: top.score, suggestions };
    }
  }
  if (raw.code) {
    const m = meds.find((x) => norm(x.product_code) === norm(raw.code));
    if (m) return { matched: m, matchType: "product_code", score: 1, suggestions: [] };
  }
  return { matched: null, matchType: "none", score: 0, suggestions: [] };
}

const MATCH_LABEL: Record<MatchType, string> = {
  barcode: "บาร์โค้ด",
  product_code: "รหัสยา",
  exact_name: "ชื่อยาตรงกัน",
  fuzzy: "AI วิเคราะห์ชื่อยา",
  manual: "เลือกเอง",
  none: "ไม่พบ",
};

function downloadTemplate() {
  const rows = [
    { CODE1: "EVO001", NAME1: "salmeterol+fluticasone EVO 25+125 mcg", Amount1: 40, note: "" },
    { CODE1: "0000298", NAME1: "D-5-S inf 1000 ml.", Amount1: 10, note: "" },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "receive");
  XLSX.writeFile(wb, "template-รับยาเข้า.xlsx");
}

function ImportPage() {
  const { data: medicines = [], isLoading: medsLoading } = useMedicines();
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const sortedMeds = useMemo(
    () => [...medicines].sort((a, b) => a.drug_name.localeCompare(b.drug_name, "th")),
    [medicines],
  );

  const stats = useMemo(() => {
    const active = rows.filter((r) => !r.skip);
    const ready = active.filter((r) => r.matched && !r.error);
    const auto = ready.filter((r) => r.matchType === "fuzzy").length;
    const review = active.filter((r) => !r.matched).length;
    const totalQty = ready.reduce((s, r) => s + r.quantity, 0);
    return { ready: ready.length, auto, review, totalQty, skipped: rows.length - active.length };
  }, [rows]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sName = wb.SheetNames[0];
      const sheet = wb.Sheets[sName];
      if (!sheet) throw new Error("ไม่พบชีตข้อมูล");
      setSheetName(sName);

      const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      if (!grid.length) {
        toast.error("ไฟล์ว่าง");
        return;
      }

      const headerIdx = detectHeaderRow(grid);
      let dataRows: unknown[][];
      let cols: { name: number; qty: number; code: number; barcode: number; note: number };
      let offset: number;

      if (headerIdx >= 0) {
        const headers = (grid[headerIdx] ?? []).map(norm);
        dataRows = grid.slice(headerIdx + 1);
        offset = headerIdx + 2;
        cols = {
          name: indexOfAlias(headers, HEADER_ALIASES.name),
          qty: indexOfAlias(headers, HEADER_ALIASES.qty),
          code: indexOfAlias(headers, HEADER_ALIASES.code),
          barcode: indexOfAlias(headers, HEADER_ALIASES.barcode),
          note: indexOfAlias(headers, HEADER_ALIASES.note),
        };
      } else {
        dataRows = grid;
        offset = 1;
        const g = guessColumns(grid);
        cols = { ...g, barcode: -1, note: -1 };
      }

      if (cols.name < 0) {
        toast.error("ไม่พบคอลัมน์ชื่อยาในไฟล์");
        setRows([]);
        return;
      }

      const parsed: ParsedRow[] = [];
      dataRows.forEach((r, i) => {
        const name = String(r[cols.name] ?? "").trim();
        const code = cols.code >= 0 ? String(r[cols.code] ?? "").trim() : "";
        const barcode = cols.barcode >= 0 ? String(r[cols.barcode] ?? "").trim() : "";
        const note = cols.note >= 0 ? String(r[cols.note] ?? "").trim() : "";
        const qtyStr = cols.qty >= 0 ? String(r[cols.qty] ?? "").replace(/,/g, "").trim() : "";
        const qty = Number(qtyStr);

        // ข้ามบรรทัดว่าง/บรรทัดหัวเรื่องซ้ำ
        if (!name || HEADER_ALIASES.name.includes(norm(name))) return;
        if (!/[a-zA-Zก-๙]/.test(name)) return;

        const { matched, matchType, score, suggestions } = analyzeRow(
          { code, name, barcode },
          medicines,
        );

        let error: string | null = null;
        if (!Number.isFinite(qty) || qty <= 0) error = "จำนวนไม่ถูกต้อง";
        else if (!matched) error = "ยังไม่ได้จับคู่ยา";

        parsed.push({
          rowNum: offset + i,
          rawCode: code,
          rawName: name,
          rawBarcode: barcode,
          quantity: Number.isFinite(qty) ? qty : 0,
          note,
          matched,
          matchType,
          score,
          suggestions,
          skip: false,
          error,
        });
      });

      setRows(parsed);
      const autoMatched = parsed.filter((p) => p.matched).length;
      toast.success(
        `อ่านไฟล์สำเร็จ ${parsed.length} รายการ · จับคู่อัตโนมัติได้ ${autoMatched} รายการ`,
      );
    } catch (e: any) {
      toast.error("อ่านไฟล์ล้มเหลว: " + (e?.message ?? "ไม่ทราบสาเหตุ"));
      setRows([]);
    }
  };

  const clearAll = () => {
    setRows([]);
    setFileName("");
    setSheetName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const patchRow = (rowNum: number, patch: Partial<ParsedRow>) =>
    setRows((rs) => rs.map((r) => (r.rowNum === rowNum ? { ...r, ...patch } : r)));

  const setManual = (rowNum: number, medId: string) => {
    const med = medicines.find((m) => m.id === medId) ?? null;
    setRows((rs) =>
      rs.map((r) =>
        r.rowNum === rowNum
          ? {
              ...r,
              matched: med,
              matchType: med ? "manual" : "none",
              score: med ? 1 : 0,
              error: !med ? "ยังไม่ได้จับคู่ยา" : r.quantity > 0 ? null : "จำนวนไม่ถูกต้อง",
            }
          : r,
      ),
    );
  };

  const updateQty = (rowNum: number, qty: number) =>
    setRows((rs) =>
      rs.map((r) =>
        r.rowNum === rowNum
          ? { ...r, quantity: qty, error: qty > 0 && r.matched ? null : r.matched ? "จำนวนไม่ถูกต้อง" : r.error }
          : r,
      ),
    );

  const confirmImport = async () => {
    const valid = rows.filter((r) => !r.skip && r.matched && !r.error && r.quantity > 0);
    if (valid.length === 0) {
      toast.error("ไม่มีรายการที่พร้อมนำเข้า");
      return;
    }
    setProcessing(true);
    setProgress({ done: 0, total: valid.length });

    let ok = 0;
    let fail = 0;
    const doneRows: number[] = [];
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
        doneRows.push(r.rowNum);
      }
      setProgress({ done: i + 1, total: valid.length });
    }

    setProcessing(false);
    if (fail === 0) {
      toast.success(`นำเข้าสำเร็จทั้งหมด ${ok} รายการ · สต๊อกอัปเดตแล้ว`);
      clearAll();
    } else {
      toast.warning(`สำเร็จ ${ok} รายการ · ล้มเหลว ${fail} รายการ`);
      setRows((rs) => rs.filter((r) => !doneRows.includes(r.rowNum)));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold">นำเข้าไฟล์รับยาเข้าคลัง (ไฟล์ดิบ)</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              รองรับไฟล์ <b>.xlsx .xls .csv</b> แบบดิบจากฝ่ายจัดซื้อ/คลังใหญ่ ระบบจะหาแถวหัวคอลัมน์เอง
              และ <b>วิเคราะห์จับคู่รายการยาจากชื่อยา ความแรง และรูปแบบ</b> โดยไม่ต้องใช้รหัสยาหรือบาร์โค้ด
              (เพราะรหัสของสองระบบไม่ตรงกัน)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              รายการที่ความมั่นใจ ≥ 70% จะจับคู่ให้อัตโนมัติ · ต่ำกว่านั้นจะแสดงตัวเลือกใกล้เคียงให้ผู้ดูแลเลือกเอง
              ก่อนยืนยันนำเข้าจริง
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => inputRef.current?.click()} disabled={medsLoading || processing}>
            <Upload className="h-4 w-4" /> เลือกไฟล์
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> ดาวน์โหลดเทมเพลต .xlsx
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground">
              📄 {fileName}
              {sheetName && ` · ชีต ${sheetName}`} · {rows.length} รายการ
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

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">พร้อมนำเข้า</p>
            <p className="text-xl font-bold text-success">{stats.ready}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">จับคู่โดย AI</p>
            <p className="text-xl font-bold text-primary">{stats.auto}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">ต้องตรวจสอบ</p>
            <p className="text-xl font-bold text-warning">{stats.review}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">จำนวนรวม</p>
            <p className="text-xl font-bold">{formatNumber(stats.totalQty)}</p>
          </Card>
        </div>
      )}

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">แถว</th>
                  <th className="px-3 py-2 text-left">ข้อมูลจากไฟล์</th>
                  <th className="px-3 py-2 text-left">จับคู่กับยาในระบบ</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.rowNum}
                    className={`border-t border-border align-top ${r.skip ? "opacity-40" : ""}`}
                  >
                    <td className="px-3 py-2 text-xs text-muted-foreground">#{r.rowNum}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.rawName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.rawCode && <span>รหัสต้นทาง: {r.rawCode} </span>}
                        {r.rawBarcode && <span>· BC: {r.rawBarcode}</span>}
                      </div>
                    </td>
                    <td className="min-w-[280px] px-3 py-2">
                      {r.matched ? (
                        <div className="space-y-1">
                          <div className="font-medium">
                            {r.matched.drug_name}
                            {r.matched.strength ? ` ${r.matched.strength}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.matched.product_code} · คงเหลือ {formatNumber(r.matched.current_stock)}{" "}
                            {r.matched.unit}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge
                              variant={r.matchType === "fuzzy" ? "secondary" : "outline"}
                              className="text-[10px]"
                            >
                              {r.matchType === "fuzzy" && <Sparkles className="mr-1 h-3 w-3" />}
                              {MATCH_LABEL[r.matchType]}
                              {r.matchType === "fuzzy" && ` ${Math.round(r.score * 100)}%`}
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 text-xs text-warning">
                            <HelpCircle className="h-3 w-3" /> ต้องเลือกยาเอง
                            {r.suggestions.length > 0 &&
                              ` (ใกล้เคียงสูงสุด ${Math.round(r.score * 100)}%)`}
                          </span>
                          {r.suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {r.suggestions.slice(0, 3).map((s) => (
                                <Button
                                  key={s.med.id}
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={processing}
                                  onClick={() => setManual(r.rowNum, s.med.id)}
                                >
                                  {s.med.drug_name} ({Math.round(s.score * 100)}%)
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-2">
                        <Select
                          value={r.matched?.id ?? ""}
                          onValueChange={(v) => setManual(r.rowNum, v)}
                          disabled={processing || r.skip}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="เลือก/เปลี่ยนรายการยาเอง" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {sortedMeds.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.drug_name}
                                {m.strength ? ` ${m.strength}` : ""} · {m.product_code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {r.error && r.matched && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" /> {r.error}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        value={r.quantity}
                        onChange={(e) => updateQty(r.rowNum, Number(e.target.value))}
                        className="h-8 w-24 text-right"
                        disabled={processing || r.skip}
                      />
                      {r.matched && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {r.matched.unit}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={processing}
                          onClick={() => patchRow(r.rowNum, { skip: !r.skip })}
                        >
                          {r.skip ? "ใช้" : "ข้าม"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={processing}
                          onClick={() => setRows((rs) => rs.filter((x) => x.rowNum !== r.rowNum))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
                : `พร้อมนำเข้า ${stats.ready} รายการ · ต้องตรวจสอบ ${stats.review} · ข้าม ${stats.skipped} · รวม ${formatNumber(stats.totalQty)} หน่วย`}
            </p>
            <Button onClick={confirmImport} disabled={processing || stats.ready === 0} size="lg">
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังนำเข้า...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> ยืนยันนำเข้า {stats.ready} รายการ
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
