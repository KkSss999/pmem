CREATE TABLE `memory_l1_auto_groups` (
	`space_id` text NOT NULL,
	`source` text NOT NULL,
	`session_id` text NOT NULL,
	`last_activity` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`active_job_id` text,
	PRIMARY KEY(`space_id`, `source`, `session_id`),
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`active_job_id`) REFERENCES `memory_l1_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_l0_auto_group` ON `memory_l0_messages` (`space_id`,`source`,`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `memory_l1_job_source_reverse` ON `memory_l1_job_sources` (`l0_id`);
--> statement-breakpoint
INSERT INTO memory_l1_auto_groups (space_id, source, session_id, last_activity)
SELECT space_id, source, session_id, max(recorded_at)
FROM memory_l0_messages WHERE source IS NOT NULL AND session_id IS NOT NULL
GROUP BY space_id, source, session_id;
--> statement-breakpoint
CREATE TRIGGER memory_l1_auto_group_insert AFTER INSERT ON memory_l0_messages
WHEN NEW.source IS NOT NULL AND NEW.session_id IS NOT NULL BEGIN
  INSERT INTO memory_l1_auto_groups (space_id, source, session_id, last_activity)
  VALUES (NEW.space_id, NEW.source, NEW.session_id, NEW.recorded_at)
  ON CONFLICT (space_id, source, session_id) DO UPDATE SET last_activity = excluded.last_activity;
END;
