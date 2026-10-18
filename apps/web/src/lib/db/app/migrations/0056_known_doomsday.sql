CREATE TABLE `aoe_template` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`shape` text DEFAULT 'circle' NOT NULL,
	`position_x` real DEFAULT 0 NOT NULL,
	`position_y` real DEFAULT 0 NOT NULL,
	`angle` real DEFAULT 0 NOT NULL,
	`size` real DEFAULT 20 NOT NULL,
	`width` real DEFAULT 5 NOT NULL,
	`effect` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#ff6a00' NOT NULL,
	`opacity` real DEFAULT 0.6 NOT NULL,
	`visibility` integer DEFAULT 1 NOT NULL,
	`label` text,
	`anchor_marker_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scene`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "protected_aoe_template_size" CHECK("aoe_template"."size" > 0),
	CONSTRAINT "protected_aoe_template_width" CHECK("aoe_template"."width" > 0),
	CONSTRAINT "protected_aoe_template_opacity" CHECK("aoe_template"."opacity" >= 0 AND "aoe_template"."opacity" <= 1),
	CONSTRAINT "protected_aoe_template_visibility" CHECK("aoe_template"."visibility" >= 0 AND "aoe_template"."visibility" <= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_aoe_template_scene_id` ON `aoe_template` (`scene_id`);--> statement-breakpoint
ALTER TABLE `asset` ADD `stat_block` text;--> statement-breakpoint
ALTER TABLE `asset` ADD `initiative_bonus` integer;--> statement-breakpoint
ALTER TABLE `marker` ADD `conditions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `marker` ADD `stat_block` text;--> statement-breakpoint
ALTER TABLE `marker` ADD `hit_points` integer;--> statement-breakpoint
ALTER TABLE `marker` ADD `temp_hit_points` integer;--> statement-breakpoint
ALTER TABLE `marker` ADD `in_combat` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `marker` ADD `initiative` real;--> statement-breakpoint
ALTER TABLE `marker` ADD `initiative_bonus` integer;--> statement-breakpoint
ALTER TABLE `marker` ADD `initiative_tiebreak` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scene` ADD `combat_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scene` ADD `combat_active_marker_id` text;--> statement-breakpoint
ALTER TABLE `scene` ADD `combat_lair_step` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scene` ADD `combat_lair_actions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scene` ADD `combat_show_on_tv` integer DEFAULT true NOT NULL;