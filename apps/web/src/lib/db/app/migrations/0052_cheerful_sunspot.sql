CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`artwork_location` text,
	`token_artwork_location` text,
	`shape` integer DEFAULT 1 NOT NULL,
	`shape_color` text DEFAULT '#ffffff' NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`image_scale` real DEFAULT 1 NOT NULL,
	`provider` text,
	`original_name` text,
	`source_identity` text,
	`source_url` text,
	`adapter_version` text,
	`import_request_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_shape" CHECK("asset"."shape" >= 0 AND "asset"."shape" <= 4),
	CONSTRAINT "asset_size" CHECK("asset"."size" >= 1 AND "asset"."size" <= 3)
);
--> statement-breakpoint
CREATE INDEX `idx_asset_owner` ON `asset` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_source` ON `asset` (`owner_id`,`provider`,`source_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_asset_import_request` ON `asset` (`owner_id`,`import_request_id`);--> statement-breakpoint
ALTER TABLE `marker` ADD `asset_id` text REFERENCES asset(id) ON DELETE SET NULL;