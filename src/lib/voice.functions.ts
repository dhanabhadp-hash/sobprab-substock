import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ParsedVoiceCommand {
  action: "disburse" | "receive" | "adjust" | "unknown";
  drug: string;
  form: string;
  quantity: number | null;
  unit: string;
}

/**
 * แปลงคำสั่งเสียงภาษาไทยเป็นข้อมูลรายการยาแบบมีโครงสร้าง
 * ใช้ Lovable AI Gateway (chat completions + json_object)
 */
export const parseVoiceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { transcript: string }) => {
    if (!input || typeof input.transcript !== "string" || !input.transcript.trim()) {
      throw new Error("transcript is required");
    }
    return { transcript: input.transcript.trim().slice(0, 500) };
  })
  .handler(async ({ data }): Promise<ParsedVoiceCommand> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const system = `คุณเป็นผู้ช่วยแยกวิเคราะห์คำสั่งเสียงภาษาไทยสำหรับระบบคลังยาโรงพยาบาล
ให้แปลงข้อความเป็น JSON โดยมีฟิลด์:
- action: ประเภทรายการ ("disburse" = เบิก/ตัด/จ่าย, "receive" = รับ/รับเข้า/รับยา, "adjust" = ปรับยอด/ปรับข้อมูล/เปลี่ยน, "unknown" ถ้าไม่ชัด)
- drug: ชื่อยา (string, ตัดคำกริยาและจำนวนออก)
- form: รูปแบบยาถ้ามี เช่น syrup/ไซรัป/เม็ด/แคปซูล/ยาน้ำ/ครีม (string, ว่างได้)
- quantity: จำนวน (number หรือ null)
- unit: หน่วย เช่น ขวด/เม็ด/แผง/หลอด/กล่อง (string, ว่างได้)
ตอบเป็น JSON เท่านั้น ไม่ต้องอธิบาย`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.transcript },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI gateway error [${res.status}]: ${body}`);
    }

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    const action = ["disburse", "receive", "adjust"].includes(parsed.action)
      ? parsed.action
      : "unknown";
    const qtyNum = Number(parsed.quantity);

    return {
      action,
      drug: typeof parsed.drug === "string" ? parsed.drug : "",
      form: typeof parsed.form === "string" ? parsed.form : "",
      quantity: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : null,
      unit: typeof parsed.unit === "string" ? parsed.unit : "",
    };
  });
