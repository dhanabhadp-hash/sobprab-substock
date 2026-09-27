import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, Trash2,
  Download, X, History, RotateCcw, SkipForward, Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useMedicines } from "@/lib/queries";
import { formatNumber } from "@/lib/format";
import type { Medicine } from "@/lib/format";
import { fuzzyFindMedicines } from "@/lib/fuzzy-match";

export const Route = createFileRoute("/_app/import")({
  head: () => ({
    meta: [
      { title: "นำเข้าไฟล์รับยา — สับบบบสต๊อก" },
      { name: "description", content: "นำเข้าไฟล์ Excel/CSV รับยาเข้าคลัง จับคู่ยาอัตโนมัติ และเรียกคืนรอบนำเข้าได้" },
    ],
  }),
  component: ImportPage,
});

type MatchType = "barcode" | "product_code" | "memory" | "fuzzy" | "manual" | "none";
type Status = "auto" | "review" | "none" | "skip";

interface ParsedRow {
  rowNum: number;
  rawCode: string;
  rawName: string;
  rawStrength: string;
  rawForm: string;
  rawBarcode: string;
  quantity: number;
  note: string;
  matched: Medicine | null;
  matchType: MatchType;
  score: number;
  candidates: { item: Medicine; score: number }[];
  status: Status;
}

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["code", "product_code", "รหัส", "รหัสยา", "code drugs name", "drug_code", "รหัสสินค้า"],
  name: ["name", "dname", "drug_name", "drug name", "drugname", "ชื่อยา", "ชื่อ", "รายการ", "รายการยา", "ชื่อสินค้า", "description"],
  strength: ["strength", "ความแรง", "ขนาด", "dose"],
  form: ["form", "รูปแบบ", "dosage form", "ชนิด"],
  barcode: ["barcode", "บาร์โค้ด", "รหัสบาร์โค้ด", "ean", "upc"],
  qty: ["qty", "quantity", "quility", "qulity", "quality", "quantily", "จำนวน", "รับเข้า", "amount", "จำนวนรับ", "จำนวนที่รับ"],
  note: ["note", "หมายเหตุ", "remark", "notes", "lot", "lot no"],
};
// คอลัมน์ที่ห้ามจับเป็นจำนวน (เช่น amountend1 = "230 X 1")
const HEADER_EXCLUDE: Record<string, string[]> = { qty: ["amountend", "total", "price", "ราคา", "มูลค่า"] };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const aliasKey = (name: string, strength: string, form: string) =>
  norm(`${name} ${strength} ${form}`);
const medText = (m: Medicine) => `${m.drug_name} ${m.strength ?? ""} ${m.form ?? ""}`;
const ABBR: [RegExp, string][] = [
  [/\btabs?\b|\btablets?\b|\bเม็ด\b/g, "tab"],
  [/\bcaps?\b|\bcapsules?\b|\bแคปซูล\b/g, "cap"],
  [/\binj\.?\b|\binjection\b|\bamp\b|\bvial\b/g, "inj"],
  [/\bsyr\.?\b|\bsyrup\b|\bsusp\b|\bsuspension\b/g, "syr"],
  [/\bivf\b|\binf\b|\binfusion\b/g, "inf"],
  [/\bmcg\b|\bµg\b|\bug\b/g, "mcg"],
  [/\bmls?\b/g, "ml"],
  [/\bgm\b|\bgrams?\b/g, "g"],
];
const expandAbbr = (s: string) => {
  let t = s.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d)\s*(mg|mcg|ml|g|%)/g, "$1 $2");
  for (const [re, v] of ABBR) t = t.replace(re, v);
  return t.replace(/\s+/g, " ").trim();
};
const nums = (s: string) => Array.from(new Set(s.match(/\d+(?:\.\d+)?/g) ?? []));
const formOf = (s: string) => s.match(/\b(tab|cap|inj|syr|inf|cream|oint|gel|drop|inh)\b/)?.[1] ?? "";

function detectHeader(rows: unknown[][]): { idx: number; cols: Record<string, number> } | null {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    // ตัดเลขท้ายหัวคอลัมน์ (code1, DName1) ออก
    const cells = (rows[i] ?? []).map((c) => norm(c).replace(/[\s_]*\d+$/, ""));
    const cols: Record<string, number> = {};
    const used = new Set<number>();
    const ok = (field: string, c: string, j: number) =>
      !!c && !used.has(j) && !(HEADER_EXCLUDE[field] ?? []).some((x) => c.includes(x));
    // รอบแรก: ตรงเป๊ะ
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      const al = aliases.map(norm);
      const j = cells.findIndex((c, k) => ok(field, c, k) && al.includes(c));
      if (j >= 0) { cols[field] = j; used.add(j); }
    }
    // รอบสอง: มีคำนั้นอยู่ในหัวคอลัมน์
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (cols[field] !== undefined) continue;
      const al = aliases.map(norm);
      const j = cells.findIndex((c, k) => ok(field, c, k) && al.some((a) => a.length > 2 && c.includes(a)));
      if (j >= 0) { cols[field] = j; used.add(j); }
    }
    if (cols.qty !== undefined && (cols.name !== undefined || cols.code !== undefined || cols.barcode !== undefined)) {
      return { idx: i, cols };
    }
  }
  return null;
}

function downloadTemplate() {
  const rows = [
    { รหัสยา: "PARA500", ชื่อยา: "Paracetamol", ความแรง: "500 mg", รูปแบบ: "tab", บาร์โค้ด: "", จำนวน: 100, หมายเหตุ: "รับเข้าคลัง" },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "receive");
  XLSX.writeFile(wb, "template-รับยาเข้า.xlsx");
}

interface Batch {
  id: string;
  file_name: string | null;
  username: string | null;
  item_count: number;
  total_qty: number;
  created_at: string;
  reverted_at: string | null;
  reverted_by: string | null;
}

function ImportPage() {
  const qc = useQueryClient();
  const { data: medicines = [], isLoading: medsLoading } = useMedicines();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const batchesQ = useQuery({
    queryKey: ["import_batches"],
    queryFn: async (): Promise<Batch[]> => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("id,file_name,username,item_count,total_qty,created_at,reverted_at,reverted_by")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as Batch[];
    },
  });

  const stats = useMemo(() => {
    const ready = rows.filter((r) => r.status === "auto" && r.matched && r.quantity > 0);
    return {
      ready: ready.length,
      review: rows.filter((r) => r.status === "review").length,
      none: rows.filter((r) => r.status === "none").length,
      skip: rows.filter((r) => r.status === "skip").length,
      totalQty: ready.reduce((s, r) => s + r.quantity, 0),
    };
  }, [rows]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const { data: aliasRows } = await supabase.from("import_aliases").select("raw_key, medicine_id");
      const memory = new Map((aliasRows ?? []).map((a) => [a.raw_key, a.medicine_id]));
      const byId = new Map(medicines.map((m) => [m.id, m]));

      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let raw: unknown[][] = [];
      let header: ReturnType<typeof detectHeader> = null;
      for (const sn of wb.SheetNames) {
        raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false }) as unknown[][];
        header = detectHeader(raw);
        if (header) break;
      }
      if (!header) {
        toast.error("หาแถวหัวคอลัมน์ไม่พบ (ต้องมีคอลัมน์ ชื่อยา/รหัสยา/บาร์โค้ด และ จำนวน)");
        return;
      }
      const { idx, cols } = header;
      const get = (r: unknown[], f: string) => (cols[f] === undefined ? "" : String(r[cols[f]] ?? "").trim());

      const parsed: ParsedRow[] = [];
      for (let i = idx + 1; i < raw.length; i++) {
        const r = raw[i] ?? [];
        const code = get(r, "code"), name = get(r, "name"), strength = get(r, "strength");
        const form = get(r, "form"), barcode = get(r, "barcode"), note = get(r, "note");
        const qty = Number(get(r, "qty").replace(/,/g, ""));
        if (!code && !name && !barcode) continue;
        if (!Number.isFinite(qty) || qty <= 0) continue; // ข้ามแถวสรุป/แถวว่าง

        let matched: Medicine | null = null;
        let matchType: MatchType = "none";
        let score = 0;
        let candidates: { item: Medicine; score: number }[] = [];

        // รหัสยา/บาร์โค้ดจากโปรแกรมต้นทางไม่ตรงกับระบบนี้ → จับคู่จากชื่อยา+ความแรง+รูปแบบเท่านั้น
        const key = aliasKey(name, strength, form);
        if (name && memory.has(key)) {
          matched = byId.get(memory.get(key)!) ?? null;
          if (matched) { matchType = "memory"; score = 1; }
        }
        if (!matched && name) {
          const q = expandAbbr(`${name} ${strength} ${form}`);
          const qNums = nums(q);
          candidates = fuzzyFindMedicines([q, expandAbbr(name)], medicines, (m) => expandAbbr(medText(m)), 0.4)
            .map((c) => {
              const mNums = nums(expandAbbr(medText(c.item)));
              let s = c.score;
              if (qNums.length && mNums.length) {
                const hit = qNums.filter((n) => mNums.includes(n)).length;
                s += hit ? 0.1 * (hit / qNums.length) : -0.15; // ความแรงตรง/ไม่ตรง
              }
              const qf = formOf(q), mf = formOf(expandAbbr(medText(c.item)));
              if (qf && mf) s += qf === mf ? 0.05 : -0.1;
              return { item: c.item, score: Math.max(0, Math.min(1, s)) };
            })
            .sort((a, b) => b.score - a.score);
          const top = candidates[0];
          const second = candidates[1];
          if (top && top.score >= 0.7 && (!second || top.score - second.score >= 0.05 || second.score < 0.7)) {
            matched = top.item; matchType = "fuzzy"; score = top.score;
          }
        }

        parsed.push({
          rowNum: i + 1, rawCode: code, rawName: name, rawStrength: strength, rawForm: form,
          rawBarcode: barcode, quantity: qty, note, matched, matchType, score, candidates,
          status: matched ? "auto" : candidates.length ? "review" : "none",
        });
      }
      setRows(parsed);
      toast.success(`พบหัวคอลัมน์ที่แถว ${idx + 1} · อ่านได้ ${parsed.length} รายการ`);
    } catch (e: any) {
      toast.error("อ่านไฟล์ล้มเหลว: " + (e?.message ?? "ไม่ทราบสาเหตุ"));
      setRows([]);
    }
  };

  const clearAll = () => {
    setRows([]); setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };
  const patch = (rowNum: number, p: Partial<ParsedRow>) =>
    setRows((rs) => rs.map((r) => (r.rowNum === rowNum ? { ...r, ...p } : r)));
  const choose = (row: ParsedRow, id: string) => {
    const m = medicines.find((x) => x.id === id) ?? null;
    patch(row.rowNum, m ? { matched: m, matchType: "manual", score: 1, status: "auto" } : { matched: null, status: row.candidates.length ? "review" : "none" });
  };

  const confirmImport = async () => {
    const valid = rows.filter((r) => r.status === "auto" && r.matched && r.quantity > 0);
    if (!valid.length) return toast.error("ไม่มีรายการที่พร้อมนำเข้า");
    setProcessing(true);
    const { error } = await supabase.rpc("import_receive_batch", {
      _file_name: fileName,
      _items: valid.map((r) => ({ medicine_id: r.matched!.id, quantity: r.quantity, note: r.note })),
    });
    if (error) {
      setProcessing(false);
      return toast.error("นำเข้าล้มเหลว (ยังไม่มีการเปลี่ยนแปลงสต๊อก): " + error.message);
    }
    // จดจำการจับคู่ชื่อยา
    const aliasMap = new Map<string, string>();
    valid.forEach((r) => {
      if (r.rawName && ["fuzzy", "manual", "memory"].includes(r.matchType))
        aliasMap.set(aliasKey(r.rawName, r.rawStrength, r.rawForm), r.matched!.id);
    });
    if (aliasMap.size) {
      await supabase.from("import_aliases").upsert(
        [...aliasMap].map(([raw_key, medicine_id]) => ({ raw_key, medicine_id, updated_at: new Date().toISOString() })),
        { onConflict: "raw_key" },
      );
    }
    setProcessing(false);
    toast.success(`นำเข้าสำเร็จ ${valid.length} รายการ · สต๊อกอัปเดตแล้ว`);
    clearAll();
    qc.invalidateQueries({ queryKey: ["import_batches"] });
    qc.invalidateQueries({ queryKey: ["medicines"] });
  };

  const revert = async (b: Batch) => {
    if (!confirm(`เรียกคืนรอบนำเข้า "${b.file_name}" (${b.item_count} รายการ)?\nสต๊อกจะถูกหักกลับเท่ากับที่นำเข้า`)) return;
    setReverting(b.id);
    const { error } = await supabase.rpc("revert_import_batch", { _batch_id: b.id });
    setReverting(null);
    if (error) return toast.error(error.message);
    toast.success("เรียกคืนเวอร์ชันก่อนนำเข้าเรียบร้อย");
    qc.invalidateQueries({ queryKey: ["import_batches"] });
    qc.invalidateQueries({ queryKey: ["medicines"] });
  };

  const matchLabel: Record<MatchType, string> = {
    barcode: "บาร์โค้ด", product_code: "รหัสยา", memory: "จำจากครั้งก่อน",
    fuzzy: "ชื่อคล้าย", manual: "เลือกเอง", none: "",
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><FileSpreadsheet className="h-5 w-5" /></div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">นำเข้าไฟล์รับยาเข้าคลัง (Bulk Receive)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              อัปโหลดไฟล์ <b>.xlsx .xls .csv</b> ได้ทันที ระบบจะหาแถวหัวคอลัมน์เอง และจับคู่ยาจาก
              บาร์โค้ด → รหัสยา → รายการที่เคยจับคู่ → ชื่อยา+ความแรง+รูปแบบ (คล้าย ≥70% จับคู่อัตโนมัติ)
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => inputRef.current?.click()} disabled={medsLoading || processing}>
            <Upload className="h-4 w-4" /> เลือกไฟล์
          </Button>
          <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4" /> เทมเพลต .xlsx</Button>
          {fileName && <span className="text-sm text-muted-foreground">📄 {fileName} · {rows.length} รายการ</span>}
          {rows.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={processing}><X className="h-4 w-4" /> ล้างไฟล์</Button>
          )}
        </div>
        <Input
          ref={inputRef} type="file" className="hidden"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </Card>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Card className="p-3"><p className="text-xs text-muted-foreground">พร้อมนำเข้า</p><p className="text-xl font-bold text-success">{stats.ready}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">รอยืนยัน</p><p className="text-xl font-bold text-warning">{stats.review}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">ไม่พบยา</p><p className="text-xl font-bold text-destructive">{stats.none}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">ข้าม</p><p className="text-xl font-bold text-muted-foreground">{stats.skip}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">จำนวนรวม</p><p className="text-xl font-bold">{formatNumber(stats.totalQty)}</p></Card>
        </div>
      )}

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">แถว</th>
                  <th className="px-3 py-2 text-left">ข้อมูลจากไฟล์</th>
                  <th className="px-3 py-2 text-left">จับคู่กับยาในคลัง</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNum} className={`border-t border-border ${r.status === "skip" ? "opacity-50" : r.status === "review" ? "bg-warning/5" : r.status === "none" ? "bg-destructive/5" : ""}`}>
                    <td className="px-3 py-2 text-xs text-muted-foreground">#{r.rowNum}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.rawName || "—"} <span className="text-muted-foreground">{r.rawStrength} {r.rawForm}</span></div>
                      <div className="text-xs text-muted-foreground">
                        {r.rawCode && <>รหัส: {r.rawCode} </>}{r.rawBarcode && <>· BC: {r.rawBarcode}</>}{r.note && <> · {r.note}</>}
                      </div>
                    </td>
                    <td className="px-3 py-2 min-w-[280px]">
                      {r.matched && r.status !== "review" ? (
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{medText(r.matched)}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.matched.product_code} · คงเหลือ {formatNumber(r.matched.current_stock)} {r.matched.unit}
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                {r.matchType === "memory" && <Brain className="mr-1 h-3 w-3" />}
                                {matchLabel[r.matchType]}{r.matchType === "fuzzy" && ` ${Math.round(r.score * 100)}%`}
                              </Badge>
                            </div>
                          </div>
                          {r.status !== "skip" && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => patch(r.rowNum, { status: "review", candidates: r.candidates.length ? r.candidates : fuzzyFindMedicines([r.rawName], medicines, medText, 0.3) })}>เปลี่ยน</Button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            {r.candidates.length ? "ไม่มั่นใจ — โปรดเลือกยาที่ถูกต้อง" : "ไม่พบยาใกล้เคียง — เลือกเองหรือข้าม"}
                          </div>
                          <select
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                            value=""
                            onChange={(e) => choose(r, e.target.value)}
                            disabled={processing}
                          >
                            <option value="">— เลือกยา —</option>
                            {r.candidates.length > 0 && (
                              <optgroup label="ใกล้เคียง">
                                {r.candidates.map((c) => (
                                  <option key={c.item.id} value={c.item.id}>{Math.round(c.score * 100)}% · {medText(c.item)} ({c.item.product_code})</option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="ยาทั้งหมด">
                              {medicines.map((m) => (
                                <option key={m.id} value={m.id}>{medText(m)} ({m.product_code}{m.barcode ? ` · ${m.barcode}` : ""})</option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input type="number" min={0} value={r.quantity} className="h-8 w-24 text-right" disabled={processing}
                        onChange={(e) => patch(r.rowNum, { quantity: Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.status === "skip" ? (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => patch(r.rowNum, { status: r.matched ? "auto" : r.candidates.length ? "review" : "none" })}>คืน</Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="ข้าม" disabled={processing} onClick={() => patch(r.rowNum, { status: "skip" })}>
                          <SkipForward className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" disabled={processing} onClick={() => setRows((rs) => rs.filter((x) => x.rowNum !== r.rowNum))}>
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
              พร้อมนำเข้า {stats.ready} รายการ · รวม {formatNumber(stats.totalQty)} หน่วย
              {stats.review + stats.none > 0 && ` · ยังไม่ได้เลือก ${stats.review + stats.none} รายการ (จะไม่ถูกนำเข้า)`}
            </p>
            <Button onClick={confirmImport} disabled={processing || stats.ready === 0} size="lg">
              {processing ? <><Loader2 className="h-4 w-4 animate-spin" /> กำลังนำเข้า...</> : <><CheckCircle2 className="h-4 w-4" /> ยืนยันเข้าสต๊อก {stats.ready} รายการ</>}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">ประวัติการนำเข้า / เรียกคืนเวอร์ชันก่อนหน้า</h3>
        </div>
        {batchesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : !batchesQ.data?.length ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีประวัติการนำเข้า</p>
        ) : (
          <div className="divide-y divide-border">
            {batchesQ.data.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div className="font-medium">{b.file_name || "(ไม่มีชื่อไฟล์)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(b.created_at).toLocaleString("th-TH")} · {b.username ?? "-"} · {b.item_count} รายการ · {formatNumber(b.total_qty)} หน่วย
                  </div>
                </div>
                {b.reverted_at ? (
                  <Badge variant="outline" className="text-xs">เรียกคืนแล้ว {new Date(b.reverted_at).toLocaleString("th-TH")} โดย {b.reverted_by ?? "-"}</Badge>
                ) : (
                  <Button variant="outline" size="sm" disabled={reverting === b.id} onClick={() => revert(b)}>
                    {reverting === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} เรียกคืน
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
