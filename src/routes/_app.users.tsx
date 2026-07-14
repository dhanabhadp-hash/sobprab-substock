import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, ShieldAlert, Loader2, Pencil, DatabaseBackup, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  position: string | null;
  created_at: string;
  role: AppRole | null;
}

function UsersPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ full_name: "", username: "", position: "" });
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, username, position, created_at")
          .order("created_at"),
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

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({
      full_name: u.full_name ?? "",
      username: u.username ?? "",
      position: u.position ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!form.full_name.trim() || !form.username.trim()) {
      toast.error("กรุณากรอกชื่อ-สกุล และชื่อผู้ใช้");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name.trim(),
        username: form.username.trim(),
        position: form.position.trim() || null,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      toast.error("บันทึกไม่สำเร็จ", { description: error.message });
      return;
    }
    toast.success("แก้ไขข้อมูลผู้ใช้สำเร็จ");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    setEditing(null);
  };

  const backupData = async () => {
    setBackingUp(true);
    try {
      const [meds, tx, reqs, profiles, roles, logs] = await Promise.all([
        supabase.from("medicines").select("*"),
        supabase.from("transactions").select("*"),
        supabase.from("requisitions").select("*"),
        supabase.from("profiles").select("*"),
        supabase.from("user_roles").select("*"),
        supabase.from("system_logs").select("*"),
      ]);
      const backup = {
        exported_at: new Date().toISOString(),
        app: "สับสต๊อก - รพ.สบปราบ",
        medicines: meds.data ?? [],
        transactions: tx.data ?? [],
        requisitions: reqs.data ?? [],
        profiles: profiles.data ?? [],
        user_roles: roles.data ?? [],
        system_logs: logs.data ?? [],
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `substock-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("สำรองข้อมูลสำเร็จ", {
        description: `ยา ${backup.medicines.length} • เคลื่อนไหว ${backup.transactions.length} รายการ`,
      });
    } catch (e: any) {
      toast.error("สำรองข้อมูลไม่สำเร็จ", { description: e?.message });
    } finally {
      setBackingUp(false);
    }
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
    <div className="space-y-4">
      {/* Backup / Backend */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="h-4 w-4 text-primary" />
            สำรองข้อมูล (Backup)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            ดาวน์โหลดข้อมูลทั้งหมด (ยา, การเคลื่อนไหว, ใบเบิก, ผู้ใช้) เป็นไฟล์ JSON
            เพื่อเก็บสำรองไว้นอกระบบ ป้องกันข้อมูลสูญหาย แนะนำให้สำรองเป็นประจำ
          </p>
          <Button onClick={backupData} disabled={backingUp} className="shrink-0">
            {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            ดาวน์โหลด Backup
          </Button>
        </CardContent>
      </Card>

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
                        @{u.username ?? "-"}
                        {u.position ? ` • ${u.position}` : ""} • เข้าร่วม {formatDate(u.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {updatingId === u.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      <Button variant="outline" size="icon" onClick={() => openEdit(u)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Select
                        value={u.role ?? undefined}
                        onValueChange={(v) => changeRole(u.id, v as AppRole)}
                        disabled={updatingId === u.id}
                      >
                        <SelectTrigger className="w-36">
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

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>แก้ไขข้อมูลผู้ใช้</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">ชื่อ-สกุล</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ชื่อผู้ใช้</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ตำแหน่ง</Label>
              <Input
                placeholder="เช่น เภสัชกรชำนาญการ"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              ยกเลิก
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
