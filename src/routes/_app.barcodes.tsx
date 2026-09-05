import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { toast } from "sonner";
import { Search, Printer, ScanBarcode, CheckSquare, Square } from "lucide-react";
import { useMedicines } from "@/lib/queries";
import { formatNumber, type Medicine } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/barcodes")({
  component: BarcodePage,
  head: () => ({
    meta: [
      { title: "สร้างบาร์โค้ดยา 3x9 ซม. | สับสต๊อก รพ.สบปราบ" },
      {
        name: "description",
        content: "สร้างและพิมพ์สติกเกอร์บาร์โค้ดยา ขนาด 3x9 เซนติเมตร พร้อมชื่อยา ความแรง และเลขบาร์โค้ด",
      },
      { property: "og:title", content: "สร้างบาร์โค้ดยา 3x9 ซม. | สับสต๊อก" },
      {
        property: "og:description",
        content: "สร้างและพิมพ์สติกเกอร์บาร์โค้ดยาของห้องยา รพ.สบปราบ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function labelTitle(m: Medicine) {
  return [m.drug_name, m.strength, m.form].filter(Boolean).join(" ");
}

function barcodeSvgMarkup(code: string, height = 55): string | null {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, code, {
      format: "CODE128",
      displayValue: false,
      height,
      width: 1.6,
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return svg.outerHTML;
  } catch {
    return null;
  }
}

function BarcodePreview({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const markup = barcodeSvgMarkup(code, 50);
    ref.current.innerHTML = markup ?? '<span class="text-xs text-destructive">บาร์โค้ดไม่ถูกต้อง</span>';
  }, [code]);
  return <div ref={ref} className="flex h-[14mm] items-center justify-center overflow-hidden" />;
}

function printLabels(items: Medicine[], copies: number) {
  const cells: string[] = [];
  for (const m of items) {
    const code = (m.barcode ?? "").trim();
    const svg = barcodeSvgMarkup(code, 55);
    if (!svg) continue;
    for (let i = 0; i < copies; i++) {
      cells.push(`<div class="label">
        <div class="name">${escapeHtml(labelTitle(m))}</div>
        <div class="bc">${svg}</div>
        <div class="code">${escapeHtml(code)}</div>
      </div>`);
    }
  }
  if (cells.length === 0) return false;

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<title>สติกเกอร์บาร์โค้ดยา</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 8mm; }
  body { font-family: 'IBM Plex Sans Thai', sans-serif; margin: 0; background: #fff; color: #000; }
  .sheet { display: flex; flex-wrap: wrap; gap: 3mm; }
  .label {
    width: 90mm; height: 30mm;
    border: 1px solid #000;
    background: #fff; color: #000;
    padding: 1.5mm 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    break-inside: avoid; page-break-inside: avoid; overflow: hidden;
  }
  .name { width: 100%; text-align: center; font-size: 10pt; font-weight: 600; line-height: 1.15;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bc { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; }
  .bc svg { max-width: 84mm; max-height: 15mm; }
  .code { font-size: 8pt; letter-spacing: 1px; text-align: center; }
</style></head>
<body><div class="sheet">${cells.join("")}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function BarcodePage() {
  const { data: medicines, isLoading } = useMedicines();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [copies, setCopies] = useState("1");

  const withBarcode = useMemo(
    () => (medicines ?? []).filter((m) => (m.barcode ?? "").trim().length > 0),
    [medicines],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return withBarcode;
    return withBarcode.filter(
      (m) =>
        m.drug_name.toLowerCase().includes(q) ||
        m.product_code.toLowerCase().includes(q) ||
        (m.barcode ?? "").toLowerCase().includes(q),
    );
  }, [withBarcode, search]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const allSelected = filtered.length > 0 && filtered.every((m) => selected.includes(m.id));
  const toggleAll = () =>
    setSelected(allSelected ? [] : Array.from(new Set(filtered.map((m) => m.id))));

  const handlePrint = () => {
    const items = withBarcode.filter((m) => selected.includes(m.id));
    if (items.length === 0) {
      toast.error("กรุณาเลือกรายการยาที่ต้องการพิมพ์");
      return;
    }
    const n = Math.min(Math.max(Number(copies) || 1, 1), 50);
    const ok = printLabels(items, n);
    if (!ok) toast.error("ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="relative flex-1">
            <Label className="mb-1.5 block text-xs">ค้นหายา</Label>
            <Search className="absolute left-3 top-[34px] h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="ชื่อยา / รหัสยา / บาร์โค้ด"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-32">
            <Label className="mb-1.5 block text-xs">จำนวนดวง/รายการ</Label>
            <Input type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(e.target.value)} />
          </div>
          <Button variant="outline" onClick={toggleAll} className="sm:w-auto">
            {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allSelected ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            พิมพ์ ({formatNumber(selected.length)})
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanBarcode className="h-4 w-4 text-primary" />
            สติกเกอร์บาร์โค้ด ขนาด 9 × 3 ซม. (กรอบเส้นเดียว ไม่มีสี)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              ไม่พบรายการยาที่มีรหัสบาร์โค้ด — เพิ่มบาร์โค้ดได้ที่หน้าคลังยา
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((m) => {
                const isSel = selected.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "rounded-xl border-2 p-2 text-left transition-colors",
                      isSel ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                    )}
                  >
                    {/* ตัวอย่างสติกเกอร์ 9x3 ซม. */}
                    <div className="mx-auto flex h-[30mm] w-[90mm] max-w-full flex-col items-center justify-between overflow-hidden border border-foreground bg-white px-2 py-1 text-black">
                      <p className="line-clamp-2 w-full text-center text-[11px] font-semibold leading-tight">
                        {labelTitle(m)}
                      </p>
                      <BarcodePreview code={(m.barcode ?? "").trim()} />
                      <p className="text-center text-[9px] tracking-widest">{m.barcode}</p>
                    </div>
                    <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                      รหัสยา {m.product_code}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
