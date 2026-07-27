CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`playback_mode` text NOT NULL,
	`source_format` text NOT NULL,
	`sync_quality` text NOT NULL,
	`audio_path` text NOT NULL,
	`lyrics_path` text,
	`video_path` text,
	`created_at` integer NOT NULL
);
