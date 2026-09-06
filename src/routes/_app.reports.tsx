import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSpreadsheet,
  Download,
  Loader2,
  Boxes,
  ArrowLeftRight,
  AlertTriangle,
  Printer,
  ClipboardList,
  History,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMedicines } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatCurrency, formatDateTime, stockStatus, groupMedicines, TX_TYPE_LABELS } from "@/lib/format";
import {
  buildRequisitionItems,
  printRequisitionDoc,
  DEFAULT_DEPARTMENT,
  DEFAULT_PURPOSE,
  type RequisitionItem,
} from "@/lib/requisition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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

interface RequisitionRow {
  id: string;
  doc_date: string;
  department: string;
  purpose: string;
  requester_name: string | null;
  requester_position: string | null;
  item_count: number;
  total_amount: number;
  items: RequisitionItem[];
  created_at: string;
}

function ReportsPage() {
  const { data: medicines } = useMedicines();
  const { profile, user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: reqHistory, isLoading: reqLoading } = useQuery({
    queryKey: ["requisitions"],
    queryFn: async (): Promise<RequisitionRow[]> => {
      const { data, error } = await supabase
        .from("requisitions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as RequisitionRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("requisitions-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "requisitions" }, () => {
        qc.invalidateQueries({ queryKey: ["requisitions"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const exportInventory = async () => {
    setBusy("inventory");
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("คลังยา");
      ws.columns = [
        { header: "รหัสยา", key: "code", width: 14 },
        { header: "บาร์โค้ด", key: "barcode", width: 18 },
        { header: "บาร์โค้ด", key: "barcode", width: 18 },
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
          barcode: m.barcode ?? "",
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
        .select("*, medicines(drug_name, unit, product_code, barcode)")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("รายการเคลื่อนไหว");
      ws.columns = [
        { header: "วันที่-เวลา", key: "date", width: 22 },
        { header: "รหัสยา", key: "code", width: 14 },
        { header: "บาร์โค้ด", key: "barcode", width: 18 },
        { header: "บาร์โค้ด", key: "barcode", width: 18 },
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
          barcode: t.medicines?.barcode ?? "",
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

  const createRequisition = async () => {
    const lowMeds = groupMedicines(medicines ?? []).filter((g) => stockStatus(g) !== "ok");

    if (lowMeds.length === 0) {
      toast.info("ไม่มีรายการยาที่ต่ำกว่าหรือใกล้จุดสต๊อกขั้นต่ำ");
      return;
    }

    const items = buildRequisitionItems(lowMeds);
    const requester = profile?.full_name || profile?.username || "";
    const requesterPosition = profile?.position || "";
    const totalAmount = items.reduce((s, it) => s + it.total, 0);

    const ok = printRequisitionDoc({
      doc_date: today,
      department: DEFAULT_DEPARTMENT,
      purpose: DEFAULT_PURPOSE,
      requester_name: requester,
      requester_position: requesterPosition,
      items,
    });
    if (!ok) {
      toast.error("ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup");
      return;
    }

    const { error } = await supabase.from("requisitions").insert({
      doc_date: today,
      department: DEFAULT_DEPARTMENT,
      purpose: DEFAULT_PURPOSE,
      requester_id: user?.id ?? null,
      requester_name: requester,
      requester_position: requesterPosition || null,
      item_count: items.length,
      total_amount: totalAmount,
      items: items as unknown as any,
    });
    if (error) {
      toast.error("บันทึกประวัติใบเบิกไม่สำเร็จ", { description: error.message });
    } else {
      toast.success("สร้างและบันทึกใบเบิกเรียบร้อย");
    }
  };

  const reprint = (r: RequisitionRow) => {
    const ok = printRequisitionDoc({
      doc_date: r.doc_date,
      department: r.department,
      purpose: r.purpose,
      requester_name: r.requester_name ?? "",
      requester_position: r.requester_position ?? "",
      items: r.items ?? [],
    });
    if (!ok) toast.error("กรุณาอนุญาต popup เพื่อพิมพ์");
  };

  const deleteReq = async (id: string) => {
    const { error } = await supabase.from("requisitions").delete().eq("id", id);
    if (error) toast.error("ลบไม่สำเร็จ", { description: error.message });
    else toast.success("ลบใบเบิกแล้ว");
  };

  const list = medicines ?? [];
  const grouped = groupMedicines(list);
  const totalValue = list.reduce((s, m) => s + m.current_stock * m.price_per_unit, 0);
  const lowCount = grouped.filter((g) => stockStatus(g) !== "ok").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Boxes} label="รายการยา (กลุ่มรหัสยา)" value={formatNumber(grouped.length)} />
        <SummaryCard icon={FileSpreadsheet} label="มูลค่าคงคลัง" value={formatCurrency(totalValue)} />
        <SummaryCard icon={AlertTriangle} label="ต้องเติมสต๊อก" value={formatNumber(lowCount)} />
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" />
            ใบเบิกยาประจำสัปดาห์
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            สร้างใบเบิกเวชภัณฑ์ (รูปแบบราชการ) โดยดึงเฉพาะรายการยาที่คงเหลือต่ำกว่าหรือใกล้จุดสต๊อกขั้นต่ำ —
            ปัจจุบัน <span className="font-semibold text-foreground">{formatNumber(lowCount)}</span> รายการ
            (ระบบจะบันทึกเป็นประวัติให้อัตโนมัติ)
          </p>
          <Button onClick={createRequisition} disabled={lowCount === 0}>
            <Printer className="h-4 w-4" />
            พิมพ์ใบเบิก / บันทึก PDF
          </Button>
        </CardContent>
      </Card>

      {/* Requisition history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            ประวัติใบเบิกประจำสัปดาห์ย้อนหลัง
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {reqLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (reqHistory ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <ClipboardList className="h-9 w-9 opacity-50" />
              <p className="text-sm">ยังไม่มีประวัติใบเบิก</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(reqHistory ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      ใบเบิก {formatNumber(r.item_count)} รายการ
                      <span className="ml-2 font-normal text-muted-foreground">
                        มูลค่า {formatCurrency(r.total_amount)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      โดย {r.requester_name ?? "-"} • {formatDateTime(r.created_at)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => reprint(r)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    พิมพ์ซ้ำ
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteReq(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
