CREATE TABLE `playlist_songs` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`song_id` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
