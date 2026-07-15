import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Loader2, Check, Pencil, X, Sparkles, HelpCircle } from "lucide-react";
import { parseVoiceCommand, type ParsedVoiceCommand } from "@/lib/voice.functions";
import { fuzzyFindMedicines, type Candidate } from "@/lib/fuzzy-match";
import { formatNumber, type Medicine } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TxType = "disburse" | "receive" | "adjust";

const ACTION_LABEL: Record<TxType, string> = {
  disburse: "เบิกจ่าย (ตัดสต๊อก)",
  receive: "รับเข้า (เพิ่มสต๊อก)",
  adjust: "ปรับยอดคงเหลือ",
};

interface Review {
  action: TxType;
  medicine: Medicine;
  quantity: number;
  transcript: string;
  confidence: number;
}

interface Disambiguation {
  action: TxType;
  quantity: number;
  transcript: string;
  candidates: Candidate<Medicine>[];
}

interface Props {
  medicines: Medicine[];
  onConfirm: (action: TxType, medicine: Medicine, quantity: number) => void;
  onEdit: (medicine: Medicine) => void;
}

function medicineText(m: Medicine): string {
  return `${m.drug_name} ${m.strength ?? ""} ${m.form ?? ""}`.trim();
}

export function VoiceAssistant({ medicines, onConfirm, onEdit }: Props) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [disambig, setDisambig] = useState<Disambiguation | null>(null);
  const recognitionRef = useRef<any>(null);
  const parse = useServerFn(parseVoiceCommand);

  const handleTranscript = useCallback(
    async (transcript: string) => {
      setProcessing(true);
      setReview(null);
      setDisambig(null);
      try {
        const cmd: ParsedVoiceCommand = await parse({ data: { transcript } });
        if (cmd.action === "unknown" || (!cmd.drug && !cmd.drug_en)) {
          toast.error("ไม่เข้าใจคำสั่ง", {
            description: `"${transcript}" — ลองพูดใหม่ เช่น "ตัดพาราเซตามอล 50 เม็ด"`,
          });
          return;
        }

        // รวมคำค้นทั้งหมด: ชื่อไทย + ชื่ออังกฤษ + candidates จาก AI + form
        const queries = [cmd.drug_en, cmd.drug, ...cmd.candidates]
          .flatMap((q) => (cmd.form ? [q, `${q} ${cmd.form}`] : [q]))
          .filter(Boolean);

        const matches = fuzzyFindMedicines(queries, medicines, medicineText, 0.7);

        if (matches.length === 0) {
          toast.error("ไม่พบชื่อยา กรุณาลองใหม่", {
            description: `ค้นหา: ${cmd.drug_en || cmd.drug}${cmd.form ? " (" + cmd.form + ")" : ""}`,
          });
          return;
        }

        const quantity = cmd.quantity ?? 1;
        const top = matches[0];
        const second = matches[1];

        // หากผลลัพธ์ที่ดีที่สุดชัดเจน (คะแนนสูง และห่างจากอันดับ 2 พอสมควร) → ยืนยันเลย
        const clear = top.score >= 0.9 && (!second || top.score - second.score >= 0.1);

        if (clear || matches.length === 1) {
          setReview({
            action: cmd.action as TxType,
            medicine: top.item,
            quantity,
            transcript,
            confidence: top.score,
          });
        } else {
          // หลายรายการใกล้เคียง → ให้ผู้ใช้เลือก
          setDisambig({
            action: cmd.action as TxType,
            quantity,
            transcript,
            candidates: matches,
          });
        }
      } catch (e: any) {
        toast.error("ประมวลผลเสียงไม่สำเร็จ", { description: e?.message });
      } finally {
        setProcessing(false);
      }
    },
    [medicines, parse],
  );

  const startListening = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("อุปกรณ์นี้ไม่รองรับการสั่งงานด้วยเสียง", {
        description: "กรุณาใช้ Chrome บนมือถือหรือคอมพิวเตอร์",
      });
      return;
    }
    const rec = new SR();
    rec.lang = "th-TH";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript as string;
      handleTranscript(transcript);
    };
    rec.onerror = (event: any) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        toast.error("ไมโครโฟนขัดข้อง", { description: event.error });
      }
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [handleTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const confirmReview = () => {
    if (!review) return;
    onConfirm(review.action, review.medicine, review.quantity);
    toast.success("เพิ่มลงตะกร้าแล้ว", {
      description: `${review.medicine.drug_name} ${formatNumber(review.quantity)} ${review.medicine.unit}`,
    });
    setReview(null);
  };

  const editReview = () => {
    if (!review) return;
    onEdit(review.medicine);
    setReview(null);
  };

  const pickCandidate = (m: Medicine) => {
    if (!disambig) return;
    setReview({
      action: disambig.action,
      medicine: m,
      quantity: disambig.quantity,
      transcript: disambig.transcript,
      confidence: disambig.candidates.find((c) => c.item.id === m.id)?.score ?? 0,
    });
    setDisambig(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-2 py-2">
        <Button
          type="button"
          size="lg"
          variant={listening ? "destructive" : "default"}
          onClick={listening ? stopListening : startListening}
          disabled={processing}
          className="h-16 w-16 rounded-full p-0"
        >
          {processing ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : listening ? (
            <MicOff className="h-6 w-6" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {listening
            ? "กำลังฟัง... พูดคำสั่งได้เลย"
            : processing
              ? "กำลังประมวลผล..."
              : 'แตะเพื่อสั่งงานด้วยเสียง เช่น "ตัดพาราเซตามอล 50 เม็ด"'}
        </p>
        <p className="text-center text-[10px] text-muted-foreground">
          รองรับชื่อยาภาษาอังกฤษออกเสียงแบบไทย (Paracetamol, Amoxicillin ฯลฯ)
        </p>
      </div>

      {disambig && (
        <Card className="border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <HelpCircle className="h-4 w-4" />
              พบยาใกล้เคียงหลายรายการ กรุณายืนยัน
            </div>
            <p className="text-xs italic text-muted-foreground">"{disambig.transcript}"</p>
            <div className="space-y-2">
              {disambig.candidates.map((c) => (
                <button
                  key={c.item.id}
                  type="button"
                  onClick={() => pickCandidate(c.item)}
                  className="w-full rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.item.drug_name}</span>
                    <Badge variant="outline" className="tabular-nums">
                      {Math.round(c.score * 100)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.item.product_code} • {c.item.strength} • {c.item.form}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    คงเหลือ {formatNumber(c.item.current_stock)} {c.item.unit} · จำนวนที่จะทำรายการ{" "}
                    {formatNumber(disambig.quantity)} {c.item.unit}
                  </p>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDisambig(null)}>
              <X className="h-4 w-4" />
              ยกเลิก
            </Button>
          </CardContent>
        </Card>
      )}

      {review && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2 text-sm font-medium text-primary">
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                ทวนรายการจากเสียง
              </span>
              <Badge variant="outline" className="tabular-nums">
                ความมั่นใจ {Math.round(review.confidence * 100)}%
              </Badge>
            </div>
            <p className="text-xs italic text-muted-foreground">"{review.transcript}"</p>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">{ACTION_LABEL[review.action]}</Badge>
                <span className="text-sm font-bold tabular-nums">
                  {formatNumber(review.quantity)} {review.medicine.unit}
                </span>
              </div>
              <p className="mt-2 font-medium">{review.medicine.drug_name}</p>
              <p className="text-xs text-muted-foreground">
                {review.medicine.product_code} • {review.medicine.strength} • {review.medicine.form}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                คงเหลือปัจจุบัน {formatNumber(review.medicine.current_stock)} {review.medicine.unit}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReview(null)}>
                <X className="h-4 w-4" />
                ยกเลิก
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={editReview}>
                <Pencil className="h-4 w-4" />
                แก้ไข
              </Button>
              <Button size="sm" className="flex-1" onClick={confirmReview}>
                <Check className="h-4 w-4" />
                ยืนยัน
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
