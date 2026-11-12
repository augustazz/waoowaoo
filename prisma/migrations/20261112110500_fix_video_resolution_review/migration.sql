-- Missing catalog evidence is not a media mismatch. Keep genuine issues and
-- content acceptance untouched when repairing pre-fix verification records.
UPDATE `workspace_resources`
SET `generationOptions` = JSON_SET(
  `generationOptions`,
  '$.videoOutputVerification.status',
  IF(JSON_LENGTH(JSON_EXTRACT(`generationOptions`, '$.videoOutputVerification.issues')) = 1, 'passed', 'needs_review'),
  '$.videoOutputVerification.issues',
  JSON_REMOVE(
    JSON_EXTRACT(`generationOptions`, '$.videoOutputVerification.issues'),
    JSON_UNQUOTE(JSON_SEARCH(JSON_EXTRACT(`generationOptions`, '$.videoOutputVerification.issues'), 'one', 'resolution$_not$_declared', '$'))
  )
)
WHERE `mediaType` = 'video'
  AND JSON_EXTRACT(`generationOptions`, '$.videoOutputVerification.schemaVersion') = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(`generationOptions`, '$.videoOutputVerification.status')) = 'needs_review'
  AND JSON_CONTAINS(JSON_EXTRACT(`generationOptions`, '$.videoOutputVerification.issues'), '"resolution_not_declared"');
