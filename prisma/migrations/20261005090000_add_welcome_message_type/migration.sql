-- Real Runtime Certification (Level-A gate §8) — repair the Phase-13
-- `WELCOME` message type. The messaging migration (20260920010000) created
-- `MessageQueue.messageType` as a MySQL ENUM WITHOUT `WELCOME`, but the
-- shipped portal-activation path (app/api/portal/accounts/route.ts) enqueues
-- that event, so a real database rejects the insert (MySQL strict mode,
-- error 1265) and the generated client enum never carried the member.
--
-- Appending a member to a MySQL ENUM is a metadata-only, backward-compatible
-- change: existing rows keep their values; no table rebuild; no data touched.
ALTER TABLE `MessageQueue` MODIFY COLUMN `messageType` ENUM('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H', 'DOCTOR_NEW_APPOINTMENT', 'DOCTOR_CANCELLATION', 'DOCTOR_RESCHEDULE', 'PRESCRIPTION', 'INVOICE', 'RADIOLOGY', 'REVIEW_REQUEST', 'TEST', 'WELCOME') NOT NULL
