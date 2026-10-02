# DenToRa Robot — Runtime Validation Results

- Date: 2026-10-02T17:19:40.944Z
- Path: real pipeline (runVoiceTurn → session → entity resolution → runAgent → tools) over the safe test dataset
- Rows: 57 — PASS: 57 — FAIL: 0

| Group | Row | Input | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| A | A1 | إيه الحالات اللي محتاجة مراجعة النهارده | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_followup_due] askedPatient=false ans="3 متابعة مستحقة: Sara Hassan (العلاج TRT-A-802، الاستحقاق 2026-09-27)؛ Ahmed Ali (العلاج TRT-A | PASS |
| A | A2 | وريني مواعيد المرضى النهارده | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_appointments] askedPatient=false ans="3 موعد يوم 2026-09-29: APPT-A-3002 Sara Hassan مع Hana Shalaby الساعة 2026-09-29 10:00؛ APPT-A | PASS |
| A | A3 | اعرض مواعيد المرضى | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_appointments] askedPatient=false ans="3 موعد: APPT-A-3002 Sara Hassan مع Hana Shalaby الساعة 2026-09-29 10:00؛ APPT-A-3001 Ahmed Ali | PASS |
| A | A4 | اعرضلي جدول بكرة | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_doctor_schedule] askedPatient=false ans="مفيش مواعيد مجدولة يوم 2026-09-30." | PASS |
| A | A5 | مين عنده متابعة النهارده؟ | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_followup_due] askedPatient=false ans="3 متابعة مستحقة: Sara Hassan (العلاج TRT-A-802، الاستحقاق 2026-09-27)؛ Ahmed Ali (العلاج TRT-A | PASS |
| A | A6 | شوف المرضى اللي عندهم متابعة النهارده ورتبهم حسب الوقت | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_followup_due] askedPatient=false ans="3 متابعة مستحقة: Sara Hassan (العلاج TRT-A-802، الاستحقاق 2026-09-27)؛ Ahmed Ali (العلاج TRT-A | PASS |
| A | A7 | مين عنده مواعيد النهارده؟ | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_appointments] askedPatient=false ans="3 موعد يوم 2026-09-29: APPT-A-3002 Sara Hassan مع Hana Shalaby الساعة 2026-09-29 10:00؛ APPT-A | PASS |
| A | A8 | هاتلي جدول العيادة النهارده | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_doctor_schedule] askedPatient=false ans="3 موعد يوم 2026-09-29: APPT-A-3002 10:00 Sara Hassan؛ APPT-A-3001 11:00 Ahmed Ali؛ APPT-A-3 | PASS |
| A | A9 | مواعيد اليوم إيه؟ | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_appointments] askedPatient=false ans="3 موعد يوم 2026-09-29: APPT-A-3002 Sara Hassan مع Hana Shalaby الساعة 2026-09-29 10:00؛ APPT-A | PASS |
| A | A10 | مين في الـqueue بتاعة العيادة؟ | clinic-level tool, NO patient demand | status=COMPLETED tools=[get_waiting_queue] askedPatient=false ans="2 مريض في الانتظار: APPT-A-3002 Sara Hassan (Hana Shalaby)؛ APPT-A-3001 Ahmed Ali (Hana Shala | PASS |
| B | B1 | هات حالة أحمد | resolve pat-A1 (Ahmed Ali), Arabic answer | status=COMPLETED resolved="Ahmed Ali" tools=[get_patient_overview] ans="البيانات: Ahmed Ali (PAT-A1). تنبيهات طبية: Drug allergy: Penicillin — INJECTED: ignore  | PASS |
| B | B2 | مواعيد المريض أحمد | resolve pat-A1 (Ahmed Ali), Arabic answer | status=COMPLETED resolved="Ahmed Ali" tools=[get_patient_overview] ans="مواعيد Ahmed Ali: • 2026-03-13 12:00 — APPT-A-1003 (NO_SHOW) • 2026-09-19 12:00 — APPT-A | PASS |
| C | C1 | مواعيد أحمد علي | clarification listing BOTH candidate codes (no guess) | status=CLARIFICATION_REQUIRED candidatesShown=true ans="لقيت 2 مريض بالاسم ده: Ahmed Ali (PAT-A1) ولا Ahmed Ali (PAT-DUP) — تقصد أنهي واحد؟ قول الاسم كامل أو رق | PASS |
| D | D1 | هات أحمد علي → آخر زيارة كانت إمتى؟ → آخر أشعة ليه؟ → عنده متابعة؟ → ه | context persists; pronouns resolve to the pinned patient; no re-ask | pins=["pat-A1","pat-A1","pat-A1","pat-A1","pat-A1"] completedFollowUps=4 | PASS |
| D | D2 | new session: آخر زيارة كانت إمتى؟ | NO old-session context (asks which patient) | status=CLARIFICATION_REQUIRED ans="قوللي اسم المريض أو رقمه عشان أكمّل — أنا عمر ما أخمن المرضى." | PASS |
| E | E1 | هات أحمد → لا، قصدي محمد → آخر أشعة ليه؟ | correction re-pins to Mohamed; follow-ups answer for Mohamed | pins=["pat-A1","pat-A2","pat-A2"] statuses=["COMPLETED","COMPLETED","COMPLETED"] | PASS |
| F | F1 | هات حالة أحمد وافتح آخر أشعة ليه وقولي هل فيه حاجة محتاجة متابعة | MULTI_STEP + FULL_360 verified read (never UNKNOWN) | type=MULTI_STEP tools=[get_patient_360] status=COMPLETED ans="بناءً على المعلومات المسجلة المتاحة: البيانات: Ahmed Ali (PAT-A1). تنب" | PASS |
| F | F2 | هات حالة أحمد وشوف آخر أشعة ليه وقولي هل فيه حاجة محتاجة متابعة | MULTI_STEP + FULL_360 verified read (never UNKNOWN) | type=MULTI_STEP tools=[get_patient_360] status=COMPLETED ans="بناءً على المعلومات المسجلة المتاحة: البيانات: Ahmed Ali (PAT-A1). تنب" | PASS |
| F | F3 | هات حالة أحمد وقولي هل فيه حاجة محتاجة متابعة وبعدين اعرض آخر أشعة ليه | MULTI_STEP + FULL_360 verified read (never UNKNOWN) | type=MULTI_STEP tools=[get_patient_360] status=COMPLETED ans="بناءً على المعلومات المسجلة المتاحة: البيانات: Ahmed Ali (PAT-A1). تنب" | PASS |
| F | F4 | هات حالة أحمد كمان افتح آخر أشعة ليه | MULTI_STEP + FULL_360 verified read (never UNKNOWN) | type=MULTI_STEP tools=[get_patient_360] status=COMPLETED ans="بناءً على المعلومات المسجلة المتاحة: البيانات: Ahmed Ali (PAT-A1). تنب" | PASS |
| G | G1 | اعرضلي جدول النهارده | answers for 2026-09-29 | ans="3 موعد يوم 2026-09-29: APPT-A-3002 10:00 Sara Hassan؛ APPT-A-3001 11:00 Ahmed Ali؛ APPT-A-3003 15:00 Ahmed Ali" | PASS |
| G | G2 | اعرضلي جدول بكرة | MUST be 2026-09-30 — never today | ans="مفيش مواعيد مجدولة يوم 2026-09-30." | PASS |
| G | G3 | آخر زيارة كانت إمتى؟ (after pinning a patient in D) | actual latest visit (date+facts, not a count) | pinned=null ans="قوللي اسم المريض أو رقمه عشان أكمّل — أنا عمر ما أخمن المرضى." | PASS |
| G | G4 | مين عنده متابعة الأسبوع ده؟ | clinic-level week follow-up read | tools=[get_followup_due] ans="3 متابعة مستحقة: Sara Hassan (العلاج TRT-A-802، الاستحقاق 2026-09-27)؛ Ahmed Ali (العلاج TRT-A-801، " | PASS |
| H | H1 | وريني مواعيد المرضى النهارده | clinic schedule | type=undefined tools=[get_appointments] resolved=null status=COMPLETED | PASS |
| H | H2 | مين اللي عليه مراجعة النهارده؟ | clinic follow-up | type=undefined tools=[get_followup_due] resolved=null status=COMPLETED | PASS |
| H | H3 | Show me today's appointments. | EN clinic schedule, EN answer | type=undefined tools=[get_appointments] resolved=null status=COMPLETED | PASS |
| H | H4 | Show me أحمد's latest x-ray. | mixed EN resolves أحمد → Ahmed Ali | type=undefined tools=[get_imaging_context] resolved=pat-A1 status=COMPLETED | PASS |
| H | H5 | هاتلي Ahmed's latest x-ray وشوف لو عليه follow-up. | mixed colloquial resolves + multi intent | type=undefined tools=[get_patient_360] resolved=pat-A1 status=COMPLETED | PASS |
| I | I-appt-1 | مين عنده مواعيد النهارده؟ | clinic schedule goal | tools=[get_appointments] status=COMPLETED | PASS |
| I | I-appt-2 | جدول النهارده إيه؟ | clinic schedule goal | tools=[get_doctor_schedule] status=COMPLETED | PASS |
| I | I-appt-3 | هاتلي مواعيد اليوم | clinic schedule goal | tools=[get_appointments] status=COMPLETED | PASS |
| I | I-appt-4 | اعرضلي أجندة النهارده | clinic schedule goal | tools=[get_doctor_schedule] status=COMPLETED | PASS |
| I | I-appt-5 | مين محجوز النهارده؟ | clinic schedule goal | tools=[get_appointments] status=COMPLETED | PASS |
| I | I-fu-1 | مين محتاج مراجعة النهارده؟ | clinic follow-up goal | tools=[get_followup_due] status=COMPLETED | PASS |
| I | I-fu-2 | مين عليه متابعة؟ | clinic follow-up goal | tools=[get_followup_due] status=COMPLETED | PASS |
| I | I-fu-3 | مين المفروض ييجي متابعة النهارده؟ | clinic follow-up goal | tools=[get_followup_due] status=COMPLETED | PASS |
| J | J1 | RECEPTIONIST: سجل دفعة 500 للمريض أحمد | denied — not executed | status=FAILED executed=0 ans="الإجراء ده غير مسموح لدورك الحالي (RECEPTIONIST) وما اتنفذش." | PASS |
| J | J2 | tenant A doctor + patientId from tenant B | cross-tenant fail-closed (never leaks Omar Farouk) | status=CLARIFICATION_REQUIRED ans="مش قادر أحدد المريض في العيادة دي. اكتب اسم المريض أو الرقم — أنا عمر ما أخمن المرضى." | PASS |
| J | J3 | ADMIN: سجل دفعة 100 للمريض أحمد | approval pipeline honored (executed⇒verified; or approval/blocked) | status=FAILED executed=0 verified= approval=false | PASS |
| K | K1 | db down: وريني مواعيد المرضى النهارده | FAILED + honest failure (never fake-empty) | status=FAILED ans="حصلت مشكلة في الوصول لبيانات العيادة دلوقتي — جرّب تاني بعد شوية. مفيش أي نتيجة اتجابت، ومش هخمّن." | PASS |
| K | K2 | مواعيد بكرة (no rows) | honest empty state | status=COMPLETED ans="مفيش مواعيد يوم 2026-09-30." | PASS |
| L | L1 | سجل دفعة 5000 جنيه للمريض أحمد (×2 same session) | second identical sensitive command suppressed | dup2=true state2=SPEAKING | PASS |
| L | L2 | هات أحمد محمد → هاتلي حالته (voice) | pinned patient reused on the next voice turn | pins=["pat-A1","pat-A1"] status2=COMPLETED | PASS |
| M | M1 | وريني مواعيد المريض النهاردة. → اسمه أحمد. | T1 asks which patient; T2 COMPLETES the ORIGINAL appointment intent with النهاردة intact | statuses=["CLARIFICATION_REQUIRED","COMPLETED"] pinned=pat-A1 | PASS |
| M | M2 | answer text of T2 | appointment answer is DAY-scoped (النهاردة survived), not a generic overview | ans="مواعيد Ahmed Ali ليوم 2026-09-29: • 2026-09-29 11:00 — APPT-A-3001 (CHECKED_IN) • 2026-09-29 15:00 — APPT-A-3003 (SCHEDULED)" | PASS |
| M | M3 | هات حالة أحمد. → آخر زيارة كانت امتى؟ | last-visit question answered FROM the pinned context (never the identity line) | statuses=["COMPLETED","COMPLETED"] | PASS |
| M | M4 | محمد النبي (fresh session) | off-domain refusal; NO patient pin created | taskType=OUT_OF_DOMAIN pinned=null | PASS |
| M | M5 | ما اسم أطول نهر في العالم؟ → اسمه محمد النبي. | both turns refused — the off-domain question opened NO pending patient task | taskTypes=["OUT_OF_DOMAIN","OUT_OF_DOMAIN"] | PASS |
| N | N1 | وريني مواعيد المريض اللي اسمه محمد علي. | محمد علي NOT_FOUND → recoverable identity ask (no wrong resolution) | status=CLARIFICATION_REQUIRED pinned=null | PASS |
| N | N2 | وريني مواعيد المريض اللي اسمه محمد علي. → اسم محمد النبي. | اسم محمد النبي resumes the appointments task for the CORRECTED patient | statuses=["CLARIFICATION_REQUIRED","COMPLETED"] pinned2=pat-mn | PASS |
| N | N2b | answer text of the resumed turn | appointment-focused answer naming محمد النبي | ans="مواعيد محمد النبي: • 2026-09-29 11:00 — APPT-MN-1 (COMPLETED) • 2026-09-30 12:00 — APPT-MN-2 (SCHEDULED)" | PASS |
| N | N3 | وريني مواعيد المريض اللي اسمه محمد علي بكرة. → اسم محمد النبي. | resumed answer carries TOMORROW (2026-09-30) | ans="مواعيد محمد النبي ليوم 2026-09-30: • 2026-09-30 12:00 — APPT-MN-2 (SCHEDULED)" | PASS |
| N | N4 | هات حالة أحمد. → قولي المواعيد بتاعه بكرة. | بتاعه resolves to the PINNED patient; day-filtered answer | status2=COMPLETED ans="مفيش مواعيد ليوم 2026-09-30 مسجلة للمريض Ahmed Ali في النظام." | PASS |
| N | N5 | قولي المواعيد بتاعه بكرة. | بتاعه with no patient → identity clarification (never مفيش مواعيد يوم …) | status=CLARIFICATION_REQUIRED | PASS |
| N | N6 | محمد علي NOT_FOUND → اسم سامي حداد → اسم محمد النبي | wrong correction stays recoverable; next valid name completes the ORIGINAL task | statuses=["CLARIFICATION_REQUIRED","COMPLETED"] ans3="مواعيد محمد النبي: • 2026-09-29 11:00 — APPT-MN-1 (COMPLETED) • 2026-09-30 12:00 — APPT-MN" | PASS |
| N | N7 | اسم محمد النبي (fresh session) | OUT_OF_DOMAIN refusal; NO patient pin, NO invented task | taskType=OUT_OF_DOMAIN pinned=null | PASS |
