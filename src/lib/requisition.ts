import type { Medicine } from "@/lib/format";

export interface RequisitionItem {
  name: string;
  unit: string;
  current_stock: number;
  reorder: number;
  price: number;
  total: number;
}

export interface RequisitionDoc {
  doc_date: string; // ISO yyyy-mm-dd
  department: string;
  purpose: string;
  requester_name: string;
  requester_position?: string;
  items: RequisitionItem[];
}

export const DEFAULT_DEPARTMENT = "เภสัชกรรมและคุ้มครองผู้บริโภค";
export const DEFAULT_PURPOSE = "บริการผู้ป่วยที่เข้ารับการรักษา";

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export function buildRequisitionItems(medicines: Medicine[]): RequisitionItem[] {
  return medicines.map((m) => {
    const reorder = Math.max(Math.ceil(m.minimum_stock - m.current_stock), 0);
    return {
      name: [m.drug_name, m.strength, m.form].filter(Boolean).join(" "),
      unit: m.unit,
      current_stock: m.current_stock,
      reorder,
      price: m.price_per_unit,
      total: m.price_per_unit > 0 && reorder > 0 ? reorder * m.price_per_unit : 0,
    };
  });
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function num(n: number, d = 0) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function printRequisitionDoc(doc: RequisitionDoc): boolean {
  const d = new Date(doc.doc_date + "T00:00:00");
  const day = d.getDate();
  const month = TH_MONTHS[d.getMonth()];
  const year = d.getFullYear() + 543;

  const rows = doc.items
    .map((it, i) => {
      const price = it.price > 0 ? num(it.price, 2) : "";
      const total = it.total > 0 ? num(it.total, 2) : "";
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td class="c"></td>
        <td class="c">${num(it.current_stock)}</td>
        <td class="c">${it.reorder > 0 ? num(it.reorder) : ""}</td>
        <td class="c"></td>
        <td class="r">${price}</td>
        <td class="r">${total}</td>
      </tr>`;
    })
    .join("");

  const requester = doc.requester_name || "";

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<title>ใบเบิกเวชภัณฑ์</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 1.4cm 1.2cm; }
  body { font-family: 'IBM Plex Sans Thai', sans-serif; color: #000; font-size: 13px; margin: 0; }
  h1 { text-align: center; font-size: 20px; margin: 0 0 4px; }
  .top { display: flex; justify-content: flex-end; font-size: 13px; margin-bottom: 6px; }
  .meta { line-height: 2; margin-bottom: 8px; }
  .dot { display: inline-block; border-bottom: 1px dotted #000; min-width: 60px; text-align: center; padding: 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 4px 6px; font-size: 12px; vertical-align: middle; }
  th { text-align: center; font-weight: 600; }
  td.c { text-align: center; }
  td.r { text-align: right; }
  tbody td { height: 26px; }
  .signs { display: flex; flex-wrap: wrap; margin-top: 24px; break-inside: avoid; page-break-inside: avoid; }
  .sign { width: 50%; padding: 10px 8px 18px; text-align: center; }
  .sline { border-bottom: 1px dotted #000; display: inline-block; min-width: 220px; }
  .srole { margin-left: 6px; }
  .sname { margin-top: 6px; }
  .spos { margin-top: 4px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
</style></head>
<body>
  <div class="top">เลขที่ <span class="dot">&nbsp;</span></div>
  <h1>ใบเบิกเวชภัณฑ์</h1>
  <div class="meta">
    สำหรับโรงพยาบาล / ฝ่าย <span class="dot">${esc(doc.department)}</span>
    เพื่อใช้ในงาน <span class="dot">${esc(doc.purpose)}</span><br />
    ลงวันที่ <span class="dot">${day}</span> เดือน <span class="dot">${month}</span> พ.ศ. <span class="dot">${year}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:6%">ลำดับ</th>
        <th>รายการยาที่ต้องเบิก</th>
        <th style="width:9%">จำนวนจ่าย<br/>ต่อเดือน</th>
        <th style="width:9%">จำนวน<br/>คงเหลือ</th>
        <th style="width:10%">จำนวนที่จะ<br/>เบิกใหม่</th>
        <th style="width:10%">จำนวน<br/>อนุมัติจ่าย</th>
        <th style="width:11%">ราคา/หน่วย</th>
        <th style="width:12%">ราคารวม</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="signs">
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้ขอเบิก</span>
      <div class="sname">( ${esc(requester)} )</div>
      <div class="spos">ตำแหน่ง <span class="sline" style="min-width:150px">&nbsp;</span></div>
    </div>
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้สั่งจ่าย</span>
      <div class="sname">( นายกลวัชร วะเท )</div>
      <div class="spos">ตำแหน่ง เภสัชกรชำนาญการ</div>
    </div>
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้รับ</span>
      <div class="sname">( ${esc(requester)} )</div>
      <div class="spos">ตำแหน่ง <span class="sline" style="min-width:150px">&nbsp;</span></div>
    </div>
    <div class="sign">
      ลงชื่อ <span class="sline">&nbsp;</span> <span class="srole">ผู้จ่าย</span>
      <div class="sname">( นางสาวกนกวรรณ ศรีจันทร์ )</div>
      <div class="spos">ตำแหน่ง จพ.เภสัชปฏิบัติงาน</div>
    </div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
