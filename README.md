# Алхам ERP — Англи хэлний сургалтын төвийн удирдлагын систем

SUERP3.docx-д тодорхойлсон 7 модультай веб систем. Элсэлтийн хүсэлтээс төгсөлтийн гэрчилгээ хүртэлх урсгалыг нэг өгөгдлийн санд холбоно.

| Давхарга | Технологи |
|---|---|
| Frontend | React 18 + Vite 5 (`frontend/`) |
| Backend | Node.js 22+ + Express 5 + Prisma 6 (`backend/`) |
| Өгөгдлийн сан | XAMPP MariaDB 10.4 (`english_center_erp`, utf8mb4) |
| Удирдах хэрэгсэл | phpMyAdmin |

---

## 1. Анх удаа суулгах

### 1.1. Өгөгдлийн сан
1. XAMPP Control Panel-оос **MySQL**-ийг асаана.
2. phpMyAdmin → **SQL** таб → `database/sql/01_create_database_and_user.sql`-ийн агуулгыг буулгана. `CHANGE_ME_PASSWORD`-ийг өөрийн нууц үгээр солиод ажиллуулна.

### 1.2. Backend
```bash
cd backend
copy .env.example .env        # дараа нь .env доторх CHANGE_ME утгуудыг солино
npm install
npx prisma migrate deploy     # хүснэгтүүдийг үүсгэнэ (өгөгдөл устгахгүй)
npm run db:seed:demo          # эрх, түвшин, салбар + туршилтын хэрэглэгчид
npm run dev                   # http://localhost:5000/api
```
`JWT_SECRET` үүсгэх: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### 1.3. Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```
`/api` хүсэлтүүд Vite proxy-оор backend руу дамжина.

### 1.4. Туршилтын хэрэглэгчид (`db:seed:demo`)
| Эрх | Нэвтрэх нэр | Нууц үг |
|---|---|---|
| Захирал (бүх салбар) | `admin` | `Admin12345!` (эсвэл `.env`-ийн `SEED_ADMIN_PASSWORD`) |
| Салбарын админ | `branchadmin` | `Demo12345!` |
| Санхүү | `finance` | `Demo12345!` |
| Багш | `teacher1` | `Demo12345!` |
| Сурагч | `st2026-0001` | `Demo12345!` |
| Эцэг эх | `99887766` | `Demo12345!` |

> Эдгээр нь зөвхөн хөгжүүлэлтийн нууц үг. Production орчинд `--demo` ажиллахгүй. Нэвтэрсний дараа «Миний профайл» хэсгээс нууц үгээ солино.

---

## 2. Утасны камераар QR уншуулах

Браузер камерыг зөвхөн **HTTPS** эсвэл `localhost` дээр зөвшөөрдөг.
```bash
cd frontend
set HTTPS=1&& npm run dev     # PowerShell: $env:HTTPS='1'; npm run dev
```
Утсаараа `https://<компьютерийн IP>:5173` хаягаар орно. Өөрөө гарын үсэг зурсан сертификатын анхааруулгыг зөвшөөрнө. Утас ба компьютер нэг Wi-Fi сүлжээнд байх ёстой. Камергүй үед «QR ирц» хуудсанд кодыг гараар оруулж болно.

---

## 3. Модуль ба код

| Модуль | Backend (`backend/src/routes/`) | Frontend (`frontend/src/pages/`) |
|---|---|---|
| M1 Сурагчийн удирдлага | `leads.js`, `students.js`, `parents.js`, `enrollments.js` | `leads.jsx`, `students.jsx`, `parents.jsx` |
| M2 QR ирц | `attendance.js`, `sessions.js` | `sessions.jsx`, `portal.jsx` (ScanPage) |
| M3 Төлбөр ба санхүү | `finance.js`, `services/payments.js` | `finance.jsx` |
| M4 Сургалт ба үнэлгээ | `catalog.js`, `classes.js`, `assignments.js`, `exams.js`, `certificates.js`, `services/graduation.js`, `services/schedule.js` | `catalog.jsx`, `classes.jsx`, `assignments.jsx`, `exams.jsx` |
| M5 Эцэг эхийн портал | `portal.js` | `portal.jsx` |
| M6 Багшийн удирдлага | `teachers.js` | `teachers.jsx` |
| M7 Удирдлага ба салбар | `auth.js`, `branches.js`, `users.js`, `audit.js`, `reports.js`, `notifications.js`, `public.js` | `admin.jsx`, `core.jsx`, `public.jsx` |

Нийтлэг суурь: `backend/src/middleware/` (нэвтрэлт, эрх, салбарын хязгаар, validation, upload, алдааны формат), `backend/src/lib/` (audit, мөнгө, цаг, PDF, Excel, мэдэгдэл).
Өгөгдлийн загвар: `backend/prisma/schema.prisma`, диаграм: `docs/diagrams/erd.md`.

### Гол бизнес дүрэм
- **Элсэлт батлах** нь нэхэмжлэл ба гэрээг нэг transaction-д үүсгэнэ. Давтан батлахад давхар бичлэг үүсэхгүй.
- **Төлөлт** бүр `idempotencyKey`-тэй. Давхар дарсан эсвэл ижил QPay мэдэгдэл давтан ирсэн ч нэг л төлөлт бүртгэгдэнэ. Хэсэгчлэн төлж болно, үлдэгдлээс илүү төлөлт хүлээж авахгүй.
- **Хуваарь** нэмэхэд багш, танхим, анги гурвын цаг давхцаж байгаа эсэхийг шалгана. Мөн багшийн боломжит цаг, танхимын багтаамжийг шалгана.
- **QR** нь салбарт тохируулсан хугацаатай (анхдагч 60 сек). Token-ийн зөвхөн SHA-256 хэш хадгалагдана. Давхар уншилт нэг ирц болно. Хоцролтыг салбарын босгоор тооцно.
- **Залруулга** (ирц, дүн, төлбөр, буцаалт, цаг): шалтгаан заавал бичнэ. Хуучин ба шинэ утга `audit_logs`-д хадгалагдана.
- **Гэрчилгээ**-г ирц (M2), эцсийн дүн (M4), төлбөр (M3) гурвын шаардлагыг хангасан үед л олгоно. Дутуу шаардлагын шалтгаан харагдана. PDF-ийг `/verify/<код>` хаягаар нийтэд шалгаж болно.
- **Эцэг эх** зөвхөн админ баталгаажуулсан хүүхдийнхээ мэдээллийг харна. Чөлөө зөвшөөрөгдөхөд тухайн хугацааны ирц «Чөлөөтэй» болно.
- **Багшийн цаг**: хичээл дуусахад цаг бүртгэгдэнэ → админ батална (тухайн өдрийн ставкаар дүн тооцно) → санхүү хөлсний тооцоонд оруулна → олгоход зарлагад бүртгэгдэнэ.

---

## 4. Туршилт

```bash
cd backend
npm run dev                # нэг терминалд
npm run test:smoke         # нөгөө терминалд
```
`scripts/smoke-test.js` нь SUERP3-ийн «Хамгаалалтын нэгдсэн жишээ»-г бүхэлд нь API-аар гүйцэтгэнэ. Жишээлбэл 600,000₮-ийн нэхэмжлэлд 200,000₮ ба 150,000₮ төлөхөд үлдэгдэл 250,000₮ болохыг шалгана. Мөн заавал турших сөрөг нөхцөлүүдийг шалгана:

- дүүрсэн анги, давхардсан хуваарь
- давтан баталгаажуулалт, давхар төлөлт
- өөр хүүхдийн мэдээлэлд хандах оролдлого
- шаардлага хангаагүй үеийн гэрчилгээ
- хугацаа дууссан QR
- Excel импортын давхардал

Туршилт хөгжүүлэлтийн өгөгдлийн санд шинэ өгөгдөл үүсгэнэ. Одоо байгаа өгөгдлийг устгахгүй.

---

## 5. Нөөцлөх ба сэргээх

**Нөөцлөх** (XAMPP, `cmd`):
```bat
"C:\xampp\mysql\bin\mysqldump.exe" -u erp_user -p --single-transaction --routines english_center_erp > database\backups\erp_%date:~-4%%date:~3,2%%date:~0,2%.sql
xcopy /E /I /Y backend\uploads database\backups\uploads
```
`backend/uploads` хавтсанд гэрээ, гэрчилгээ, баримт, даалгаврын файлууд байдаг тул SQL нөөцтэй хамт хадгална.

**Сэргээх** (одоогийн өгөгдлийг дарж бичнэ — эхлээд одоогийнхоо нөөцийг авна):
```bat
"C:\xampp\mysql\bin\mysql.exe" -u erp_user -p english_center_erp < database\backups\erp_YYYYMMDD.sql
xcopy /E /I /Y database\backups\uploads backend\uploads
```
`database/backups/` болон `backend/uploads/` нь хувийн мэдээлэлтэй тул git-д орохгүй.

---

## 6. Хязгаарлалт ба цаашдын ажил
- **QPay**: `/api/public/qpay/callback` нь туршилтын горимтой бөгөөд `.env`-ийн `QPAY_WEBHOOK_SECRET`-ээр хамгаалагдсан. Бодит холболтод QPay-тэй гэрээ, client id/secret, мөн QPay API-аас төлбөрийг дахин шалгах алхам шаардлагатай.
- **SMS, Facebook Messenger** мэдэгдэл холбогдоогүй. Одоогоор систем доторх мэдэгдлээр явна. Facebook-ээс ирэх бүртгэлийг `/register?source=FACEBOOK` холбоосоор хүлээж авна.
- Тамга, гарын үсгийн зурагтай PDF нь **баталгаат цахим гарын үсэг биш**.
- Нэвтрэлтийн оролдлогын хязгаар серверийн санах ойд хадгалагддаг. Олон серверээр ажиллуулах бол Redis зэрэг нийтлэг сан хэрэгтэй.
