PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`artwork_location` text,
	`token_artwork_location` text,
	`shape` integer DEFAULT 1 NOT NULL,
	`shape_color` text DEFAULT '#ffffff' NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`image_scale` real DEFAULT 1 NOT NULL,
	`role` text,
	`crop_x` real DEFAULT 0.5 NOT NULL,
	`crop_y` real DEFAULT 0.5 NOT NULL,
	`crop_zoom` real DEFAULT 1 NOT NULL,
	`provider` text,
	`original_name` text,
	`source_identity` text,
	`source_url` text,
	`adapter_version` text,
	`import_request_id` text,
	`stat_block` text,
	`initiative_bonus` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_shape" CHECK("__new_asset"."shape" >= 0 AND "__new_asset"."shape" <= 4),
	CONSTRAINT "asset_size" CHECK("__new_asset"."size" >= 1 AND "__new_asset"."size" <= 3),
	CONSTRAINT "asset_role" CHECK("__new_asset"."role" IS NULL OR "__new_asset"."role" IN ('hero', 'npc', 'monster')),
	CONSTRAINT "asset_crop_zoom" CHECK("__new_asset"."crop_zoom" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_asset`("id", "owner_id", "name", "artwork_location", "token_artwork_location", "shape", "shape_color", "size", "image_scale", "provider", "original_name", "source_identity", "source_url", "adapter_version", "import_request_id", "stat_block", "initiative_bonus", "created_at", "updated_at") SELECT "id", "owner_id", "name", "artwork_location", "token_artwork_location", "shape", "shape_color", "size", "image_scale", "provider", "original_name", "source_identity", "source_url", "adapter_version", "import_request_id", "stat_block", "initiative_bonus", "created_at", "updated_at" FROM `asset`;--> statement-breakpoint
DROP TABLE `asset`;--> statement-breakpoint
ALTER TABLE `__new_asset` RENAME TO `asset`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_asset_owner` ON `asset` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_source` ON `asset` (`owner_id`,`provider`,`source_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_asset_import_request` ON `asset` (`owner_id`,`import_request_id`);