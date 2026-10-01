# สับบบ สต๊อก

คุณคือนักพัฒนาเว็บแอพพลิเคชั่นมืออาชีพ ช่วยสร้างเว็บแอปพลิเคชัน



"สับบบบ 🔪🔪สต๊อก" ระบบจัดการเบิกจ่ายยาคลังย่อย ห้องยา รพ.สบปราบ







ใช้ "AI-First Serverless Web App" ที่เบา คล่องตัว 







สถาปัตยกรรมระบบ (System Architecture)



Frontend: ใช้ HTML/CSS/JavaScript (Vanilla JS) ธรรมดา หรือเชื่อมด้วย Vue.js (CDN) เพื่อความง่าย โดยฝังตัวอยู่บน Google Apps Script (Web App) 







Database (Google Sheets): ทำหน้าที่เป็นฐานข้อมูล เก็บ,อ่าน,แปลงข้อมูลเป็นรูปแบบ json มาแสดงบน HTML  โดยแบ่งเป็น Sheets ย่อยดังนี้:



Inventory: เก็บข้อมูลยา (ID, ชื่อยา, บาร์โค้ด, จำนวนคงเหลือ, จุดแจ้งเตือน)



Transaction_Logs: เก็บประวัติการเบิกจ่าย (Timestamp, User, ID ยา, จำนวน, ประเภท)



User_Auth: เก็บข้อมูลผู้ใช้ (Username, Password Hashed, Role: Admin/User/Visitor)



System_Logs: เก็บประวัติการเข้าใช้งาน (Log Active) ตามเงื่อนไขความปลอดภัย



**Google sheets ฐานข้อมูล : https://docs.google.com/spreadsheets/d/18c51-3OfiHa3Na67GGLKIsmFVe4NQWAL7rd4n7ILvEc/edit?usp=drivesdk







Backend & API: ใช้ Google Apps Script (GAS) เขียนฟังก์ชัน doPost(e) และ doGet(e) ทำหน้าที่เป็น API Gateway รับค่าจากการสแกนบาร์โค้ดหน้าเว็บ -> ไปตัดสต็อกใน Google Sheets -> แล้วส่งข้อมูลกลับมา







2. การประยุกต์ใช้  (Gemini API)



ด้วยจำนวนยาเพียง 120 รายการ คุณสามารถดึงข้อมูลยาทั้งหมดใส่เข้าไปใน Context Window ของ Gemini ได้เลย (เทคนิค RAG แบบรวดเร็ว) เพื่อทำหน้าที่เป็น "ผู้ช่วยอัจฉริยะประจำคลังยา" โดยสั่งการผ่านข้อความหรือเสียง:







AI Dashboard & Report Analyst: แทนที่จะเขียนโค้ดสร้างกราฟซับซ้อน ให้ส่งข้อมูลจาก Google Sheets ไปให้ Gemini วิเคราะห์ แล้วสั่งให้ส่งคำตอบกลับมาเป็น JSON เพื่อนำไปวาดกราฟง่ายๆ หรือให้ AI เขียนสรุปรายงานเป็นข้อความ เช่น "เดือนนี้ยา A มีการเบิกจ่ายสูงกว่าปกติ 20% แนะนำให้สำรองเพิ่ม"







Natural Language Disbursing: พัฒนาช่องพิมพ์สั่งงานด้วยเสียง/ข้อความ เช่น พิมพ์ว่า "เบิกยาพารา 5 กล่อง" -> ส่งข้อความนี้ไปให้ Gemini -> ให้ AI สกัดข้อมูลออกมาเป็น JSON: { "action": "disburse", "item": "พารา", "quantity": 5 } -> ส่งต่อให้ Google Apps Script ไปตัดสต็อกใน Sheet ทันที โดยไม่ต้องกดคลิกหลายรอบ







Smart Assistant: ให้ความรู้เฉพาะด้านแก่ผู้ใช้ (เช่น Visitor หรือ User) เมื่อสแกนบาร์โค้ดแล้ว สามารถถาม AI ต่อได้ทันทีเกี่ยวกับ จำนวนคงเหลือ  มูลค่าคงคลัง  สร้างรายงาน







3. ระบบสแกนบาร์โค้ดและการจัดการแดชบอร์ด



Barcode Scanner: เนื่องจากรันบนเว็บและใช้คนน้อย ใช้คลังโปรแกรม Html5-qrcode ฝังในหน้าเว็บ JavaScript หน้ากากเว็บจะเปิดกล้องมือถือหรือโน้ตบุ๊ก เมื่อสแกนติด ให้ยิงรหัสไอดีนั้นไปที่ Google Apps Script เพื่อค้นหาและตัดสต็อกใน Google Sheets ทันที







Dashboard: ใช้ Google Looker Studio (ชื่อเดิมคือ Data Studio) เชื่อมต่อตรงกับ Google Sheets ตัวนี้จะสร้างกราฟ แดชบอร์ด และรายงานได้สวยงามมากโดยไม่ต้องเขียนโค้ดแสดงผลเองเลย และสามารถฝัง (Embed) หน้า Looker Studio นี้เข้ามาโชว์ในเว็บแอปพลิเคชันของคุณได้โดยตรง







4. ระบบความปลอดภัยระดับต้น (Security & Roles)



สำหรับผู้ใช้ 5 คน (Admin=1, User=3, Visitor=1) สามารถจัดการความปลอดภัยผ่านโค้ดในระบบได้ดังนี้:



Authentication (Login): สร้างฟอร์ม Login บนหน้าเว็บ เมื่อกดยืนยัน ให้ส่ง Username/Password ไปเช็คกับข้อมูลใน Sheet User_Auth (แนะนำให้ใช้ฟังก์ชัน JavaScript แฮชรหัสผ่านก่อนส่ง เช่น SHA-256 เพื่อไม่ให้เห็นรหัสผ่านเป็นตัวหนังสือปกติในคลังข้อมูล)







Role-Based Access Control (RBAC):



Admin: เข้าถึงได้ทุกหน้า แก้ไขสต็อกยา เพิ่ม/ลดรายการยา ดู Log ได้ทั้งหมด ไม่มีข้อจำกัด



User: เข้าได้เฉพาะหน้าสแกนเบิกจ่ายยา ดูสต็อกคงเหลือ พิมพ์ สร้าง ส่งออกรายงาน



Visitor: ดูได้เฉพาะหน้าแดชบอร์ดภาพรวม หรือค้นหาข้อมูลยาผ่าน AI เท่านั้น (ไม่มีสิทธิ์กดเบิกหรือแก้ไขข้อมูล)







Active Logs: ทุกครั้งที่มีการเรียกใช้ API (เช่น Login สำเร็จ, สแกนยา, เปลี่ยนแปลงสต็อก) ให้เขียนฟังก์ชันใน Google Apps Script เพิ่มแถวใหม่ (Append Row) ลงใน Sheet System_Logs เสมอ โดยบันทึกข้อมูล: วันเวลา | ชื่อผู้ใช้ | สิ่งที่ทำ | สถานะสำเร็จหรือไม่







6.การสร้างรายงาน (Reporting System)



ระบบรายงานที่ดีควรยืดหยุ่นและรองรับการนำข้อมูลไปใช้งานต่อได้อย่างมีประสิทธิภาพ:



รูปแบบไฟล์: ต้องรองรับการส่งออกข้อมูล (Export) เป็น Excel (.xlsx) โดยใช้ Library เช่น exceljs และ PDF โดยใช้ pdfmake หรือ puppeteer สำหรับทำใบเสร็จ/ใบเบิกสินค้าที่จัดฟอร์แมตสวยงาม



ประเภทรายงาน:



รายงานสรุปยอดเบิกจ่ายประจำเดือน



รายงาน10อันดับ รายการยาเบิกใช้สูงสุด-รับเข้าสูงสุด  (จำนวน,มูลค่า)



รายงาน ส่งเบิกคลังใหญ่ (แสดงรายการยาที่เหลือน้อยกว่าจุดแจ้งเตือน/fixstock,) **ใช้เทมเพลตเอกสารที่แนบเป็นตัวอย่างในการสร้างเอกสาร



รายงานตรวจสอบประวัติการทำรายการย้อนหลัง (Audit Trail Report) เพื่อความโปร่งใส







7.ระบบ Audit ปรับลด เพิ่ม ยาในแอพให้ตรงกับที่มีอยู่จริง 







UI



-รองรับการแสดงผลในทุกหน้าจออุปกรณ์ 



-มุมบนขวามือ แสดงสถานะเขื่อต่อกับฐานข้อมูล  เวลา วันที่ ปัจจุบัน



-มีเนนูนำทางโดยแยกแต่ละฟีเฟอร์การทำงาน ด้านบนหรือด้านข้าง  ปรับให้เหมาะสมและความสวยงาม  (เมื่อกดเรียกใช้เมนูให้ยุยตัวกลับอัตโนมัติ)



-หนัาแรกของแอพ แสดงเป็นแดชบอร์ดแบบเรียลไทม์

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://sobprab-substock.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/11ee494f-9ecc-4a76-a09e-eae0dc0b1759).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
