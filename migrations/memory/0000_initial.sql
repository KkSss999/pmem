CREATE TABLE `memory_l0_messages` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`space_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`source` text,
	`source_event_id` text,
	`session_id` text,
	`occurred_at` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l0_role_check" CHECK("memory_l0_messages"."role" IN ('user', 'assistant')),
	CONSTRAINT "memory_l0_source_check" CHECK("memory_l0_messages"."source_event_id" IS NULL OR "memory_l0_messages"."source" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l0_id` ON `memory_l0_messages` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l0_source_event` ON `memory_l0_messages` (`space_id`,`source`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `memory_l0_space_sequence` ON `memory_l0_messages` (`space_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `memory_l0_session_sequence` ON `memory_l0_messages` (`space_id`,`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `memory_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "memory_space_kind_check" CHECK("memory_spaces"."kind" IN ('personal', 'custom'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_one_personal_space` ON `memory_spaces` (`kind`) WHERE "memory_spaces"."kind" = 'personal';--> statement-breakpoint
INSERT INTO memory_spaces (id, name, kind, created_at)
VALUES ('personal', 'Personal', 'personal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
