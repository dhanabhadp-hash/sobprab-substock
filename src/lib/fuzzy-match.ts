/**
 * Fuzzy + phonetic matching สำหรับจับคู่ชื่อยาที่ผู้ใช้พูด (อาจเพี้ยน) กับฐานข้อมูล
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ก-๙\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simplified Soundex-like phonetic code (English) */
function phonetic(s: string): string {
  const w = s.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  const first = w[0];
  const map: Record<string, string> = {
    b: "1", f: "1", p: "1", v: "1",
    c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
    d: "3", t: "3",
    l: "4",
    m: "5", n: "5",
    r: "6",
  };
  let code = first.toUpperCase();
  let prev = map[first] ?? "";
  for (let i = 1; i < w.length; i++) {
    const c = map[w[i]] ?? "";
    if (c && c !== prev) code += c;
    if (c !== "") prev = c;
    else prev = "";
  }
  return (code + "0000").slice(0, 4);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** คืนคะแนนความคล้าย 0-1 */
function similarity(a: string, b: string): number {
  const A = normalize(a);
  const B = normalize(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (B.includes(A) || A.includes(B)) {
    return 0.85 + 0.15 * (Math.min(A.length, B.length) / Math.max(A.length, B.length));
  }
  const d = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length);
  const lev = 1 - d / maxLen;
  // Phonetic bonus
  const pa = phonetic(A);
  const pb = phonetic(B);
  const phon = pa && pa === pb ? 0.15 : 0;
  // Token overlap
  const ta = new Set(A.split(" ").filter((t) => t.length > 1));
  const tb = new Set(B.split(" ").filter((t) => t.length > 1));
  let overlap = 0;
  ta.forEach((t) => {
    if (tb.has(t)) overlap++;
  });
  const tok = ta.size ? overlap / ta.size : 0;
  return Math.min(1, lev * 0.7 + phon + tok * 0.2);
}

export interface Candidate<T> {
  item: T;
  score: number;
}

/**
 * ค้นหายาที่ใกล้เคียงที่สุดจากรายชื่อยา
 * @param queries — คำค้นที่เป็นไปได้ (drug ไทย, drug_en อังกฤษ, candidates อื่นๆ)
 * @param items — รายการยาในฐานข้อมูล
 * @param getText — ฟังก์ชันดึงข้อความที่ใช้เทียบจากยาแต่ละรายการ
 * @param threshold — คะแนนขั้นต่ำ (default 0.7)
 */
export function fuzzyFindMedicines<T>(
  queries: string[],
  items: T[],
  getText: (item: T) => string,
  threshold = 0.7,
): Candidate<T>[] {
  const validQueries = queries.map((q) => (q ?? "").trim()).filter(Boolean);
  if (!validQueries.length || !items.length) return [];

  const scored = items.map((item) => {
    const text = getText(item);
    let best = 0;
    for (const q of validQueries) {
      const s = similarity(q, text);
      if (s > best) best = s;
    }
    return { item, score: best };
  });

  return scored
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
