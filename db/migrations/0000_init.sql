CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`path` text NOT NULL,
	`source` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`model` text,
	`category` text,
	`description` text,
	`upc` text,
	`condition` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`location` text,
	`notes` text,
	`status` text DEFAULT 'owned' NOT NULL,
	`purchase_price` real,
	`purchase_date` text,
	`msrp` real,
	`estimated_value` real,
	`value_updated_at` text,
	`asking_price` real,
	`listed_at` text,
	`sold_price` real,
	`sold_date` text,
	`sold_platform` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
