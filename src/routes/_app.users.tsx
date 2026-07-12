import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, ShieldAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
});

interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  created_at: string;
  role: AppRole | null;
}

function UsersPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, username, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      const roleMap = new Map<string, AppRole>();
      (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role as AppRole));
      return (profiles ?? []).map((p) => ({ ...p, role: roleMap.get(p.id) ?? null }));
    },
    enabled: isAdmin,
  });

  const changeRole = async (userId: string, role: AppRole) => {
    setUpdatingId(userId);
    const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (!delErr) {
      const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (insErr) {
        toast.error("เปลี่ยนสิทธิ์ไม่สำเร็จ", { description: insErr.message });
      } else {
        toast.success("อัปเดตสิทธิ์สำเร็จ");
        qc.invalidateQueries({ queryKey: ["admin-users"] });
      }
    } else {
      toast.error("เปลี่ยนสิทธิ์ไม่สำเร็จ", { description: delErr.message });
    }
    setUpdatingId(null);
  };

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
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 opacity-50" />
            <p className="text-sm">ยังไม่มีผู้ใช้งาน</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(data ?? []).map((u) => {
              const initials = (u.full_name || u.username || "?").trim().charAt(0).toUpperCase();
              const isSelf = u.id === currentUser?.id;
              return (
                <div
                  key={u.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary text-sm text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{u.full_name || u.username || "ไม่ระบุชื่อ"}</p>
                      {isSelf && <Badge variant="secondary">คุณ</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      @{u.username ?? "-"} • เข้าร่วม {formatDate(u.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {updatingId === u.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Select
                      value={u.role ?? undefined}
                      onValueChange={(v) => changeRole(u.id, v as AppRole)}
                      disabled={updatingId === u.id}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="กำหนดสิทธิ์" />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
