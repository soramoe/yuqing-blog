ALTER TABLE `point_transaction` ADD `operator_user_id` text REFERENCES user(id) ON DELETE set null;
