import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Copy, Loader2, PackageX, ChevronRight, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useMedicines } from "@/lib/queries";
import { formatNumber, formatCurrency, stockStatus, groupMedicines, type Medicine, type StockStatus } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
});

const STATUS_META: Record<StockStatus, { label: string; className: string }> = {
  ok: { label: "ปกติ", className: "bg-success/10 text-success border-success/30" },
  low: { label: "ใกล้หมด", className: "bg-warning/15 text-warning border-warning/40" },
  out: { label: "หมด", className: "bg-destructive/10 text-destructive border-destructive/30" },
};

interface FormState {
  product_code: string;
  drug_name: string;
  strength: string;
  form: string;
  unit: string;
  barcode: string;
  price_per_unit: string;
  usage_rate: string;
  minimum_stock: string;
  current_stock: string;
}

const EMPTY_FORM: FormState = {
  product_code: "",
  drug_name: "",
  strength: "",
  form: "",
  unit: "เม็ด",
  barcode: "",
  price_per_unit: "0",
  usage_rate: "0",
  minimum_stock: "0",
  current_stock: "0",
};

function InventoryPage() {
  const { isAdmin } = useAuth();
  const { data: medicines, isLoading } = useMedicines();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | StockStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggleExpand = (key: string) =>
    setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const groups = useMemo(() => groupMedicines(medicines ?? []), [medicines]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      const matchQ =
        !q ||
        g.drug_name.toLowerCase().includes(q) ||
        g.product_code.toLowerCase().includes(q) ||
        g.barcodes.some((b) => b.toLowerCase().includes(q));
      const matchF = filter === "all" || stockStatus(g) === filter;
      return matchQ && matchF;
    });
  }, [groups, search, filter]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (m: Medicine) => {
    setEditing(m);
    setForm({
      product_code: m.product_code,
      drug_name: m.drug_name,
      strength: m.strength ?? "",
      form: m.form ?? "",
      unit: m.unit,
      barcode: m.barcode ?? "",
      price_per_unit: String(m.price_per_unit),
      usage_rate: String(m.usage_rate),
      minimum_stock: String(m.minimum_stock),
      current_stock: String(m.current_stock),
    });
    setDialogOpen(true);
  };

  const openDuplicate = (m: Medicine) => {
    setEditing(null);
    setForm({
      product_code: m.product_code,
      drug_name: m.drug_name,
      strength: m.strength ?? "",
      form: m.form ?? "",
      unit: m.unit,
      barcode: "",
      price_per_unit: String(m.price_per_unit),
      usage_rate: String(m.usage_rate),
      minimum_stock: String(m.minimum_stock),
      current_stock: "0",
    });
    setDialogOpen(true);
    toast.info("คัดลอกข้อมูลยาแล้ว", { description: "ใส่บาร์โค้ดใหม่ (บริษัทอื่น) แล้วบันทึกเป็นรายการใหม่" });
  };

  const handleSave = async () => {
    if (!form.product_code.trim() || !form.drug_name.trim()) {
      toast.error("กรุณากรอกรหัสยาและชื่อยา");
      return;
    }
    setSaving(true);
    const payload = {
      product_code: form.product_code.trim(),
      drug_name: form.drug_name.trim(),
      strength: form.strength.trim() || null,
      form: form.form.trim() || null,
      unit: form.unit.trim() || "หน่วย",
      barcode: form.barcode.trim() || null,
      price_per_unit: Number(form.price_per_unit) || 0,
      usage_rate: Number(form.usage_rate) || 0,
      minimum_stock: Number(form.minimum_stock) || 0,
      current_stock: Number(form.current_stock) || 0,
    };
    const { error } = editing
      ? await supabase.from("medicines").update(payload).eq("id", editing.id)
      : await supabase.from("medicines").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("บันทึกไม่สำเร็จ", { description: error.message });
      return;
    }
    toast.success(editing ? "แก้ไขข้อมูลยาสำเร็จ" : "เพิ่มยาใหม่สำเร็จ");
    qc.invalidateQueries({ queryKey: ["medicines"] });
    setDialogOpen(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="ค้นหาชื่อยา / รหัส / บาร์โค้ด"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกสถานะ</SelectItem>
              <SelectItem value="ok">ปกติ</SelectItem>
              <SelectItem value="low">ใกล้หมด</SelectItem>
              <SelectItem value="out">หมด</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  เพิ่มยา
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editing ? "แก้ไขข้อมูลยา" : "เพิ่มยาใหม่"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="รหัสยา *" value={form.product_code} onChange={(v) => setForm({ ...form, product_code: v })} />
                  <Field label="บาร์โค้ด" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} />
                  <div className="sm:col-span-2">
                    <Field label="ชื่อยา *" value={form.drug_name} onChange={(v) => setForm({ ...form, drug_name: v })} />
                  </div>
                  <Field label="ความแรง" value={form.strength} onChange={(v) => setForm({ ...form, strength: v })} />
                  <Field label="รูปแบบ" value={form.form} onChange={(v) => setForm({ ...form, form: v })} />
                  <Field label="หน่วย" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
                  <Field label="ราคา/หน่วย" type="number" value={form.price_per_unit} onChange={(v) => setForm({ ...form, price_per_unit: v })} />
                  <Field label="อัตราการใช้/เดือน" type="number" value={form.usage_rate} onChange={(v) => setForm({ ...form, usage_rate: v })} />
                  <Field label="จุดสั่งซื้อขั้นต่ำ" type="number" value={form.minimum_stock} onChange={(v) => setForm({ ...form, minimum_stock: v })} />
                  <Field label="ยอดคงเหลือ" type="number" value={form.current_stock} onChange={(v) => setForm({ ...form, current_stock: v })} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    ยกเลิก
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    บันทึก
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <PackageX className="h-10 w-10 opacity-50" />
              <p className="text-sm">ไม่พบรายการยา</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>ยา</TableHead>
                    <TableHead className="hidden md:table-cell">รหัสยา</TableHead>
                    <TableHead className="hidden lg:table-cell">บาร์โค้ด</TableHead>
                    <TableHead className="text-right">คงเหลือรวม</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">ขั้นต่ำ</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">ต้องเบิกเพิ่ม</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">ราคา/หน่วย</TableHead>
                    <TableHead className="text-center">สถานะ</TableHead>
                    {isAdmin && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((g) => {
                    const st = stockStatus(g);
                    const reorder = Math.max(Math.ceil(g.minimum_stock - g.current_stock), 0);
                    const multi = g.items.length > 1;
                    const isOpen = expanded.includes(g.key);
                    const single = g.items[0];
                    return (
                      <Fragment key={g.key}>
                        <TableRow>
                          <TableCell className="pr-0">
                            {multi && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => toggleExpand(g.key)}
                                title="ดูบาร์โค้ดทั้งหมด"
                              >
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{g.drug_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {[g.strength, g.form].filter(Boolean).join(" • ")}
                              {multi && (
                                <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  {g.items.length} บาร์โค้ด (รวมยอด)
                                </span>
                              )}
                            </p>
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">{g.product_code}</TableCell>
                          <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                            {multi ? `${g.barcodes.length} รหัส` : (g.barcodes[0] ?? "-")}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatNumber(g.current_stock)}{" "}
                            <span className="text-xs font-normal text-muted-foreground">{g.unit}</span>
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                            {formatNumber(g.minimum_stock)}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums sm:table-cell">
                            {reorder > 0 ? (
                              <span className="font-semibold text-warning">{formatNumber(reorder)}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
                            {formatCurrency(g.price_per_unit)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={cn("font-medium", STATUS_META[st].className)}>
                              {STATUS_META[st].label}
                            </Badge>
                          </TableCell>
                          {isAdmin && (
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openDuplicate(single)}
                                  title="คัดลอก (บาร์โค้ดใหม่)"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                                {!multi && (
                                  <Button variant="ghost" size="icon" onClick={() => openEdit(single)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        {multi &&
                          isOpen &&
                          g.items.map((m) => (
                            <TableRow key={m.id} className="bg-muted/40">
                              <TableCell />
                              <TableCell className="text-xs text-muted-foreground">
                                ↳ บาร์โค้ด {m.barcode ?? "(ยังไม่ระบุ)"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell" />
                              <TableCell className="hidden font-mono text-xs lg:table-cell">{m.barcode ?? "-"}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatNumber(m.current_stock)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell" />
                              <TableCell className="hidden sm:table-cell" />
                              <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
                                {formatCurrency(m.price_per_unit)}
                              </TableCell>
                              <TableCell />
                              {isAdmin && (
                                <TableCell>
                                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        แสดง {formatNumber(filtered.length)} กลุ่มยา (รวม {formatNumber((medicines ?? []).length)} บาร์โค้ด/รายการ)
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
