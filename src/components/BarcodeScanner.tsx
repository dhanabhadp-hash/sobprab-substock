import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onScan: (code: string) => void;
}

export function BarcodeScanner({ onScan }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const regionId = useRef(`scanner-${Math.random().toString(36).slice(2)}`);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const stop = async () => {
    const s = scannerRef.current;
    if (s) {
      try {
        if (s.isScanning) await s.stop();
        await s.clear();
      } catch {
        /* ignore */
      }
      scannerRef.current = null;
    }
    setActive(false);
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const scanner = new Html5Qrcode(regionId.current, { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: 260, height: 160 } },
        (decoded) => {
          const now = Date.now();
          if (decoded === lastScan.current.code && now - lastScan.current.at < 2500) return;
          lastScan.current = { code: decoded, at: now };
          onScan(decoded);
        },
        () => {
          /* per-frame decode failure, ignore */
        },
      );
      setActive(true);
    } catch (e) {
      setError("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการใช้กล้อง หรือค้นหาด้วยมือ");
      await stop();
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-border bg-muted/40"
      >
        <div id={regionId.current} className="[&_video]:w-full [&_video]:object-cover" />
        {!active && (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 text-muted-foreground">
            <Camera className="h-10 w-10 opacity-50" />
            <p className="text-sm">กดปุ่มเพื่อเปิดกล้องสแกนบาร์โค้ด</p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {active ? (
        <Button variant="outline" className="w-full" onClick={stop}>
          <CameraOff className="h-4 w-4" />
          ปิดกล้อง
        </Button>
      ) : (
        <Button className="w-full" onClick={start} disabled={starting}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          เปิดกล้องสแกน
        </Button>
      )}
    </div>
  );
}
