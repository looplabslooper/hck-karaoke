CREATE TABLE `queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`singer` text NOT NULL,
	`status` text NOT NULL,
	`score` integer,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL
);
