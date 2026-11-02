ALTER TABLE `aoe_template` ADD `spell_id` text;--> statement-breakpoint
ALTER TABLE `aoe_template` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `game_session` ADD `ruleset` text DEFAULT 'dnd5e-2024' NOT NULL;--> statement-breakpoint
ALTER TABLE `marker` ADD `concentration` text;