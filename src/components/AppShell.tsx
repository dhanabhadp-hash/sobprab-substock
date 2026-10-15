import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ScanBarcode,
  Barcode,
  Boxes,
  FileText,
  ClipboardList,
  History,
  Users,
  Pill,
  Menu,
  LogOut,
  Wifi,
  WifiOff,
  ChevronRight,
  Upload,
} from "lucide-react";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logoKnifePill from "@/assets/logo-knife-pill.png";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "แดชบอร์ด", icon: LayoutDashboard, roles: ["admin", "user", "visitor"] },
  { to: "/scan", label: "สแกน / เบิกจ่าย", icon: ScanBarcode, roles: ["admin", "user"] },
  { to: "/import", label: "นำเข้าไฟล์รับยา", icon: Upload, roles: ["admin", "user"] },
  { to: "/inventory", label: "คลังยา", icon: Boxes, roles: ["admin", "user", "visitor"] },
  { to: "/barcodes", label: "สร้างบาร์โค้ด", icon: Barcode, roles: ["admin", "user"] },
  { to: "/history", label: "ประวัติรับเข้า-จ่ายออก", icon: History, roles: ["admin", "user", "visitor"] },
  { to: "/reports", label: "รายงาน", icon: FileText, roles: ["admin", "user"] },
  { to: "/logs", label: "บันทึก / Audit", icon: ClipboardList, roles: ["admin"] },
  { to: "/users", label: "จัดการผู้ใช้", icon: Users, roles: ["admin"] },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "แดชบอร์ดภาพรวม",
  "/scan": "สแกน / เบิกจ่ายยา",
  "/import": "นำเข้าไฟล์รับยา (Bulk Import)",
  "/inventory": "คลังยา",
  "/barcodes": "สร้างบาร์โค้ดยา (3 x 9 ซม.)",
  "/history": "ประวัติรับเข้า-จ่ายออก",
  "/reports": "รายงาน",
  "/logs": "บันทึกระบบ / Audit Trail",
  "/users": "จัดการผู้ใช้งาน",
};

function useDbStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let active = true;
    const check = async () => {
      const { error } = await supabase.from("medicines").select("id", { head: true, count: "exact" });
      if (active) setOnline(!error);
    };
    check();
    const id = setInterval(check, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  return online;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const location = useLocation();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const active = location.pathname === item.to;
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
            {active && <ChevronRight className="h-4 w-4" />}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
        <img src={logoKnifePill} alt="โลโก้สับสต๊อก" className="h-9 w-9 object-contain" />
      </div>
      <div className="leading-tight">
        <p className="text-base font-bold text-sidebar-foreground">
          สับสต๊อก
        </p>
        <p className="text-[11px] text-sidebar-foreground/60">ห้องยา รพ.สบปราบ</p>
      </div>
    </div>
  );
}

export function AppShell() {
  const { profile, primaryRole, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const online = useDbStatus();
  const now = useClock();

  const items = useMemo(
    () => NAV_ITEMS.filter((i) => i.roles.some((r) => roles.includes(r))),
    [roles],
  );

  const title = PAGE_TITLES[location.pathname] ?? "สับสต๊อก";
  const initials = (profile?.full_name || profile?.username || "?").trim().charAt(0).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="command-shell fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks items={items} />
        </div>
        <div className="border-t border-sidebar-border p-3 text-[11px] text-sidebar-foreground/50">
          ห้องยา โรงพยาบาลสบปราบ
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="command-shell w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <Brand />
          <div className="py-2">
            <NavLinks items={items} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="command-shell sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
            aria-label="เปิดเมนู"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-sidebar-foreground sm:text-lg">{title}</h1>

          <div
            className={cn(
              "hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium sm:flex",
              online
                 ? "bg-shell-status/10 text-shell-status"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {online ? "เชื่อมต่อฐานข้อมูล" : "ขาดการเชื่อมต่อ"}
          </div>

          <div className="hidden text-right leading-tight md:block">
            <p className="text-sm font-semibold tabular-nums text-sidebar-foreground">
              {now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
            <p className="text-[11px] text-sidebar-foreground/60">
              {now.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" aria-label="เมนูบัญชีผู้ใช้" className="flex h-auto items-center gap-2 rounded-lg border-sidebar-border bg-sidebar-accent py-1 pl-1 pr-2.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-28 truncate text-sm font-medium sm:block">
                  {profile?.full_name || profile?.username || "ผู้ใช้"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="font-semibold">{profile?.full_name || profile?.username}</p>
                <p className="text-xs font-normal text-muted-foreground">
                  {primaryRole ? ROLE_LABELS[primaryRole] : "ไม่มีสิทธิ์"}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                ออกจากระบบ
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Status pill for mobile */}
        <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
              online ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
            )}
          >
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? "ออนไลน์" : "ออฟไลน์"}
          </div>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {now.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        <main className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>

        <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
          © 2026 TNP Develop • pharmacy department of sobprab hospital
        </footer>
      </div>
    </div>
  );
}
