-- Phase 11 — Clinical Workflow: extend TreatmentPlan + Prescription (ADD only),
-- new ClinicalNote model. doctor/appointment links use the Staff model (the
-- repo's established clinical pattern); existing rows survive (nullable adds).

-- AlterTable: TreatmentPlan — plan ownership + appointment link + clinical text
ALTER TABLE `TreatmentPlan` ADD COLUMN `doctorId` VARCHAR(191) NULL,
    ADD COLUMN `chiefComplaint` TEXT NULL,
    ADD COLUMN `diagnosis` TEXT NULL,
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'EGP',
    ADD COLUMN `appointmentId` VARCHAR(191) NULL;

-- AlterTable: Prescription — e-prescription workflow DRAFT → SIGNED → SENT
ALTER TABLE `Prescription` ADD COLUMN `status` ENUM('DRAFT', 'SIGNED', 'SENT', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `issuedAt` DATETIME(3) NULL,
    ADD COLUMN `pdfUrl` VARCHAR(191) NULL,
    ADD COLUMN `sentViaWhatsApp` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `whatsappSentAt` DATETIME(3) NULL,
    ADD COLUMN `appointmentId` VARCHAR(191) NULL,
    ADD COLUMN `treatmentPlanId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ClinicalNote` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `treatmentPlanId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `noteType` ENUM('GENERAL', 'EXAMINATION', 'TREATMENT', 'FOLLOW_UP', 'REFERRAL') NOT NULL DEFAULT 'GENERAL',
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClinicalNote_hospitalId_idx`(`hospitalId`),
    INDEX `ClinicalNote_appointmentId_idx`(`appointmentId`),
    INDEX `ClinicalNote_patientId_idx`(`patientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `TreatmentPlan_doctorId_idx` ON `TreatmentPlan`(`doctorId`);
CREATE INDEX `TreatmentPlan_appointmentId_idx` ON `TreatmentPlan`(`appointmentId`);
CREATE INDEX `Prescription_status_idx` ON `Prescription`(`status`);
CREATE INDEX `Prescription_appointmentId_idx` ON `Prescription`(`appointmentId`);
CREATE INDEX `Prescription_treatmentPlanId_idx` ON `Prescription`(`treatmentPlanId`);

-- AddForeignKey
ALTER TABLE `TreatmentPlan` ADD CONSTRAINT `TreatmentPlan_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TreatmentPlan` ADD CONSTRAINT `TreatmentPlan_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_treatmentPlanId_fkey` FOREIGN KEY (`treatmentPlanId`) REFERENCES `TreatmentPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ClinicalNote` ADD CONSTRAINT `ClinicalNote_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ClinicalNote` ADD CONSTRAINT `ClinicalNote_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ClinicalNote` ADD CONSTRAINT `ClinicalNote_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ClinicalNote` ADD CONSTRAINT `ClinicalNote_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ClinicalNote` ADD CONSTRAINT `ClinicalNote_treatmentPlanId_fkey` FOREIGN KEY (`treatmentPlanId`) REFERENCES `TreatmentPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
