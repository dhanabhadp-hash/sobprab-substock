import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Search, PackageSearch, Loader2, ShieldAlert, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useMedicines } from "@/lib/queries";
import { formatNumber, stockStatus, type Medicine } from "@/lib/format";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/scan")({
  component: ScanPage,
});

type TxType = "disburse" | "receive" | "adjust";

function ScanPage() {
  const { canDisburse, profile } = useAuth();
  const { data: medicines } = useMedicines();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Medicine | null>(null);
  const [qty, setQty] = useState("");
  const [type, setType] = useState<TxType>("disburse");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (medicines ?? [])
      .filter(
        (m) =>
          m.drug_name.toLowerCase().includes(q) ||
          m.product_code.toLowerCase().includes(q) ||
          (m.barcode ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [search, medicines]);

  const selectMedicine = (m: Medicine) => {
    setSelected(m);
    setSearch("");
    setQty("");
    setNote("");
  };

  const handleScan = (code: string) => {
    const found = (medicines ?? []).find(
      (m) => m.barcode === code || m.product_code === code,
    );
    if (found) {
      selectMedicine(found);
      toast.success("พบยา", { description: found.drug_name });
    } else {
      toast.error("ไม่พบยาในระบบ", { description: `บาร์โค้ด: ${code}` });
    }
  };

  const parsedQty = Number(qty);
  const afterBalance = selected
    ? type === "adjust"
      ? parsedQty
      : type === "receive"
        ? selected.current_stock + parsedQty
        : selected.current_stock - parsedQty
    : 0;

  const handleSubmit = async () => {
    if (!selected) return;
    if (!qty || parsedQty < 0 || (type !== "adjust" && parsedQty <= 0)) {
      toast.error("กรุณาระบุจำนวนให้ถูกต้อง");
      return;
    }
    if (type === "disburse" && parsedQty > selected.current_stock) {
      toast.error("จำนวนเบิกมากกว่ายอดคงเหลือ", {
        description: `คงเหลือ ${formatNumber(selected.current_stock)} ${selected.unit}`,
      });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("process_transaction", {
      _medicine_id: selected.id,
      _type: type,
      _quantity: parsedQty,
      _note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (error) {
      toast.error("บันทึกไม่สำเร็จ", { description: error.message });
      return;
    }
    const newBalance = data?.[0]?.new_balance ?? afterBalance;
    toast.success("บันทึกรายการสำเร็จ", {
      description: `${selected.drug_name} • คงเหลือ ${formatNumber(newBalance)} ${selected.unit}`,
    });
    qc.invalidateQueries({ queryKey: ["medicines"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    setSelected(null);
    setQty("");
    setNote("");
  };

  if (!canDisburse) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">ไม่มีสิทธิ์เบิกจ่าย</p>
          <p className="text-sm text-muted-foreground">
            บัญชีผู้เยี่ยมชมสามารถดูข้อมูลได้เท่านั้น กรุณาติดต่อผู้ดูแลระบบ
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">สแกนบาร์โค้ด</CardTitle>
          </CardHeader>
          <CardContent>
            <BarcodeScanner onScan={handleScan} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ค้นหาด้วยมือ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="ชื่อยา / รหัส / บาร์โค้ด"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {results.length > 0 && (
              <div className="mt-2 space-y-1">
                {results.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => selectMedicine(m)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.drug_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.product_code} • {m.strength}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {formatNumber(m.current_stock)} {m.unit}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader>
          <CardTitle className="text-base">รายการเบิกจ่าย</CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <PackageSearch className="h-10 w-10 opacity-50" />
              <p className="text-sm">สแกนหรือค้นหายาเพื่อเริ่มทำรายการ</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{selected.drug_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selected.product_code} • {selected.strength} • {selected.form}
                    </p>
                  </div>
                  <Badge
                    variant={stockStatus(selected) === "out" ? "destructive" : "secondary"}
                    className={stockStatus(selected) === "low" ? "border-warning text-warning" : ""}
                  >
                    คงเหลือ {formatNumber(selected.current_stock)} {selected.unit}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label>ประเภทรายการ</Label>
                <Select value={type} onValueChange={(v) => setType(v as TxType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disburse">เบิกจ่าย (ตัดสต๊อก)</SelectItem>
                    <SelectItem value="receive">รับเข้า (เพิ่มสต๊อก)</SelectItem>
                    <SelectItem value="adjust">ปรับยอดคงเหลือ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="qty">
                  {type === "adjust" ? `ยอดคงเหลือใหม่ (${selected.unit})` : `จำนวน (${selected.unit})`}
                </Label>
                <Input
                  id="qty"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">หมายเหตุ (ไม่บังคับ)</Label>
                <Textarea
                  id="note"
                  rows={2}
                  placeholder="เช่น เบิกให้ผู้ป่วยใน / หน่วยงาน"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {qty !== "" && !isNaN(parsedQty) && (
                <div
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                    afterBalance < 0 ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  <span>ยอดคงเหลือหลังทำรายการ</span>
                  <span className="font-bold tabular-nums">
                    {formatNumber(afterBalance)} {selected.unit}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setSelected(null)}>
                  ยกเลิก
                </Button>
                <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  ยืนยัน
                </Button>
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                ผู้ทำรายการ: {profile?.full_name || profile?.username}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
