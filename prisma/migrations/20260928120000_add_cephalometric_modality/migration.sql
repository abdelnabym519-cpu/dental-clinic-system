-- Phase 19B (D14) — additive: one new value on the existing native MySQL
-- enum column ImagingStudy.modality.
--
-- No table, column or index is created, altered or dropped beyond the enum
-- value list itself; existing rows keep their value untouched.
--
--   CEPHALOMETRIC — lateral cephalograms, the input modality of the
--                   Orthodontic AI engine (CLDetection2023, port 8005).

ALTER TABLE `ImagingStudy` MODIFY COLUMN `modality` ENUM('PANORAMIC', 'PERIAPICAL', 'BITEWING', 'CBCT', 'THREE_D_SCAN', 'PHOTO', 'CEPHALOMETRIC') NOT NULL;
