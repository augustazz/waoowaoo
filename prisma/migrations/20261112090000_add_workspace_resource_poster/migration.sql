ALTER TABLE `workspace_resource_versions`
  ADD COLUMN `posterMediaId` VARCHAR(191) NULL,
  ADD INDEX `workspace_resource_versions_poster_media_idx` (`posterMediaId`),
  ADD CONSTRAINT `workspace_resource_versions_posterMediaId_fkey`
    FOREIGN KEY (`posterMediaId`) REFERENCES `media_objects` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
