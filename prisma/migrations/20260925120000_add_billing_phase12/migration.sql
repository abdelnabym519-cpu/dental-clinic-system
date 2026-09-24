-- Phase 12 — Billing Complete: extend Invoice/Payment/InvoiceItem (ADD only).
-- The billing core (Phase 8) is preserved; this migration adds the clinical
-- links (appointment/treatment plan), actor attribution, the issue lifecycle
-- (ISSUED + issuedAt/paidAt/pdfUrl/sentViaWhatsApp) and PAYMOB support.
-- Enums are native MySQL — new members are appended at the end so historical
-- rows keep decoding (same convention as the Egyptianization migration).

-- AlterTable: Invoice — clinical links, attribution, issue lifecycle, PDF
ALTER TABLE `Invoice` ADD COLUMN `appointmentId` VARCHAR(191) NULL,
    ADD COLUMN `treatmentPlanId` VARCHAR(191) NULL,
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'EGP',
    ADD COLUMN `issuedAt` DATETIME(3) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `pdfUrl` VARCHAR(191) NULL,
    ADD COLUMN `sentViaWhatsApp` BOOLEAN NOT NULL DEFAULT false;

-- Enum: InvoiceStatus + ISSUED (appended, legacy values untouched)
ALTER TABLE `Invoice` MODIFY COLUMN `status`
  ENUM('DRAFT', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED', 'ISSUED')
  NOT NULL DEFAULT 'DRAFT';

-- AlterTable: Payment — gateway payload + attribution + patient link
ALTER TABLE `Payment` ADD COLUMN `gatewayResponse` JSON NULL,
    ADD COLUMN `patientId` VARCHAR(191) NULL,
    ADD COLUMN `recordedById` VARCHAR(191) NULL;

-- Enum: PaymentMethod + PAYMOB (appended)
ALTER TABLE `Payment` MODIFY COLUMN `paymentMethod`
  ENUM('CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'INSURANCE', 'WALLET', 'ONLINE', 'INSTAPAY', 'FAWRY', 'PAYMOB')
  NOT NULL;

-- AlterTable: InvoiceItem — optional clinical context
ALTER TABLE `InvoiceItem` ADD COLUMN `toothNumber` INT NULL,
    ADD COLUMN `procedureCode` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Invoice_appointmentId_idx` ON `Invoice`(`appointmentId`);
CREATE INDEX `Invoice_treatmentPlanId_idx` ON `Invoice`(`treatmentPlanId`);
CREATE INDEX `Invoice_createdById_idx` ON `Invoice`(`createdById`);
CREATE INDEX `Payment_patientId_idx` ON `Payment`(`patientId`);
CREATE INDEX `Payment_recordedById_idx` ON `Payment`(`recordedById`);

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_treatmentPlanId_fkey` FOREIGN KEY (`treatmentPlanId`) REFERENCES `TreatmentPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
