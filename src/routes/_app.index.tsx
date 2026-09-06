import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Wallet,
  AlertTriangle,
  PackageX,
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  SlidersHorizontal,
  ShieldCheck,
  CalendarClock,
  Banknote,
  Activity,
  ChevronRight,
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
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";
import { useMedicines, useTransactions, type TransactionRow } from "@/lib/queries";
import {
  formatNumber,
  formatCurrency,
  formatDateTime,
  stockStatus,
  TX_TYPE_LABELS,
  groupMedicines,
  type Medicine,
} from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "แดชบอร์ดภาพรวม | สับสต๊อก ห้องยา รพ.สบปราบ" },
      {
        name: "description",
        content:
          "แดชบอร์ดภาพรวมคลังยา ห้องยา โรงพยาบาลสบปราบ มูลค่าคงคลัง ความพร้อมจ่าย แนวโน้มการเบิกจ่าย และยาที่ต้องเติมสต๊อก สำหรับบริหารจัดการเภสัชกรรม",
      },
      { property: "og:title", content: "แดชบอร์ดภาพรวม | สับสต๊อก ห้องยา รพ.สบปราบ" },
      {
        property: "og:description",
        content: "ภาพรวมคลังยาแบบเรียลไทม์ สำหรับการบริหารจัดการห้องยา โรงพยาบาลสบปราบ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

/* ---------- count-up animation ---------- */
function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    const to = target;
    prev.current = target;
    if (from === to) {
      setValue(to);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/* ---------- KPI card ---------- */
function KpiCard({
  title,
  numeric,
  format,
  sub,
  icon: Icon,
  tone,
  delay = 0,
}: {
  title: string;
  numeric: number;
  format: (n: number) => string;
  sub?: string;
  icon: typeof Boxes;
  tone: "primary" | "accent" | "warning" | "destructive" | "success";
  delay?: number;
}) {
  const v = useCountUp(numeric);
  const tones: Record<string, { chip: string; bar: string }> = {
    primary: { chip: "bg-primary/10 text-primary", bar: "from-primary to-primary/60" },
    accent: { chip: "bg-accent/15 text-accent-foreground", bar: "from-accent to-accent/60" },
    warning: { chip: "bg-warning/15 text-warning", bar: "from-warning to-warning/60" },
    destructive: { chip: "bg-destructive/10 text-destructive", bar: "from-destructive to-destructive/60" },
    success: { chip: "bg-success/10 text-success", bar: "from-success to-success/60" },
  };
  const t = tones[tone];
  return (
    <Card
      className="group relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ animation: `dash-fade-up 0.5s ease-out ${delay}ms both` }}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", t.bar)} />
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
            t.chip,
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{format(v)}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- section header ---------- */
function SectionTitle({ icon: Icon, title, sub }: { icon: typeof Boxes; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

const THAI_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

function Dashboard() {
  const { data: medicines, isLoading } = useMedicines();
  const { data: transactions } = useTransactions(500);

  const groups = useMemo(() => groupMedicines(medicines ?? []), [medicines]);

  const stats = useMemo(() => {
    const list = medicines ?? [];
    const totalValue = list.reduce((s, m) => s + m.current_stock * m.price_per_unit, 0);
    const lowGroups = groups.filter((g) => stockStatus(g) === "low");
    const outGroups = groups.filter((g) => stockStatus(g) === "out");
    const okGroups = groups.length - lowGroups.length - outGroups.length;
    const readiness = groups.length ? (okGroups / groups.length) * 100 : 0;
    const reorderValue = groups.reduce(
      (s, g) => s + Math.max(0, g.minimum_stock - g.current_stock) * g.price_per_unit,
      0,
    );
    return {
      count: list.length,
      groupCount: groups.length,
      totalValue,
      lowGroups,
      outGroups,
      okGroups,
      readiness,
      reorderValue,
    };
  }, [medicines, groups]);

  const txStats = useMemo(() => {
    const txs = transactions ?? [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let monthDisburseValue = 0;
    let todayCount = 0;

    const days: { label: string; dateKey: string; disburse: number; receive: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(dayStart);
      d.setDate(d.getDate() - i);
      days.push({
        label: `${d.getDate()} ${THAI_DAYS[d.getDay()]}`,
        dateKey: d.toDateString(),
        disburse: 0,
        receive: 0,
      });
    }
    const dayMap = new Map(days.map((d) => [d.dateKey, d]));

    for (const t of txs) {
      const created = new Date(t.created_at);
      if (created >= monthStart && t.type === "disburse") {
        monthDisburseValue += t.quantity * t.unit_price;
      }
      if (created >= dayStart) todayCount++;
      const bucket = dayMap.get(created.toDateString());
      if (bucket) {
        if (t.type === "disburse") bucket.disburse += t.quantity;
        else if (t.type === "receive") bucket.receive += t.quantity;
      }
    }
    return { monthDisburseValue, todayCount, trend: days };
  }, [transactions]);

  const topUsage = useMemo(() => {
    return [...groups]
      .sort((a, b) => b.usage_rate - a.usage_rate)
      .slice(0, 7)
      .map((g) => ({
        name: g.drug_name.length > 16 ? g.drug_name.slice(0, 16) + "…" : g.drug_name,
        value: g.usage_rate,
      }));
  }, [groups]);

  const pieData = [
    { name: "ปกติ", value: stats.okGroups, color: "var(--success)" },
    { name: "ใกล้หมด", value: stats.lowGroups.length, color: "var(--warning)" },
    { name: "หมด", value: stats.outGroups.length, color: "var(--destructive)" },
  ];

  const recentTx = (transactions ?? []).slice(0, 8);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <style>{`@keyframes dash-fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* Executive summary band */}
      <div
        className="gradient-brand relative overflow-hidden rounded-2xl p-6 text-primary-foreground shadow-lg sm:p-8"
        style={{ animation: "dash-fade-up 0.4s ease-out both" }}
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 right-32 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary-foreground/80">
              รายงานภาพรวมคลังยา • ห้องยา โรงพยาบาลสบปราบ
            </p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
              {formatCurrency(stats.totalValue)}
            </h2>
            <p className="mt-1 text-sm text-primary-foreground/80">
              มูลค่าสินค้าคงคลังรวม {formatNumber(stats.groupCount)} กลุ่มยา ({formatNumber(stats.count)} รายการบาร์โค้ด)
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6 sm:gap-10">
            <div>
              <p className="text-2xl font-bold tabular-nums sm:text-3xl">{formatNumber(stats.readiness, 1)}%</p>
              <p className="text-xs text-primary-foreground/80">ความพร้อมจ่าย</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums sm:text-3xl">{formatCurrency(stats.reorderValue)}</p>
              <p className="text-xs text-primary-foreground/80">งบเบิกเพิ่มโดยประมาณ</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums sm:text-3xl">{formatNumber(txStats.todayCount)}</p>
              <p className="text-xs text-primary-foreground/80">รายการเคลื่อนไหววันนี้</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="รายการยาทั้งหมด" numeric={stats.groupCount} format={(n) => formatNumber(n)} sub={`${formatNumber(stats.count)} รายการบาร์โค้ด`} icon={Boxes} tone="primary" delay={50} />
        <KpiCard title="ความพร้อมจ่าย (Service Level)" numeric={stats.readiness} format={(n) => formatNumber(n, 1) + "%"} sub={`ปกติ ${formatNumber(stats.okGroups)} จาก ${formatNumber(stats.groupCount)} กลุ่มยา`} icon={ShieldCheck} tone="success" delay={100} />
        <KpiCard title="เบิกจ่ายเดือนนี้" numeric={txStats.monthDisburseValue} format={formatCurrency} sub="มูลค่าเบิกจ่ายสะสมเดือนปัจจุบัน" icon={Banknote} tone="accent" delay={150} />
        <KpiCard title="รายการเคลื่อนไหววันนี้" numeric={txStats.todayCount} format={(n) => formatNumber(n)} sub="รับเข้า / เบิกจ่าย / ปรับยอด" icon={Activity} tone="primary" delay={200} />
        <KpiCard title="ใกล้หมด" numeric={stats.lowGroups.length} format={(n) => formatNumber(n)} sub="ต่ำกว่าจุดสั่งซื้อ" icon={AlertTriangle} tone="warning" delay={250} />
        <KpiCard title="หมดสต๊อก" numeric={stats.outGroups.length} format={(n) => formatNumber(n)} sub="ต้องเบิกด่วน" icon={PackageX} tone="destructive" delay={300} />
        <KpiCard title="งบเบิกเพิ่มโดยประมาณ" numeric={stats.reorderValue} format={formatCurrency} sub="มูลค่ายาที่ต้องเติมถึงจุดสั่งซื้อ" icon={CalendarClock} tone="warning" delay={350} />
        <KpiCard title="มูลค่าคงคลัง" numeric={stats.totalValue} format={formatCurrency} sub="ราคาทุนโดยประมาณ" icon={Wallet} tone="accent" delay={400} />
      </div>

      {/* Trend + stock status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" style={{ animation: "dash-fade-up 0.5s ease-out 200ms both" }}>
          <CardHeader>
            <SectionTitle icon={TrendingUp} title="แนวโน้มรับเข้า–เบิกจ่าย 14 วัน" sub="จำนวนหน่วยต่อวัน" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={txStats.trend} margin={{ left: 0, right: 10, top: 5 }}>
                <defs>
                  <linearGradient id="gDis" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={1} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} />
                <RTooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [formatNumber(value), name === "disburse" ? "เบิกจ่าย" : "รับเข้า"]}
                />
                <Area type="monotone" dataKey="disburse" stroke="var(--primary)" strokeWidth={2.5} fill="url(#gDis)" />
                <Area type="monotone" dataKey="receive" stroke="var(--success)" strokeWidth={2.5} fill="url(#gRec)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 flex items-center gap-6 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" /> เบิกจ่าย
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-success" /> รับเข้า
              </span>
            </div>
          </CardContent>
        </Card>

        <Card style={{ animation: "dash-fade-up 0.5s ease-out 250ms both" }}>
          <CardHeader>
            <SectionTitle icon={ShieldCheck} title="สถานะคลัง" sub="จัดกลุ่มตามรหัสยา" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
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

      {/* Top usage */}
      <Card style={{ animation: "dash-fade-up 0.5s ease-out 300ms both" }}>
        <CardHeader>
          <SectionTitle icon={TrendingUp} title="อัตราการใช้สูงสุด" sub="7 อันดับแรก (รวมทุกบาร์โค้ดของรหัสยาเดียวกัน)" />
        </CardHeader>
        <CardContent>
          {topUsage.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topUsage} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={130}
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

      {/* Actionable lists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card style={{ animation: "dash-fade-up 0.5s ease-out 350ms both" }}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <SectionTitle icon={AlertTriangle} title="ยาที่ต้องเติมสต๊อก" />
            <Link
              to="/inventory"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              ดูทั้งหมด <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...stats.outGroups, ...stats.lowGroups].slice(0, 6).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">สต๊อกอยู่ในระดับปกติ 🎉</p>
            ) : (
              [...stats.outGroups, ...stats.lowGroups].slice(0, 6).map((g) => (
                <div
                  key={g.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{g.drug_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {g.strength} • คงเหลือ {formatNumber(g.current_stock)} / ขั้นต่ำ {formatNumber(g.minimum_stock)} {g.unit}
                      {g.items.length > 1 && ` • ${g.items.length} บาร์โค้ด`}
                    </p>
                  </div>
                  <Badge
                    variant={stockStatus(g) === "out" ? "destructive" : "outline"}
                    className={stockStatus(g) === "low" ? "border-warning text-warning" : ""}
                  >
                    {stockStatus(g) === "out" ? "หมด" : "ใกล้หมด"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card style={{ animation: "dash-fade-up 0.5s ease-out 400ms both" }}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <SectionTitle icon={Activity} title="ความเคลื่อนไหวล่าสุด" />
            <Link
              to="/history"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              ดูทั้งหมด <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentTx.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีรายการ</p>
            ) : (
              recentTx.map((t: TransactionRow) => {
                const isOut = t.type === "disburse";
                const Icon = isOut ? ArrowDownRight : t.type === "receive" ? ArrowUpRight : SlidersHorizontal;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                  >
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
