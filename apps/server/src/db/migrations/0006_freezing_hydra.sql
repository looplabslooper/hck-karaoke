CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `singers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`photo_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `queue_items` DROP COLUMN `singer`;