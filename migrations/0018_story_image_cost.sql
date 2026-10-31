UPDATE `image_setting`
SET `standard_points` = 20,
    `hd_points` = 32,
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `id` = 'global'
  AND `standard_points` = 24
  AND `hd_points` = 36;
