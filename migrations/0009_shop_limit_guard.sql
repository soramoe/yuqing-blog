-- Custom SQL migration file, put your code below! --
CREATE TRIGGER `shop_order_per_user_limit`
BEFORE INSERT ON `shop_order`
FOR EACH ROW
WHEN (
  SELECT COUNT(*) FROM `shop_order`
  WHERE `user_id` = NEW.`user_id`
    AND `item_id` = NEW.`item_id`
    AND `status` IN ('pending', 'fulfilled')
) >= (
  SELECT `per_user_limit` FROM `shop_item` WHERE `id` = NEW.`item_id`
)
BEGIN
  SELECT RAISE(ABORT, 'shop_item_user_limit');
END;
