CREATE TABLE `admin_sessions` (
	`id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_hash_key` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('OWNER') NOT NULL DEFAULT 'OWNER',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_key` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(140) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_name_key` UNIQUE(`name`),
	CONSTRAINT `categories_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` varchar(36) NOT NULL,
	`category_id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(140) NOT NULL,
	`description` text,
	`price` decimal(10,2) NOT NULL,
	`image_path` varchar(255),
	`is_available` boolean NOT NULL DEFAULT true,
	`is_archived` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`sender_type` enum('CUSTOMER','OWNER') NOT NULL,
	`sender_name` varchar(120) NOT NULL,
	`message` text NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`product_id` varchar(36),
	`product_name` varchar(160) NOT NULL,
	`quantity` int NOT NULL,
	`unit_price` decimal(10,2) NOT NULL,
	`line_total` decimal(10,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_status_histories` (
	`id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`old_status` enum('PENDING','IN_KITCHEN','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','PICKED_UP','CANCELLED'),
	`new_status` enum('PENDING','IN_KITCHEN','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','PICKED_UP','CANCELLED') NOT NULL,
	`changed_by_user_id` varchar(36),
	`note` varchar(500),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `order_status_histories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` varchar(36) NOT NULL,
	`order_number` varchar(20) NOT NULL,
	`customer_name` varchar(100) NOT NULL,
	`customer_phone` varchar(24) NOT NULL,
	`fulfillment_type` enum('DELIVERY','PICKUP') NOT NULL,
	`block` varchar(80),
	`lot` varchar(80),
	`street` varchar(160),
	`delivery_instructions` varchar(500),
	`status` enum('PENDING','IN_KITCHEN','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','PICKED_UP','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`payment_method` enum('COD','QR') NOT NULL,
	`subtotal` decimal(10,2) NOT NULL,
	`delivery_fee` decimal(10,2) NOT NULL DEFAULT '0',
	`total` decimal(10,2) NOT NULL,
	`tracking_token_hash` varchar(64) NOT NULL,
	`idempotency_key_hash` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_order_number_key` UNIQUE(`order_number`),
	CONSTRAINT `orders_tracking_token_hash_key` UNIQUE(`tracking_token_hash`),
	CONSTRAINT `orders_idempotency_key_hash_key` UNIQUE(`idempotency_key_hash`)
);
--> statement-breakpoint
CREATE TABLE `payment_status_histories` (
	`id` varchar(36) NOT NULL,
	`payment_id` varchar(36) NOT NULL,
	`old_status` enum('UNPAID','AWAITING_VERIFICATION','PAID','REJECTED','REFUNDED'),
	`new_status` enum('UNPAID','AWAITING_VERIFICATION','PAID','REJECTED','REFUNDED') NOT NULL,
	`actor_type` enum('CUSTOMER','OWNER','SYSTEM') NOT NULL,
	`changed_by_user_id` varchar(36),
	`note` varchar(500),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_status_histories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`method` enum('COD','QR') NOT NULL,
	`status` enum('UNPAID','AWAITING_VERIFICATION','PAID','REJECTED','REFUNDED') NOT NULL DEFAULT 'UNPAID',
	`amount` decimal(10,2) NOT NULL,
	`reference_number` varchar(100),
	`proof_image_path` varchar(255),
	`provider_reference` varchar(255),
	`verified_at` timestamp(3),
	`verified_by` varchar(36),
	`rejection_reason` varchar(500),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_order_id_key` UNIQUE(`order_id`)
);
--> statement-breakpoint
CREATE TABLE `store_settings` (
	`key` varchar(100) NOT NULL,
	`value` json NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `store_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_status_histories` ADD CONSTRAINT `order_status_histories_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_status_histories` ADD CONSTRAINT `order_status_histories_changed_by_user_id_users_id_fk` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payment_status_histories` ADD CONSTRAINT `payment_status_histories_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payment_status_histories` ADD CONSTRAINT `payment_status_histories_changed_by_user_id_users_id_fk` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `admin_sessions_user_id_expires_at_idx` ON `admin_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `products_category_id_is_available_is_archived_idx` ON `products` (`category_id`,`is_available`,`is_archived`);--> statement-breakpoint
CREATE INDEX `messages_order_id_created_at_idx` ON `messages` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_id_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `order_status_histories_order_id_created_at_idx` ON `order_status_histories` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_created_at_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_fulfillment_type_created_at_idx` ON `orders` (`fulfillment_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_status_histories_payment_id_created_at_idx` ON `payment_status_histories` (`payment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_status_created_at_idx` ON `payments` (`status`,`created_at`);