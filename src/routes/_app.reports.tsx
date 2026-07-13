import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import { FileSpreadsheet, Download, Loader2, Boxes, ArrowLeftRight, AlertTriangle, Printer, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMedicines } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatCurrency, formatDateTime, stockStatus, TX_TYPE_LABELS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const HEADER_FILL = "FF0F766E";

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle" };
  });
}

function ReportsPage() {
  const { data: medicines } = useMedicines();
  const { profile } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);

  const exportInventory = async () => {
    setBusy("inventory");
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("คลังยา");
      ws.columns = [
        { header: "รหัสยา", key: "code", width: 14 },
        { header: "ชื่อยา", key: "name", width: 34 },
        { header: "ความแรง", key: "strength", width: 14 },
        { header: "รูปแบบ", key: "form", width: 12 },
        { header: "หน่วย", key: "unit", width: 10 },
        { header: "คงเหลือ", key: "stock", width: 12 },
        { header: "ขั้นต่ำ", key: "min", width: 10 },
        { header: "ราคา/หน่วย", key: "price", width: 12 },
        { header: "มูลค่า", key: "value", width: 14 },
        { header: "สถานะ", key: "status", width: 12 },
      ];
      styleHeader(ws.getRow(1));
      (medicines ?? []).forEach((m) => {
        const st = stockStatus(m);
        ws.addRow({
          code: m.product_code,
          name: m.drug_name,
          strength: m.strength ?? "",
          form: m.form ?? "",
          unit: m.unit,
          stock: m.current_stock,
          min: m.minimum_stock,
          price: m.price_per_unit,
          value: m.current_stock * m.price_per_unit,
          status: st === "out" ? "หมด" : st === "low" ? "ใกล้หมด" : "ปกติ",
        });
      });
      const buf = await wb.xlsx.writeBuffer();
      downloadBuffer(buf, `คลังยา_${today}.xlsx`);
      toast.success("ส่งออกรายงานคลังยาสำเร็จ");
    } catch (e) {
      toast.error("ส่งออกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const exportTransactions = async () => {
    setBusy("tx");
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, medicines(drug_name, unit, product_code)")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("รายการเคลื่อนไหว");
      ws.columns = [
        { header: "วันที่-เวลา", key: "date", width: 22 },
        { header: "รหัสยา", key: "code", width: 14 },
        { header: "ชื่อยา", key: "name", width: 34 },
        { header: "ประเภท", key: "type", width: 12 },
        { header: "จำนวน", key: "qty", width: 10 },
        { header: "หน่วย", key: "unit", width: 10 },
        { header: "คงเหลือ", key: "bal", width: 12 },
        { header: "ผู้ทำรายการ", key: "user", width: 20 },
        { header: "หมายเหตุ", key: "note", width: 28 },
      ];
      styleHeader(ws.getRow(1));
      (data ?? []).forEach((t: any) => {
        ws.addRow({
          date: formatDateTime(t.created_at),
          code: t.medicines?.product_code ?? "",
          name: t.medicines?.drug_name ?? "",
          type: TX_TYPE_LABELS[t.type] ?? t.type,
          qty: t.quantity,
          unit: t.medicines?.unit ?? "",
          bal: t.balance_after,
          user: t.username ?? "",
          note: t.note ?? "",
        });
      });
      const buf = await wb.xlsx.writeBuffer();
      downloadBuffer(buf, `รายการเคลื่อนไหว_${from}_${to}.xlsx`);
      toast.success(`ส่งออก ${formatNumber((data ?? []).length)} รายการสำเร็จ`);
    } catch (e: any) {
      toast.error("ส่งออกไม่สำเร็จ", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const printRequisition = () => {
    const items = (medicines ?? [])
      .filter((m) => stockStatus(m) !== "ok")
      .sort((a, b) => a.drug_name.localeCompare(b.drug_name, "th"));

    if (items.length === 0) {
      toast.info("ไม่มีรายการยาที่ต่ำกว่าหรือใกล้จุดสต๊อกขั้นต่ำ");
      return;
    }

    const now = new Date();
    const thMonths = [
      "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
    ];
    const day = now.getDate();
    const month = thMonths[now.getMonth()];
    const year = now.getFullYear() + 543;

    const requester = profile?.full_name || profile?.username || "";
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const num = (n: number, d = 0) =>
      n.toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d });

    const rows = items
      .map((m, i) => {
        const reorder = Math.max(Math.ceil(m.minimum_stock - m.current_stock), 0);
        const price = m.price_per_unit > 0 ? num(m.price_per_unit, 2) : "";
        const total = m.price_per_unit > 0 && reorder > 0 ? num(reorder * m.price_per_unit, 2) : "";
        const nameParts = [m.drug_name, m.strength, m.form].filter(Boolean).join(" ");
        return `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(nameParts)}</td>
          <td class="c"></td>
          <td class="c">${num(m.current_stock)}</td>
          <td class="c">${reorder > 0 ? num(reorder) : ""}</td>
          <td class="c"></td>
          <td class="r">${price}</td>
          <td class="r">${total}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<title>ใบเบิกเวชภัณฑ์</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 1.4cm 1.2cm; }
  body { font-family: 'IBM Plex Sans Thai', sans-serif; color: #000; font-size: 13px; margin: 0; }
  h1 { text-align: center; font-size: 20px; margin: 0 0 4px; }
  .top { display: flex; justify-content: flex-end; font-size: 13px; margin-bottom: 6px; }
  .meta { line-height: 2; margin-bottom: 8px; }
  .dot { display: inline-block; border-bottom: 1px dotted #000; min-width: 60px; text-align: center; padding: 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 4px 6px; font-size: 12px; vertical-align: middle; }
  th { text-align: center; font-weight: 600; }
  td.c { text-align: center; }
  td.r { text-align: right; }
  tbody td { height: 26px; }
  .signs { display: flex; flex-wrap: wrap; margin-top: 24px; break-inside: avoid; page-break-inside: avoid; }
  .sign { width: 50%; padding: 10px 8px 18px; text-align: center; }
  .sline { border-bottom: 1px dotted #000; display: inline-block; min-width: 220px; }
  .srole { margin-left: 6px; }
  .sname { margin-top: 6px; }
  .spos { margin-top: 4px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
</style></head>
<body>
  <div class="top">เลขที่ <span class="dot">&nbsp;</span></div>
  <h1>ใบเบิกเวชภัณฑ์</h1>
  <div class="meta">
    สำหรับโรงพยาบาล / ฝ่าย <span class="dot">เภสัชกรรมและคุ้มครองผู้บริโภค</span>
    เพื่อใช้ในงาน <span class="dot">บริการผู้ป่วยที่เข้ารับการรักษา</span><br />
    ลงวันที่ <span class="dot">${day}</span> เดือน <span class="dot">${month}</span> พ.ศ. <span class="dot">${year}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:6%">ลำดับ</th>
        <th>รายการยาที่ต้องเบิก</th>
        <th style="width:9%">จำนวนจ่าย<br/>ต่อเดือน</th>
        <th style="width:9%">จำนวน<br/>คงเหลือ</th>
        <th style="width:10%">จำนวนที่จะ<br/>เบิกใหม่</th>
        <th style="width:10%">จำนวน<br/>อนุมัติจ่าย</th>
        <th style="width:11%">ราคา/หน่วย</th>
        <th style="width:12%">ราคารวม</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="signs">
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้ขอเบิก</span>
      <div class="sname">( ${esc(requester)} )</div>
      <div class="spos">ตำแหน่ง <span class="sline" style="min-width:150px">&nbsp;</span></div>
    </div>
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้สั่งจ่าย</span>
      <div class="sname">( นายกลวัชร วะเท )</div>
      <div class="spos">ตำแหน่ง เภสัชกรชำนาญการ</div>
    </div>
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้รับ</span>
      <div class="sname">( ${esc(requester)} )</div>
      <div class="spos">ตำแหน่ง <span class="sline" style="min-width:150px">&nbsp;</span></div>
    </div>
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้จ่าย</span>
      <div class="sname">( นางสาวกนกวรรณ ศรีจันทร์ )</div>
      <div class="spos">ตำแหน่ง จพ.เภสัชปฏิบัติงาน</div>
    </div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };</script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast.error("ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  const list = medicines ?? [];
  const totalValue = list.reduce((s, m) => s + m.current_stock * m.price_per_unit, 0);
  const lowCount = list.filter((m) => stockStatus(m) !== "ok").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Boxes} label="รายการยา" value={formatNumber(list.length)} />
        <SummaryCard icon={FileSpreadsheet} label="มูลค่าคงคลัง" value={formatCurrency(totalValue)} />
        <SummaryCard icon={AlertTriangle} label="ต้องเติมสต๊อก" value={formatNumber(lowCount)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4 text-primary" />
            รายงานคลังยา
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            ส่งออกยอดคงเหลือ มูลค่า และสถานะสต๊อกทั้งหมดเป็นไฟล์ Excel
          </p>
          <Button onClick={exportInventory} disabled={busy === "inventory"}>
            {busy === "inventory" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            ส่งออก Excel
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            รายงานการเคลื่อนไหว
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">ตั้งแต่วันที่</Label>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ถึงวันที่</Label>
              <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Button onClick={exportTransactions} disabled={busy === "tx"} className="w-full sm:w-auto">
            {busy === "tx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            ส่งออกรายการเบิกจ่าย
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Boxes; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
