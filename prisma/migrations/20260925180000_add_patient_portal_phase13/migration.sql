-- Phase 13 — Patient Portal Complete: PATIENT role + portal account linking.
-- The existing OTP portal (lib/patient-auth.ts, app/portal/*) is preserved;
-- this migration adds the PATIENT member to the Role enum and the link from
-- Patient to its optional portal User account (password login / D4).
-- Enums are native MySQL — new members are appended at the end so historical
-- rows keep decoding (same convention as the Egyptianization + Phase 12
-- migrations).

-- Enum: Role + PATIENT (appended, legacy roles untouched)
ALTER TABLE `User` MODIFY COLUMN `role`
  ENUM('SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT', 'PATIENT')
  NOT NULL DEFAULT 'RECEPTIONIST';

-- AlterTable: Patient — portal account linking (D4)
ALTER TABLE `Patient` ADD COLUMN `portalUserId` VARCHAR(191) NULL,
    ADD COLUMN `portalEnabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (unique)
CREATE UNIQUE INDEX `Patient_portalUserId_key` ON `Patient`(`portalUserId`);

-- AddForeignKey
ALTER TABLE `Patient` ADD CONSTRAINT `Patient_portalUserId_fkey` FOREIGN KEY (`portalUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
