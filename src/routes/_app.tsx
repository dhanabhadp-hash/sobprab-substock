import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Loader2, Pill } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading, primaryRole } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="gradient-brand flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg">
          <Pill className="h-7 w-7 text-primary-foreground" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          กำลังโหลดระบบ...
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" />;
  }

  if (!primaryRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold text-foreground">บัญชียังไม่ได้รับสิทธิ์</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            บัญชีของคุณยังไม่ถูกกำหนดสิทธิ์การใช้งาน กรุณาติดต่อผู้ดูแลระบบ
          </p>
        </div>
      </div>
    );
  }

  return <AppShell />;
}
