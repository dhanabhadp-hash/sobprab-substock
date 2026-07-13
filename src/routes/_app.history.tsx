import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, SlidersHorizontal, Search, PackageX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber, formatDateTime, TX_TYPE_LABELS } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/history")({
  component: HistoryPage,
});

interface TxRow {
  id: string;
  type: "disburse" | "receive" | "adjust";
  quantity: number;
  balance_after: number;
  note: string | null;
  username: string | null;
  created_at: string;
  medicines?: { drug_name: string; unit: string; product_code: string } | null;
}

const TYPE_META: Record<string, { icon: typeof ArrowLeftRight; className: string }> = {
  receive: { icon: ArrowDownCircle, className: "bg-success/10 text-success border-success/30" },
  disburse: { icon: ArrowUpCircle, className: "bg-warning/15 text-warning border-warning/40" },
  adjust: { icon: SlidersHorizontal, className: "bg-primary/10 text-primary border-primary/30" },
};

function HistoryPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<"all" | "receive" | "disburse" | "adjust">("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ["tx_history", from, to],
    queryFn: async (): Promise<TxRow[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, medicines(drug_name, unit, product_code)")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as TxRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((t) => {
      const matchType = type === "all" || t.type === type;
      const matchQ =
        !q ||
        (t.medicines?.drug_name ?? "").toLowerCase().includes(q) ||
        (t.medicines?.product_code ?? "").toLowerCase().includes(q) ||
        (t.username ?? "").toLowerCase().includes(q);
      return matchType && matchQ;
    });
  }, [data, type, search]);

  const totals = useMemo(() => {
    let received = 0;
    let disbursed = 0;
    for (const t of filtered) {
      if (t.type === "receive") received += Number(t.quantity);
      else if (t.type === "disburse") disbursed += Number(t.quantity);
    }
    return { received, disbursed };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={ArrowDownCircle} label="รับเข้ารวม" value={formatNumber(totals.received)} tone="success" />
        <SummaryCard icon={ArrowUpCircle} label="จ่ายออกรวม" value={formatNumber(totals.disbursed)} tone="warning" />
        <SummaryCard icon={ArrowLeftRight} label="จำนวนรายการ" value={formatNumber(filtered.length)} tone="primary" />
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="ค้นหายา / รหัส / ผู้ทำรายการ"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกประเภท</SelectItem>
              <SelectItem value="receive">รับเข้า</SelectItem>
              <SelectItem value="disburse">เบิกจ่าย</SelectItem>
              <SelectItem value="adjust">ปรับยอด</SelectItem>
            </SelectContent>
          </Select>
          <div className="space-y-1.5">
            <Label className="text-xs">ตั้งแต่</Label>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ถึง</Label>
            <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <PackageX className="h-10 w-10 opacity-50" />
              <p className="text-sm">ไม่พบประวัติการเคลื่อนไหว</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => {
                const meta = TYPE_META[t.type] ?? TYPE_META.adjust;
                const Icon = meta.icon;
                const sign = t.type === "receive" ? "+" : t.type === "disburse" ? "-" : "=";
                return (
                  <div key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                    <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", meta.className)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <p className="text-sm font-medium">{t.medicines?.drug_name ?? "-"}</p>
                        <Badge variant="outline" className={cn("text-[11px]", meta.className)}>
                          {TX_TYPE_LABELS[t.type] ?? t.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        โดย {t.username ?? "ระบบ"} • {formatDateTime(t.created_at)}
                        {t.note ? ` • ${t.note}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {sign}
                        {formatNumber(t.quantity)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">{t.medicines?.unit ?? ""}</span>
                      </p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        คงเหลือ {formatNumber(t.balance_after)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ArrowLeftRight;
  label: string;
  value: string;
  tone: "success" | "warning" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "warning"
        ? "bg-warning/15 text-warning"
        : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-5">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", toneClass)}>
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
