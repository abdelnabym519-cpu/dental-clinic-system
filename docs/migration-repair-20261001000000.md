# استرجاع فشل الـ migration — `20261001000000_add_multimodal_attachments_phase6` (P3018 / MySQL 3780)

**Root cause (proven from the repo, not assumed):** كل الـ migrations قبل Phase 6 تنشئ الجداول بالخيار
`DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` — بينما ملفات Phase 6/8/9 (AI phases) نَسِيت هذا الخيار،
فورثت الجداول الجديدة **collation السيرفر الافتراضي** (`utf8mb4_0900_ai_ci` في `mysql:8.4` بلا أي `command:` override في
`docker-compose.dev.yml`). أعمدة FK النصية في MySQL تشترط تطابق الـ collation، لذلك:

```text
MultimodalAttachment.hospitalId = VARCHAR(191) COLLATE utf8mb4_0900_ai_ci   (الافتراضي الجديد)
Hospital.id                     = VARCHAR(191) COLLATE utf8mb4_unicode_ci   (الأساس القديم)
→ MySQL 3780 / Prisma P3018 عند الاستعلام رقم 7 (أول FK)
```

القاعدة المتبعة: **المفتاح الأساسي القيادي هو المرجع** — `Hospital.id` لا يُمَسّ؛ الجداول الجديدة هي التي تتوافق معه.
نفس العيب موجود في `20261002000000_add_ai_memory_phase8` (جدولان) و`20261003000000_add_ai_workflow_run_phase9`
(جدول واحد بدون FKs لكن drift مستقبلي) — تم إصلاح الثلاثة معًا وإلا كان الـ deploy سيفشل مرة أخرى عند Phase 8.

**لماذا التعديل في مكان الـ migration آمن:** لم ينجح هذا الـ migration في أي بيئة معروفة (الساندبوكس بلا MySQL إطلاقًا
موثق في Phase 12؛ وجهازك المحلي هو أول محاولة حقيقية وفشل). فتعديل الملف لا يعيد كتابة تاريخ ناجح، وقيمة الـ checksum
القديمة في `_prisma_migrations` ستُستبدل عند إعادة التطبيق بعد `--rolled-back`.

---

## خطوات التنفيذ على جهازك (بالعربية، الأوامر كما هي)

### 0) الحالة قبل أي شيء
```bash
git status
git branch --show-current   # arena/01a0ce7a-dental-clinic-system
git log -10 --oneline
```

### 1) تشخيص مقروء فقط (read-only) — أثبت الحالة بنفسك
```sql
SHOW CREATE TABLE Hospital;                 -- لاحظ COLLATE=utf8mb4_unicode_ci
SHOW CREATE TABLE MultimodalAttachment;     -- لاحظ COLLATE=utf8mb4_0900_ai_ci ولا توجد FKs
SELECT migration_name, finished_at, rolled_back_at, logs FROM _prisma_migrations ORDER BY started_at;
-- phase6 = failed (finished_at NULL، logs فيها 3780)
SELECT COUNT(*) AS attachment_rows FROM MultimodalAttachment;   -- ⬅ MUST be 0 (انظر الخطوة 3)
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('Hospital','MultimodalAttachment') AND COLUMN_NAME IN ('id','hospitalId');
```

### 2) اجلب ملفات الإصلاح إلى فرعك المحلي
```bash
git fetch origin
git checkout origin/arena/01a0f3e0-dental-clinic-system -- \
  prisma/migrations/20261001000000_add_multimodal_attachments_phase6/migration.sql \
  prisma/migrations/20261002000000_add_ai_memory_phase8/migration.sql \
  prisma/migrations/20261003000000_add_ai_workflow_run_phase9/migration.sql
git commit -m "fix(prisma): repair multimodal attachment hospital FK migration (collation)"
```

### 3) إثبات أمان الاسترجاع (إلزامي قبل أي خطوة تالية)
`SELECT COUNT(*) FROM MultimodalAttachment;` يجب أن يكون **0** — الجدول أنشأه هذا الـ migration نفسه لحظة الفشل
والتطبيق لم يشتغل أصلًا. إذا كان أكبر من 0: **توقف** واستخدم المسار البديل الموثق آخر هذا الملف.

### 4) تصحيح حالة P3018 ثم إعادة التطبيق
```bash
npx prisma migrate resolve --rolled-back 20261001000000_add_multimodal_attachments_phase6
npx prisma migrate deploy
```
- `--rolled-back` هي الحالة الصحيحة: الـ migration لم يكتمل (أول FK فشل والثاني لم يُنفذ).
- إعادة التطبيق آمنة الآن: `DROP TABLE IF EXISTS` ينظف الجدول الجزئي الفارغ ثم يعيد إنشاءه بالـ collation الصحيح،
  ثم Phase 8 و Phase 9 ينجحان.

### 5) التحقق بعد الإصلاح
```sql
SHOW CREATE TABLE MultimodalAttachment;
-- المتوقع: COLLATE=utf8mb4_unicode_ci + 2 FK (hospitalId→Hospital.id، patientId→Patient.id)
SELECT COUNT(*) FROM `MultimodalAttachment` m LEFT JOIN `Hospital` h ON h.id = m.hospitalId
WHERE m.hospitalId IS NOT NULL AND h.id IS NULL;   -- المتوقع 0 (لا مراجع يتيمة)
```
```bash
npx prisma validate
npx prisma generate
npx prisma migrate status        # Database schema is up to date!
npx prisma migrate deploy        # Already in sync, no migrations found (idempotent)
npm run dev:start                # MySQL ready → deploy no-op → seed-check → Next.js
curl http://localhost:3000/api/health   # 200
curl http://localhost:3000/api/ready    # {"status":"ready","checks":{"database":"ok",...}}
npm test -- --run
npx tsc --noEmit
npx tsx ai-validation/robot-runtime/validate.mts   # بوابة الروبوت (44 صفًا)
```
ثم افتح المتصفح، سجّل دخول DOCTOR، وجرّب جلسة Robot جديدة:
`وريني مواعيد المرضى النهارده` → `اعرضلي جدول بكرة` → `مين عنده متابعة النهارده؟` → `هات حالة أحمد` →
`آخر زيارة كانت إمتى؟` → `آخر أشعة ليه؟` → `هات حالة أحمد وافتح آخر أشعة ليه وقولي هل فيه حاجة محتاجة متابعة` →
`هات أحمد` → `لا، قصدي محمد` → `آخر أشعة ليه؟`.

---

## المسار البديل (فقط إذا كان `COUNT(*) > 0` — بيانات غير متوقعة في الجدول)
لا تحذف شيئًا. حوّل الـ collation وحافظ على الصفوف، أكمل ما تبقى من الـ migration يدويًا، ثم وثّق الحالة الصحيحة:
```sql
ALTER TABLE `MultimodalAttachment` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `MultimodalAttachment` ADD CONSTRAINT `MultimodalAttachment_hospitalId_fkey`
  FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MultimodalAttachment` ADD CONSTRAINT `MultimodalAttachment_patientId_fkey`
  FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
```
```bash
npx prisma migrate resolve --applied 20261001000000_add_multimodal_attachments_phase6
npx prisma migrate deploy   # يكمل Phase 8/9
```
(هذا هو المسار الموثق من Prisma لحالة «أصلحت قاعدة البيانات يدويًا وأكملت بند الـ migration».)

## ملاحظة مستقبلية
Prisma لا يصدر خيار collation في الـ migrations تلقائيًا — أي migration يدوي جديد يجب أن يُبقي على
`DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` لكل جدول (هذه now documented convention).
