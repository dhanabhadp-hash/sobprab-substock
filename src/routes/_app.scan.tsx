import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  PackageSearch,
  Loader2,
  ShieldAlert,
  Check,
  Plus,
  Trash2,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useMedicines } from "@/lib/queries";
import { formatNumber, type Medicine } from "@/lib/format";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { VoiceAssistant } from "@/components/VoiceAssistant";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export const Route = createFileRoute("/_app/scan")({
  head: () => ({
    meta: [
      { title: "สแกนและเบิกจ่ายยา | สับสต๊อก รพ.สบปราบ" },
      { name: "description", content: "รับเข้า เบิกจ่าย และปรับยอดยาผ่านบาร์โค้ดและตะกร้ารายการยา" },
      { property: "og:title", content: "สแกนและเบิกจ่ายยา | สับสต๊อก รพ.สบปราบ" },
      { property: "og:description", content: "รับเข้า เบิกจ่าย และปรับยอดยาผ่านบาร์โค้ดและตะกร้ารายการยา" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanPage,
});

type TxType = "disburse" | "receive" | "adjust";

interface CartItem {
  medicine: Medicine;
  quantity: number;
}

const TYPE_LABEL: Record<TxType, string> = {
  disburse: "เบิกจ่าย (ตัดสต๊อก)",
  receive: "รับเข้า (เพิ่มสต๊อก)",
  adjust: "ปรับยอดคงเหลือ",
};

function ScanPage() {
  const { canDisburse, profile } = useAuth();
  const { data: medicines } = useMedicines();
  const qc = useQueryClient();

  const [type, setType] = useState<TxType>("disburse");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Medicine | null>(null);
  const [pendingQty, setPendingQty] = useState("");

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

  const addToCart = (medicine: Medicine, quantity: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.medicine.id === medicine.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [...prev, { medicine, quantity }];
    });
  };

  const selectPending = (m: Medicine) => {
    setPending(m);
    setPendingQty("");
    setSearch("");
  };

  const confirmPending = () => {
    if (!pending) return;
    const q = Number(pendingQty);
    if (!pendingQty || isNaN(q) || (type !== "adjust" && q <= 0) || q < 0) {
      toast.error("กรุณาระบุจำนวนให้ถูกต้อง");
      return;
    }
    addToCart(pending, q);
    setPending(null);
    setPendingQty("");
  };

  const handleScan = (code: string) => {
    const found = (medicines ?? []).find(
      (m) => m.barcode === code || m.product_code === code,
    );
    if (found) {
      selectPending(found);
      toast.success("พบยา", { description: found.drug_name });
    } else {
      toast.error("ไม่พบยาในระบบ", { description: `บาร์โค้ด: ${code}` });
    }
  };

  const voiceConfirm = (action: TxType, medicine: Medicine, quantity: number) => {
    if (cart.length > 0 && action !== type) {
      toast.error("ประเภทรายการไม่ตรงกับตะกร้า", {
        description: `ตะกร้าปัจจุบันคือ "${TYPE_LABEL[type]}" — ทำรายการให้เสร็จก่อน`,
      });
      return;
    }
    if (cart.length === 0) setType(action);
    addToCart(medicine, quantity);
  };

  const updateQty = (id: string, q: number) => {
    setCart((prev) => prev.map((c) => (c.medicine.id === id ? { ...c, quantity: q } : c)));
  };

  const removeItem = (id: string) => {
    setCart((prev) => prev.filter((c) => c.medicine.id !== id));
  };

  const submitCart = async () => {
    if (cart.length === 0) return;
    for (const it of cart) {
      if (isNaN(it.quantity) || it.quantity < 0 || (type !== "adjust" && it.quantity <= 0)) {
        toast.error("มีรายการจำนวนไม่ถูกต้อง", { description: it.medicine.drug_name });
        return;
      }
      if (type === "disburse" && it.quantity > it.medicine.current_stock) {
        toast.error("จำนวนเบิกมากกว่ายอดคงเหลือ", {
          description: `${it.medicine.drug_name} คงเหลือ ${formatNumber(it.medicine.current_stock)} ${it.medicine.unit}`,
        });
        return;
      }
    }
    setSubmitting(true);
    let ok = 0;
    let fail = 0;
    for (const it of cart) {
      const { error } = await supabase.rpc("process_transaction", {
        _medicine_id: it.medicine.id,
        _type: type,
        _quantity: it.quantity,
        _note: note.trim() || undefined,
      });
      if (error) {
        fail++;
        toast.error(`ไม่สำเร็จ: ${it.medicine.drug_name}`, { description: error.message });
      } else {
        ok++;
      }
    }
    setSubmitting(false);
    qc.invalidateQueries({ queryKey: ["medicines"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    if (ok > 0) {
      toast.success(`บันทึก ${TYPE_LABEL[type]} สำเร็จ ${ok} รายการ`, {
        description: fail > 0 ? `ไม่สำเร็จ ${fail} รายการ` : undefined,
      });
    }
    if (fail === 0) {
      setCart([]);
      setNote("");
    }
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
          <CardContent className="p-3">
            <Tabs defaultValue="scan">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="scan">สแกน</TabsTrigger>
                <TabsTrigger value="search">ค้นหา</TabsTrigger>
                <TabsTrigger value="voice">สั่งด้วยเสียง</TabsTrigger>
              </TabsList>

              <TabsContent value="scan" className="pt-3">
                <BarcodeScanner onScan={handleScan} />
              </TabsContent>

              <TabsContent value="search" className="pt-3">
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
                        onClick={() => selectPending(m)}
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
              </TabsContent>

              <TabsContent value="voice" className="pt-3">
                <VoiceAssistant
                  medicines={medicines ?? []}
                  onConfirm={voiceConfirm}
                  onEdit={selectPending}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {pending && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="text-base">เพิ่มลงตะกร้า</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="font-medium">{pending.drug_name}</p>
                <p className="text-xs text-muted-foreground">
                  {pending.product_code} • {pending.strength} • {pending.form} • คงเหลือ{" "}
                  {formatNumber(pending.current_stock)} {pending.unit}
                </p>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="pqty">
                    {type === "adjust" ? `ยอดใหม่ (${pending.unit})` : `จำนวน (${pending.unit})`}
                  </Label>
                  <Input
                    id="pqty"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    autoFocus
                    placeholder="0"
                    value={pendingQty}
                    onChange={(e) => setPendingQty(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmPending()}
                  />
                </div>
                <Button variant="outline" onClick={() => setPending(null)}>
                  ยกเลิก
                </Button>
                <Button onClick={confirmPending}>
                  <Plus className="h-4 w-4" />
                  เพิ่ม
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4" />
            ตะกร้ารายการ
            {cart.length > 0 && <Badge variant="secondary">{cart.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>ประเภทรายการ (ทั้งตะกร้า)</Label>
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

          {cart.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <PackageSearch className="h-10 w-10 opacity-50" />
              <p className="text-sm">สแกน ค้นหา หรือสั่งด้วยเสียงเพื่อเพิ่มยาลงตะกร้า</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((it) => (
                <div
                  key={it.medicine.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.medicine.drug_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      คงเหลือ {formatNumber(it.medicine.current_stock)} {it.medicine.unit}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="h-9 w-20 text-right"
                    value={it.quantity}
                    onChange={(e) => updateQty(it.medicine.id, Number(e.target.value))}
                  />
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">
                    {it.medicine.unit}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => removeItem(it.medicine.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="note">หมายเหตุ (ไม่บังคับ)</Label>
            <Textarea
              id="note"
              rows={2}
              placeholder="เช่น เบิกให้ผู้ป่วยใน / รับจากคลังใหญ่"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={submitCart}
            disabled={submitting || cart.length === 0}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            ยืนยันทั้งหมด ({cart.length} รายการ)
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            ผู้ทำรายการ: {profile?.full_name || profile?.username}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
