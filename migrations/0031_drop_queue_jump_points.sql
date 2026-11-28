-- 「付费插队」是 Colab 排队专属功能，随 Colab 退出生图一并移除。
-- 注意顺序：必须先部署不含该列的代码，再执行本迁移（旧代码的 SELECT/INSERT 仍引用此列）。
ALTER TABLE `image_setting` DROP COLUMN `queue_jump_points`;
