-- Egyptianization: pivot platform defaults from India to Egypt.
-- Non-destructive: only column DEFAULTs change (existing rows keep their
-- values) and new enum members / columns are added. No data is dropped.
-- Dialect: MySQL 8 (matches prisma/schema.prisma datasource).

-- Clinic-level defaults: Arabic (Egypt), EGP, Africa/Cairo.
ALTER TABLE `Hospital` ALTER COLUMN `locale` SET DEFAULT 'ar-EG';
ALTER TABLE `Hospital` ALTER COLUMN `country` SET DEFAULT 'EG';
ALTER TABLE `Hospital` ALTER COLUMN `currency` SET DEFAULT 'EGP';
ALTER TABLE `Hospital` ALTER COLUMN `timezone` SET DEFAULT 'Africa/Cairo';

-- Billing money is Egyptian pounds by default.
ALTER TABLE `Invoice` ALTER COLUMN `currency` SET DEFAULT 'EGP';
ALTER TABLE `SubscriptionPayment` ALTER COLUMN `currency` SET DEFAULT 'EGP';

-- Patient region defaults to Cairo (legacy template defaulted to an
-- Indian state).
ALTER TABLE `Patient` ALTER COLUMN `state` SET DEFAULT 'القاهرة';

-- Egyptian VAT: the single 14% rate lives in the legacy cgst columns
-- (sgst remains 0). Defaults only — existing rows are untouched.
ALTER TABLE `Invoice` ALTER COLUMN `cgstRate` SET DEFAULT 14;
ALTER TABLE `Invoice` ALTER COLUMN `sgstRate` SET DEFAULT 0;

-- Egyptian payment methods and providers. MySQL enums are rewritten with the
-- full member list — legacy members stay (in their original positions) so
-- historical rows keep decoding; the new members are appended at the end.
ALTER TABLE `Payment` MODIFY COLUMN `paymentMethod`
  ENUM('CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'INSURANCE', 'WALLET', 'ONLINE', 'INSTAPAY', 'FAWRY')
  NOT NULL;

ALTER TABLE `PaymentGatewayConfig` MODIFY COLUMN `provider`
  ENUM('RAZORPAY', 'PHONEPE', 'PAYTM', 'FAWRY', 'PAYMOB', 'INSTAPAY')
  NOT NULL;

-- Credentials for the Egyptian gateway adapters.
ALTER TABLE `PaymentGatewayConfig` ADD COLUMN `fawryMerchantCode` VARCHAR(191) NULL;
ALTER TABLE `PaymentGatewayConfig` ADD COLUMN `fawrySecretKey` VARCHAR(191) NULL;
ALTER TABLE `PaymentGatewayConfig` ADD COLUMN `paymobApiKey` VARCHAR(191) NULL;
ALTER TABLE `PaymentGatewayConfig` ADD COLUMN `paymobIntegrationId` VARCHAR(191) NULL;
ALTER TABLE `PaymentGatewayConfig` ADD COLUMN `paymobIframeId` VARCHAR(191) NULL;
ALTER TABLE `PaymentGatewayConfig` ADD COLUMN `instapayHandle` VARCHAR(191) NULL;
