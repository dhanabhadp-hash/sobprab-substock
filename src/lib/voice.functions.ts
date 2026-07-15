import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ParsedVoiceCommand {
  action: "disburse" | "receive" | "adjust" | "unknown";
  drug: string;
  /** คำอ่านหรือชื่อยาแปลงเป็นภาษาอังกฤษ (romanized) เพื่อใช้จับคู่กับฐานข้อมูล */
  drug_en: string;
  /** ชื่อยาที่เป็นไปได้เพิ่มเติม (สะกดต่าง/สำเนียงต่าง) */
  candidates: string[];
  form: string;
  quantity: number | null;
  unit: string;
}

/**
 * แปลงคำสั่งเสียงภาษาไทยเป็นข้อมูลรายการยาแบบมีโครงสร้าง
 * ใช้ Lovable AI Gateway (chat completions + json_object)
 * รองรับกรณีผู้ใช้พูดชื่อยาภาษาอังกฤษด้วยสำเนียงไทย → AI แปลงเป็น romanized ให้ด้วย
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

    const system = `คุณคือผู้ช่วยแยกวิเคราะห์คำสั่งเสียงภาษาไทยสำหรับระบบคลังยาโรงพยาบาล
ฐานข้อมูลเก็บชื่อยาเป็น "ภาษาอังกฤษ" (เช่น Paracetamol, Amoxicillin, Ibuprofen, Cetirizine, Omeprazole)
ผู้ใช้มักพูดชื่อยาเป็นภาษาไทยด้วยสำเนียงต่างกัน เช่น "พาราเซตามอล", "พาราเซตทามอล", "อะม็อกซี่", "อะม็อกซีซิลิน", "ไอบูโพรเฟน", "โอเมพราโซล", "เซทิริซีน"

หน้าที่ของคุณ:
1. ระบุประเภทคำสั่ง (action)
2. แยกชื่อยาที่ผู้ใช้พูด (drug) — คงตามที่ได้ยิน
3. **แปลงชื่อยาเป็นภาษาอังกฤษ (drug_en)** โดยเดาการสะกดที่น่าจะตรงกับชื่อยาสากล (INN) มากที่สุด
4. เดาชื่อยาที่ใกล้เคียงอื่นๆ ใส่ใน candidates (array ของสตริงภาษาอังกฤษ 0-4 ชื่อ) เผื่อสะกดผิด/ออกเสียงต่าง
5. แยกจำนวน (quantity), หน่วย (unit), รูปแบบยา (form)

ตอบเป็น JSON เท่านั้น มีฟิลด์:
- action: "disburse" (เบิก/ตัด/จ่าย) | "receive" (รับ/รับเข้า) | "adjust" (ปรับยอด/แก้ยอด) | "unknown"
- drug: string (ตามที่ผู้ใช้พูด)
- drug_en: string (ชื่อยาภาษาอังกฤษที่น่าจะตรง ถ้าไม่แน่ใจให้เดาการสะกดใกล้เคียง)
- candidates: string[] (ชื่ออื่นที่เป็นไปได้ ภาษาอังกฤษ)
- form: string (syrup/tab/cap/cream/injection/ว่าง)
- quantity: number | null
- unit: string (ขวด/เม็ด/แผง/หลอด/กล่อง/ว่าง)

ตัวอย่าง:
คำสั่ง: "ตัดพาราเซตามอล 50 เม็ด"
JSON: {"action":"disburse","drug":"พาราเซตามอล","drug_en":"Paracetamol","candidates":["Acetaminophen"],"form":"","quantity":50,"unit":"เม็ด"}

คำสั่ง: "รับอะม็อกซี่ 100 แคปซูล"
JSON: {"action":"receive","drug":"อะม็อกซี่","drug_en":"Amoxicillin","candidates":[],"form":"cap","quantity":100,"unit":"แคปซูล"}`;

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
    const cands = Array.isArray(parsed.candidates)
      ? parsed.candidates.filter((c: any) => typeof c === "string" && c.trim()).slice(0, 5)
      : [];

    return {
      action,
      drug: typeof parsed.drug === "string" ? parsed.drug : "",
      drug_en: typeof parsed.drug_en === "string" ? parsed.drug_en : "",
      candidates: cands,
      form: typeof parsed.form === "string" ? parsed.form : "",
      quantity: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : null,
      unit: typeof parsed.unit === "string" ? parsed.unit : "",
    };
  });
