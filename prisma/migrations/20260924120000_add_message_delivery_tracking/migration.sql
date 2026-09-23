-- Phase 10 — provider correlation + delivery tracking on queued messages.
-- providerMessageId stores the provider message id (Meta `wamid`, Baileys
-- message key id) so the Meta webhook can correlate delivery receipts;
-- deliveryStatus/deliveredAt/readAt are webhook-driven (SENT is set by the
-- queue at send time; DELIVERED/READ/FAILED arrive via the webhook).

-- AlterTable
ALTER TABLE `MessageQueue` ADD COLUMN `providerMessageId` VARCHAR(191) NULL,
    ADD COLUMN `deliveryStatus` VARCHAR(191) NULL,
    ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `readAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `MessageQueue_providerMessageId_idx` ON `MessageQueue`(`providerMessageId`);
