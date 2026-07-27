PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`playback_mode` text NOT NULL,
	`source_format` text NOT NULL,
	`sync_quality` text NOT NULL,
	`audio_path` text,
	`lyrics_path` text,
	`video_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_songs`("id", "title", "artist", "playback_mode", "source_format", "sync_quality", "audio_path", "lyrics_path", "video_path", "created_at") SELECT "id", "title", "artist", "playback_mode", "source_format", "sync_quality", "audio_path", "lyrics_path", "video_path", "created_at" FROM `songs`;--> statement-breakpoint
DROP TABLE `songs`;--> statement-breakpoint
ALTER TABLE `__new_songs` RENAME TO `songs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;