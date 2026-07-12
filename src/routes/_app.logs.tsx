import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/logs")({
  component: LogsPage,
});

interface LogRow {
  id: string;
  action: string;
  status: string;
  detail: string | null;
  username: string | null;
  created_at: string;
}

function LogsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["system_logs"],
    queryFn: async (): Promise<LogRow[]> => {
      const { data, error } = await supabase
        .from("system_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as LogRow[];
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("logs-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "system_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["system_logs"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, qc]);

  if (!isAdmin) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">เฉพาะผู้ดูแลระบบ</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <ClipboardList className="h-10 w-10 opacity-50" />
            <p className="text-sm">ยังไม่มีบันทึกระบบ</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(data ?? []).map((log) => {
              const ok = log.status === "success";
              const Icon = ok ? CheckCircle2 : XCircle;
              return (
                <div key={log.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <p className="text-sm font-medium">{log.action}</p>
                      <span className="text-xs text-muted-foreground">โดย {log.username ?? "ระบบ"}</span>
                    </div>
                    {log.detail && <p className="text-xs text-muted-foreground">{log.detail}</p>}
                  </div>
                  <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatDateTime(log.created_at)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
