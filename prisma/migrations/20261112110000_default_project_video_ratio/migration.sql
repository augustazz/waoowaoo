-- Match API creation and legacy read semantics. Existing explicit ratios stay intact.
ALTER TABLE `projects` ALTER COLUMN `videoRatio` SET DEFAULT '16:9';
UPDATE `projects` SET `videoRatio` = '16:9' WHERE `videoRatio` IS NULL;
