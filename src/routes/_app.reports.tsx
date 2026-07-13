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
