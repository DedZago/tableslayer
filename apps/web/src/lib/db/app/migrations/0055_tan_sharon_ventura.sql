CREATE TABLE `clipboard_artwork` (
	`location` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `clipboard_artwork` (`location`, `created_at`)
SELECT `location`, unixepoch() FROM `files`;
