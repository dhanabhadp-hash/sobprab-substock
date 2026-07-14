import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import logoKnifePill from "@/assets/logo-knife-pill.png";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const { session, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPosition, setRegPosition] = useState("");

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/" });
    }
  }, [loading, session, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(loginEmail.trim(), loginPassword);
    setSubmitting(false);
    if (error) {
      toast.error("เข้าสู่ระบบไม่สำเร็จ", { description: mapError(error) });
    } else {
      toast.success("เข้าสู่ระบบสำเร็จ");
      router.invalidate();
      navigate({ to: "/" });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword.length < 6) {
      toast.error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
    setSubmitting(true);
    const { error } = await signUp(
      regEmail.trim(),
      regPassword,
      regName.trim(),
      regUsername.trim(),
      regPosition.trim(),
    );
    setSubmitting(false);
    if (error) {
      toast.error("สมัครสมาชิกไม่สำเร็จ", { description: mapError(error) });
    } else {
      toast.success("สมัครสมาชิกสำเร็จ กำลังเข้าสู่ระบบ...");
      navigate({ to: "/" });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-secondary via-background to-secondary px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="gradient-brand mb-3 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg shadow-primary/20">
            <Pill className="h-8 w-8 text-primary-foreground" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            สับสต๊อก <span className="text-gradient-brand">🔪</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ระบบจัดการเบิกจ่ายยา คลังย่อยห้องยา รพ.สบปราบ
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-primary/5">
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">เข้าสู่ระบบ</TabsTrigger>
              <TabsTrigger value="register">สมัครสมาชิก</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">อีเมล</Label>
                  <Input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@sobprab.go.th"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">รหัสผ่าน</Label>
                  <Input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  เข้าสู่ระบบ
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={handleRegister} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">ชื่อ-สกุล</Label>
                  <Input
                    id="reg-name"
                    required
                    placeholder="เช่น ภญ. สมหญิง ใจดี"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-username">ชื่อผู้ใช้</Label>
                  <Input
                    id="reg-username"
                    required
                    placeholder="somying"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">อีเมล</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    required
                    placeholder="you@sobprab.go.th"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">รหัสผ่าน</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    required
                    placeholder="อย่างน้อย 6 ตัวอักษร"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  สมัครสมาชิก
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  ผู้ใช้คนแรกของระบบจะได้สิทธิ์ผู้ดูแลระบบอัตโนมัติ
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function mapError(msg: string): string {
  if (msg.includes("Invalid login credentials")) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (msg.includes("already registered")) return "อีเมลนี้ถูกใช้งานแล้ว";
  if (msg.includes("Password")) return "รหัสผ่านไม่ปลอดภัยพอ กรุณาใช้รหัสผ่านที่คาดเดายาก";
  return msg;
}
