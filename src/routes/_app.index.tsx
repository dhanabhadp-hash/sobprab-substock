import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Boxes,
  Wallet,
  AlertTriangle,
  PackageX,
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  SlidersHorizontal,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { useMedicines, useTransactions } from "@/lib/queries";
import { formatNumber, formatCurrency, formatDateTime, stockStatus, TX_TYPE_LABELS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({
  component: Dashboard,
});

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: typeof Boxes;
  tone: "primary" | "accent" | "warning" | "destructive";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/15 text-accent-foreground",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { data: medicines, isLoading } = useMedicines();
  const { data: transactions } = useTransactions(8);

  const stats = useMemo(() => {
    const list = medicines ?? [];
    const totalValue = list.reduce((s, m) => s + m.current_stock * m.price_per_unit, 0);
    const low = list.filter((m) => stockStatus(m) === "low");
    const out = list.filter((m) => stockStatus(m) === "out");
    const ok = list.length - low.length - out.length;
    return { count: list.length, totalValue, low, out, ok };
  }, [medicines]);

  const topUsage = useMemo(() => {
    return [...(medicines ?? [])]
      .sort((a, b) => b.usage_rate - a.usage_rate)
      .slice(0, 7)
      .map((m) => ({ name: m.drug_name.length > 14 ? m.drug_name.slice(0, 14) + "…" : m.drug_name, value: m.usage_rate }));
  }, [medicines]);

  const pieData = [
    { name: "ปกติ", value: stats.ok, color: "var(--success)" },
    { name: "ใกล้หมด", value: stats.low.length, color: "var(--warning)" },
    { name: "หมด", value: stats.out.length, color: "var(--destructive)" },
  ];

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="รายการยาทั้งหมด" value={formatNumber(stats.count)} sub="รายการ" icon={Boxes} tone="primary" />
        <StatCard title="มูลค่าคงคลัง" value={formatCurrency(stats.totalValue)} sub="ราคาทุนโดยประมาณ" icon={Wallet} tone="accent" />
        <StatCard title="ใกล้หมด" value={formatNumber(stats.low.length)} sub="ต่ำกว่าจุดสั่งซื้อ" icon={AlertTriangle} tone="warning" />
        <StatCard title="หมดสต๊อก" value={formatNumber(stats.out.length)} sub="ต้องเบิกด่วน" icon={PackageX} tone="destructive" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              อัตราการใช้สูงสุด
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topUsage.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topUsage} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={110}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RTooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="var(--primary)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">สถานะคลัง</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <RTooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-3 space-y-1.5">
              {pieData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    {d.name}
                  </span>
                  <span className="font-semibold tabular-nums">{formatNumber(d.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" />
              ยาที่ต้องเติมสต๊อก
            </CardTitle>
            <Link to="/inventory" className="text-xs font-medium text-primary hover:underline">
              ดูทั้งหมด
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...stats.out, ...stats.low].slice(0, 6).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">สต๊อกอยู่ในระดับปกติ 🎉</p>
            ) : (
              [...stats.out, ...stats.low].slice(0, 6).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.drug_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.strength} • คงเหลือ {formatNumber(m.current_stock)} / ขั้นต่ำ {formatNumber(m.minimum_stock)} {m.unit}
                    </p>
                  </div>
                  <Badge variant={stockStatus(m) === "out" ? "destructive" : "outline"} className={stockStatus(m) === "low" ? "border-warning text-warning" : ""}>
                    {stockStatus(m) === "out" ? "หมด" : "ใกล้หมด"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ความเคลื่อนไหวล่าสุด</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(transactions ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีรายการ</p>
            ) : (
              (transactions ?? []).map((t) => {
                const isOut = t.type === "disburse";
                const Icon = isOut ? ArrowDownRight : t.type === "receive" ? ArrowUpRight : SlidersHorizontal;
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        isOut ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.medicines?.drug_name ?? "-"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {TX_TYPE_LABELS[t.type]} • {t.username ?? "ระบบ"} • {formatDateTime(t.created_at)}
                      </p>
                    </div>
                    <span className={cn("text-sm font-semibold tabular-nums", isOut ? "text-destructive" : "text-success")}>
                      {isOut ? "-" : "+"}
                      {formatNumber(t.quantity)}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
