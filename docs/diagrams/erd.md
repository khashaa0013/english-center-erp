# ER Diagram — Англи хэлний сургалтын төвийн ERP

- Эх сурвалж: SUERP3.docx (7 модуль), Master Prompt §6
- Database: `english_center_erp` · MariaDB 10.4.32 · `utf8mb4_unicode_ci`
- Энэ файл хүснэгт, гол багана, холбоосыг харуулна. Баганын бүрэн тодорхойлолт `backend/prisma/schema.prisma` файлд байна.
- Бүх хүснэгт `created_at`, ихэнх нь `updated_at` баганатай (диаграмд товчилсон).
- Хуваарийн цаг (`start_time`, `end_time`) нь `VARCHAR(5)` "HH:MM" (Asia/Ulaanbaatar). Огноо-цаг бүгд UTC-ээр хадгалагдана.

## Тэмдэглэгээ

- `||--o{` : нэг мөр — тэгээс олон мөр
- `||--o|` : нэг мөр — тэг эсвэл нэг мөр
- `|o--o{` : FK нь NULL байж болно — тэгээс олон мөр
- `PK` : Primary Key, `FK` : Foreign Key, `UK` : Unique
- `UK(a, b)` : хоёр баганын хослол давтагдахгүй
- Мөнгөн дүн бүгд `DECIMAL(12,2)`

---

## 1. M7 — Удирдлага ба салбар (цөм хүснэгтүүд)

```mermaid
erDiagram
    branches {
        int id PK
        varchar code UK
        varchar name
        varchar address
        varchar phone
        int late_threshold_minutes "хоцролтын босго"
        int qr_ttl_seconds "QR хүчинтэй хугацаа"
        varchar stamp_path "тамганы зураг"
        varchar signature_path "гарын үсгийн зураг"
        bool is_active
    }
    roles {
        int id PK
        varchar code UK "SUPER_ADMIN, BRANCH_ADMIN, FINANCE, TEACHER, STUDENT, PARENT"
        varchar name
    }
    users {
        int id PK
        int branch_id FK "NULL = бүх салбар (захирал)"
        int role_id FK
        varchar username UK
        varchar email UK "NULL байж болно"
        varchar display_name
        varchar password_hash "bcrypt"
        bool is_active
        datetime last_login_at
    }
    audit_logs {
        int id PK
        int user_id FK
        int branch_id FK
        varchar action "CREATE, UPDATE, CONFIRM, CORRECT ..."
        varchar entity_type
        int entity_id
        longtext old_values "JSON"
        longtext new_values "JSON"
        varchar reason
        int approved_by FK "батлагч (буцаалт, цаг батлах)"
        varchar ip_address
        datetime created_at
    }
    notifications {
        int id PK
        int user_id FK
        varchar title
        text body
        varchar link
        bool is_read
        datetime created_at
    }

    branches |o--o{ users : "харьяалагдана"
    roles ||--o{ users : "эрх"
    users |o--o{ audit_logs : "үйлдэл хийсэн / баталсан"
    branches |o--o{ audit_logs : "салбар"
    users ||--o{ notifications : "хүлээн авна"
    users |o--o| students : "сурагчийн нэвтрэх эрх"
    users |o--o| parents : "эцэг эхийн нэвтрэх эрх"
    users ||--o| teachers : "багшийн нэвтрэх эрх"
```

---

## 2. M1 — Сурагчийн удирдлага

```mermaid
erDiagram
    leads {
        int id PK
        int branch_id FK
        varchar contact_name
        varchar contact_phone
        varchar student_name
        date student_birth_date
        int interested_course_id FK
        int placement_level_id FK "түвшин тогтоосон"
        enum source "WALK_IN, PHONE, WEB_FORM, FACEBOOK, REFERRAL, OTHER"
        enum status "NEW, CONTACTED, PLACEMENT_TEST, CONVERTED, LOST"
        int assigned_to FK "users"
        int converted_student_id FK, UK "NULL байж болно"
    }
    students {
        int id PK
        int branch_id FK
        int user_id FK, UK "NULL байж болно"
        varchar student_code UK
        varchar last_name
        varchar first_name
        varchar register_no UK "NULL байж болно"
        date birth_date
        enum gender
        varchar phone
        int current_level_id FK
        enum status "ACTIVE, INACTIVE, GRADUATED"
    }
    parents {
        int id PK
        int user_id FK, UK
        varchar last_name
        varchar first_name
        varchar phone UK
        varchar email
    }
    parent_students {
        int id PK
        int parent_id FK "UK(parent_id, student_id)"
        int student_id FK
        enum relationship "MOTHER, FATHER, GUARDIAN, OTHER"
        int verified_by FK "админ"
        datetime verified_at "NULL = баталгаажаагүй"
    }
    training_packages {
        int id PK
        int course_id FK
        varchar name
        int sessions_count
        int duration_weeks
        decimal price
        bool is_active
    }
    enrollments {
        int id PK
        int branch_id FK
        int student_id FK "UK(student_id, class_id)"
        int class_id FK
        int package_id FK
        int lead_id FK, UK "нэг хүсэлт = нэг элсэлт"
        int transferred_from_id FK, UK "анги шилжилт"
        decimal list_price "элсэх үеийн үнэ"
        decimal discount_amount
        decimal final_amount
        enum status "PENDING, CONFIRMED, CANCELLED, COMPLETED, TRANSFERRED"
        datetime confirmed_at
        int confirmed_by FK
        varchar cancel_reason
    }
    contracts {
        int id PK
        int enrollment_id FK, UK
        varchar contract_no UK
        int signer_parent_id FK
        enum status "DRAFT, SIGNED, CANCELLED"
        varchar file_path "PDF"
        datetime signed_at
    }
    student_documents {
        int id PK
        int student_id FK
        int enrollment_id FK "NULL байж болно"
        varchar doc_type
        varchar file_path
        varchar mime_type
        int uploaded_by FK
        datetime created_at
    }

    branches ||--o{ leads : "бүртгэл"
    courses |o--o{ leads : "сонирхсон сургалт"
    english_levels |o--o{ leads : "түвшин тогтоолт"
    leads |o--o| students : "сурагч болсон"
    branches ||--o{ students : "харьяалал"
    english_levels |o--o{ students : "одоогийн түвшин"
    parents ||--o{ parent_students : "холбоос"
    students ||--o{ parent_students : "холбоос"
    branches ||--o{ enrollments : "салбар"
    students ||--o{ enrollments : "элсэлт"
    classes ||--o{ enrollments : "анги"
    training_packages ||--o{ enrollments : "багц"
    courses ||--o{ training_packages : "үнийн багц"
    enrollments ||--o| contracts : "гэрээ"
    leads |o--o| enrollments : "хүсэлтээс үүссэн элсэлт"
    enrollments |o--o| enrollments : "шилжсэн"
    parents |o--o{ contracts : "гарын үсэг зурсан"
    students ||--o{ student_documents : "баримт"
    enrollments |o--o{ student_documents : "элсэлтийн баримт"
```

---

## 3. M4 — Сургалт ба үнэлгээ (хөтөлбөр, анги, хуваарь)

```mermaid
erDiagram
    english_levels {
        int id PK
        varchar code UK "A1, A2, B1, B2, C1, C2"
        varchar name
        int sort_order
    }
    programs {
        int id PK
        varchar name UK
        varchar target_group "Хүүхэд, Өсвөр үе"
        bool is_active
    }
    courses {
        int id PK
        int program_id FK
        int level_id FK
        varchar code UK
        varchar name
        int total_sessions
        int session_minutes
        decimal min_attendance_percent "төгсөлтийн босго"
        decimal min_final_score "төгсөлтийн босго"
        bool require_full_payment "төгсөлтийн босго"
        bool is_active
    }
    classrooms {
        int id PK
        int branch_id FK "UK(branch_id, name)"
        varchar name
        int capacity
        bool is_active
    }
    classes {
        int id PK
        int branch_id FK
        int course_id FK
        int teacher_id FK "үндсэн багш"
        int classroom_id FK "үндсэн танхим"
        varchar code UK
        int capacity
        date start_date
        date end_date
        enum status "PLANNED, OPEN, IN_PROGRESS, COMPLETED, CANCELLED"
    }
    schedules {
        int id PK
        int class_id FK
        int teacher_id FK
        int classroom_id FK
        int day_of_week "1 = Даваа ... 7 = Ням"
        varchar start_time "HH:MM"
        varchar end_time "HH:MM"
    }
    class_sessions {
        int id PK
        int class_id FK
        int schedule_id FK "NULL = нэмэлт хичээл"
        int teacher_id FK "бодитоор заасан багш"
        int classroom_id FK
        datetime starts_at
        datetime ends_at
        enum status "SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED"
        varchar topic
    }
    materials {
        int id PK
        int course_id FK
        int class_id FK "NULL = курсийн бүх анги"
        varchar title
        enum type "PDF, AUDIO, LINK, OTHER"
        varchar file_path
        int uploaded_by FK
    }

    programs ||--o{ courses : "агуулна"
    english_levels ||--o{ courses : "түвшин"
    branches ||--o{ classrooms : "танхим"
    branches ||--o{ classes : "анги"
    courses ||--o{ classes : "анги нээнэ"
    teachers ||--o{ classes : "үндсэн багш"
    classrooms |o--o{ classes : "үндсэн танхим"
    classes ||--o{ schedules : "долоо хоногийн хуваарь"
    teachers ||--o{ schedules : "заана"
    classrooms ||--o{ schedules : "ашиглана"
    classes ||--o{ class_sessions : "хичээл"
    schedules |o--o{ class_sessions : "хуваариас үүссэн"
    teachers ||--o{ class_sessions : "заасан"
    classrooms ||--o{ class_sessions : "болсон танхим"
    courses ||--o{ materials : "материал"
    classes |o--o{ materials : "ангийн материал"
```

---

## 4. M4 — Сургалт ба үнэлгээ (даалгавар, шалгалт, гэрчилгээ)

```mermaid
erDiagram
    assignments {
        int id PK
        int class_id FK
        int created_by FK "teachers"
        varchar title
        text description
        enum answer_type "FILE, TEXT, AUDIO"
        varchar attachment_path
        datetime due_at
        decimal max_score
    }
    submissions {
        int id PK
        int assignment_id FK "UK(assignment_id, student_id)"
        int student_id FK
        text text_answer
        varchar file_path
        datetime submitted_at
        decimal score
        text feedback
        int graded_by FK
        enum status "SUBMITTED, LATE, GRADED, RETURNED"
    }
    exams {
        int id PK
        int class_id FK
        varchar title
        enum exam_type "QUIZ, MIDTERM, FINAL"
        datetime opens_at
        datetime closes_at
        int duration_minutes
        int max_attempts
        decimal max_score
        bool counts_for_graduation
    }
    questions {
        int id PK
        int exam_id FK
        enum question_type "MULTIPLE_CHOICE, WRITING, SPEAKING"
        text prompt
        varchar audio_path
        decimal points
        int sort_order
    }
    question_options {
        int id PK
        int question_id FK
        varchar option_text
        bool is_correct
        int sort_order
    }
    exam_attempts {
        int id PK
        int exam_id FK "UK(exam_id, student_id, attempt_no)"
        int student_id FK
        int attempt_no
        datetime started_at
        datetime deadline_at "сервер тооцно"
        datetime submitted_at
        decimal total_score
        enum status "IN_PROGRESS, SUBMITTED, GRADED, EXPIRED"
    }
    attempt_answers {
        int id PK
        int attempt_id FK "UK(attempt_id, question_id)"
        int question_id FK
        int selected_option_id FK
        text text_answer
        varchar audio_path
        decimal score
        text feedback
        int graded_by FK
    }
    exam_results {
        int id PK
        int exam_id FK "UK(exam_id, student_id)"
        int student_id FK
        int best_attempt_id FK, UK
        decimal final_score
        datetime published_at
    }
    progress_assessments {
        int id PK
        int enrollment_id FK
        enum skill "LISTENING, READING, WRITING, SPEAKING"
        decimal score
        text teacher_comment
        int assessed_by FK
        date assessed_on
    }
    certificates {
        int id PK
        int enrollment_id FK, UK
        varchar certificate_no UK
        varchar verification_code UK
        decimal attendance_percent "олгох үеийн утга"
        decimal final_score "олгох үеийн утга"
        varchar file_path "PDF"
        int issued_by FK
        datetime issued_at
        enum status "ISSUED, REVOKED"
        varchar revoke_reason
    }

    classes ||--o{ assignments : "даалгавар"
    teachers ||--o{ assignments : "үүсгэсэн"
    assignments ||--o{ submissions : "хариу"
    students ||--o{ submissions : "илгээсэн"
    classes ||--o{ exams : "шалгалт"
    exams ||--o{ questions : "асуулт"
    questions ||--o{ question_options : "сонголт"
    exams ||--o{ exam_attempts : "оролдлого"
    students ||--o{ exam_attempts : "өгсөн"
    exam_attempts ||--o{ attempt_answers : "хариулт"
    questions ||--o{ attempt_answers : "асуултын хариу"
    question_options |o--o{ attempt_answers : "сонгосон хариулт"
    exams ||--o{ exam_results : "дүн"
    students ||--o{ exam_results : "дүн"
    exam_attempts |o--o| exam_results : "шилдэг оролдлого"
    enrollments ||--o{ progress_assessments : "ахицын үнэлгээ"
    enrollments ||--o| certificates : "гэрчилгээ"
```

---

## 5. M2 — QR ирцийн систем

```mermaid
erDiagram
    qr_sessions {
        int id PK
        int class_session_id FK
        varchar token_hash UK "SHA-256, түүхий token хадгалахгүй"
        int created_by FK "users"
        datetime issued_at
        datetime expires_at
        datetime revoked_at
    }
    attendance {
        int id PK
        int class_session_id FK "UK(class_session_id, student_id)"
        int student_id FK
        enum status "PRESENT, LATE, ABSENT, EXCUSED"
        enum method "QR, MANUAL"
        int qr_session_id FK "NULL = гараар"
        datetime checked_in_at
        int late_minutes
        int confirmed_by FK "багш"
        datetime confirmed_at
        varchar client_ip
    }
    attendance_corrections {
        int id PK
        int attendance_id FK
        enum old_status
        enum new_status
        varchar reason "заавал"
        int corrected_by FK
        datetime created_at
    }

    class_sessions ||--o{ qr_sessions : "QR үүсгэнэ"
    class_sessions ||--o{ attendance : "ирц"
    students ||--o{ attendance : "ирц"
    qr_sessions |o--o{ attendance : "уншуулсан QR"
    attendance ||--o{ attendance_corrections : "залруулга"
    users ||--o{ attendance_corrections : "залруулсан"
```

---

## 6. M3 — Төлбөр ба санхүү

```mermaid
erDiagram
    invoices {
        int id PK
        int branch_id FK
        int enrollment_id FK, UK "нэг элсэлт = нэг нэхэмжлэл"
        varchar invoice_no UK
        decimal total_amount
        date due_date
        enum status "UNPAID, PARTIAL, PAID, CANCELLED"
        datetime issued_at
        int issued_by FK
    }
    payments {
        int id PK
        int invoice_id FK
        int branch_id FK
        decimal amount "0-ээс их"
        enum method "CASH, BANK_TRANSFER, CARD, QPAY"
        varchar idempotency_key UK "давхар төлбөрөөс хамгаална"
        varchar reference_no
        datetime paid_at
        int received_by FK
        enum status "COMPLETED, VOIDED"
        varchar void_reason
    }
    refunds {
        int id PK
        int invoice_id FK
        int payment_id FK
        decimal amount
        varchar reason "заавал"
        int approved_by FK
        datetime refunded_at
    }
    payment_imports {
        int id PK
        int branch_id FK
        varchar file_name
        enum status "PREVIEW, CONFIRMED, CANCELLED"
        int total_rows
        int valid_rows
        int created_by FK
        datetime confirmed_at
    }
    payment_import_rows {
        int id PK
        int import_id FK
        int row_no
        varchar invoice_no
        int invoice_id FK "тулгасан нэхэмжлэл"
        decimal amount
        enum method
        varchar reference_no "давхардал шалгана"
        datetime paid_at
        enum status "VALID, DUPLICATE, ERROR, IMPORTED"
        varchar message
    }
    payment_reminders {
        int id PK
        int invoice_id FK
        enum channel "IN_APP"
        int sent_by FK
        datetime sent_at
    }
    expenses {
        int id PK
        int branch_id FK
        varchar category
        decimal amount
        varchar description
        date spent_on
        varchar receipt_path
        int created_by FK
    }
    teacher_payouts {
        int id PK
        int branch_id FK
        int teacher_id FK
        date period_start
        date period_end
        int total_minutes
        decimal total_amount
        enum status "DRAFT, APPROVED, PAID"
        int created_by FK
        datetime paid_at
    }

    enrollments ||--o| invoices : "нэхэмжлэл"
    branches ||--o{ invoices : "салбар"
    invoices ||--o{ payments : "төлөлт"
    invoices ||--o{ refunds : "буцаалт"
    payments |o--o{ refunds : "буцаасан төлөлт"
    invoices ||--o{ payment_reminders : "сануулга"
    branches ||--o{ payment_imports : "Excel импорт"
    payment_imports ||--o{ payment_import_rows : "мөр"
    invoices |o--o{ payment_import_rows : "тулгалт"
    branches ||--o{ expenses : "зарлага"
    teachers ||--o{ teacher_payouts : "хөлсний тооцоо"
    branches ||--o{ teacher_payouts : "салбар"
    teacher_payouts |o--o{ teaching_hours : "тооцоонд орсон цаг"
```

---

## 7. M5 — Эцэг эхийн портал

```mermaid
erDiagram
    parent_requests {
        int id PK
        int parent_id FK
        int student_id FK "зөвхөн баталгаажсан холбоостой хүүхэд"
        enum request_type "LEAVE, INQUIRY"
        varchar subject
        text message
        date leave_from
        date leave_to
        enum status "PENDING, IN_REVIEW, APPROVED, REJECTED, RESOLVED"
        text response
        int handled_by FK
        datetime handled_at
    }

    parents ||--o{ parent_requests : "илгээнэ"
    students ||--o{ parent_requests : "хүүхдийн тухай"
    users |o--o{ parent_requests : "шийдвэрлэсэн"
```

---

## 8. M6 — Багшийн удирдлага

```mermaid
erDiagram
    teachers {
        int id PK
        int user_id FK, UK
        int branch_id FK
        varchar teacher_code UK
        varchar last_name
        varchar first_name
        varchar phone
        date hired_on
        enum status "ACTIVE, INACTIVE"
    }
    teacher_courses {
        int id PK
        int teacher_id FK "UK(teacher_id, course_id)"
        int course_id FK
    }
    teacher_availability {
        int id PK
        int teacher_id FK
        int day_of_week
        varchar start_time "HH:MM"
        varchar end_time "HH:MM"
    }
    teacher_rates {
        int id PK
        int teacher_id FK
        decimal hourly_rate
        date effective_from
        date effective_to "NULL = одоо хүчинтэй"
        int created_by FK
    }
    teaching_hours {
        int id PK
        int class_session_id FK, UK
        int teacher_id FK
        int planned_minutes
        int actual_minutes
        enum status "PENDING, APPROVED, REJECTED"
        int approved_by FK
        datetime approved_at
        int rate_id FK "батлах үеийн тариф"
        decimal amount "сервер тооцно"
        int payout_id FK "NULL = тооцоонд ороогүй"
    }

    users ||--o| teachers : "нэвтрэх эрх"
    branches ||--o{ teachers : "харьяалал"
    teachers ||--o{ teacher_courses : "заадаг"
    courses ||--o{ teacher_courses : "заагч багш"
    teachers ||--o{ teacher_availability : "боломжит цаг"
    teachers ||--o{ teacher_rates : "тариф"
    teachers ||--o{ teaching_hours : "заасан цаг"
    class_sessions ||--o| teaching_hours : "цаг бүртгэл"
    teacher_rates |o--o{ teaching_hours : "хэрэглэсэн тариф"
    teacher_payouts |o--o{ teaching_hours : "M3 руу дамжсан"
```