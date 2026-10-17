CREATE TABLE `asset_import_receipt` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
