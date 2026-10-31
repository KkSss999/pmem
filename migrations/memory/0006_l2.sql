CREATE TABLE `memory_l2_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`l1_id` text NOT NULL,
	`owner_space_id` text NOT NULL,
	`kind` text NOT NULL,
	`l1_hash` text NOT NULL,
	`survivor_l1_id` text,
	`state` text NOT NULL,
	`job_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`owner_space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l2_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l2_change_kind_check" CHECK("memory_l2_changes"."kind" IN ('created', 'content_changed', 'scope_changed', 'merged', 'removed')),
	CONSTRAINT "memory_l2_change_state_check" CHECK("memory_l2_changes"."state" IN ('pending', 'claimed', 'processed', 'uncovered', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `memory_l2_change_pending` ON `memory_l2_changes` (`owner_space_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_l2_change_l1` ON `memory_l2_changes` (`l1_id`);--> statement-breakpoint
CREATE TABLE `memory_l2_job_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`result_index` integer NOT NULL,
	`state` text NOT NULL,
	`action` text NOT NULL,
	`l2_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l2_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`l2_id`) REFERENCES `memory_l2`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l2_job_result_state_check" CHECK("memory_l2_job_results"."state" IN ('committed', 'failed', 'skipped')),
	CONSTRAINT "memory_l2_job_result_action_check" CHECK("memory_l2_job_results"."action" IN ('create', 'update'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l2_job_result_index` ON `memory_l2_job_results` (`job_id`,`result_index`);--> statement-breakpoint
CREATE INDEX `memory_l2_job_result_l2` ON `memory_l2_job_results` (`l2_id`);--> statement-breakpoint
CREATE TABLE `memory_l2_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_space_id` text NOT NULL,
	`state` text NOT NULL,
	`claim_token` text,
	`prompt_version` text,
	`failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l2_job_state_check" CHECK("memory_l2_jobs"."state" IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `memory_l2_job_state` ON `memory_l2_jobs` (`owner_space_id`,`state`);--> statement-breakpoint
CREATE TABLE `memory_l2_l0_sources` (
	`l2_id` text NOT NULL,
	`l0_id` text NOT NULL,
	`generation_id` text NOT NULL,
	PRIMARY KEY(`l2_id`, `l0_id`, `generation_id`),
	FOREIGN KEY (`l2_id`) REFERENCES `memory_l2`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`l0_id`) REFERENCES `memory_l0_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_l2_l0_source_reverse` ON `memory_l2_l0_sources` (`l0_id`);--> statement-breakpoint
CREATE TABLE `memory_l2_l1_links` (
	`l2_id` text NOT NULL,
	`l1_id` text NOT NULL,
	FOREIGN KEY (`l2_id`) REFERENCES `memory_l2`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l2_l1_link_unique` ON `memory_l2_l1_links` (`l2_id`,`l1_id`);--> statement-breakpoint
CREATE INDEX `memory_l2_l1_link_reverse` ON `memory_l2_l1_links` (`l1_id`,`l2_id`);--> statement-breakpoint
CREATE TABLE `memory_l2` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_space_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`content_hash` text NOT NULL,
	`needs_update` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL,
	`generation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l2_flags_check" CHECK("memory_l2"."needs_update" IN (0, 1) AND "memory_l2"."visible" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `memory_l2_owner_updated` ON `memory_l2` (`owner_space_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `memory_l2_needs_update` ON `memory_l2` (`needs_update`);--> statement-breakpoint
CREATE INDEX `memory_l2_visible` ON `memory_l2` (`visible`);--> statement-breakpoint
CREATE TABLE `memory_l2_space_links` (
	`l2_id` text NOT NULL,
	`space_id` text NOT NULL,
	FOREIGN KEY (`l2_id`) REFERENCES `memory_l2`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l2_space_link_unique` ON `memory_l2_space_links` (`l2_id`,`space_id`);--> statement-breakpoint
CREATE INDEX `memory_l2_space_link_reverse` ON `memory_l2_space_links` (`space_id`,`l2_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE memory_l2_search USING fts5(l2_id UNINDEXED, title, summary, body, tokenize='trigram');
--> statement-breakpoint
INSERT INTO memory_l2_search(l2_id, title, summary, body)
SELECT id, title, summary, body FROM memory_l2;
--> statement-breakpoint
CREATE TRIGGER memory_l2_search_insert AFTER INSERT ON memory_l2 BEGIN
  INSERT INTO memory_l2_search(l2_id, title, summary, body)
  VALUES (NEW.id, NEW.title, NEW.summary, NEW.body);
END;
--> statement-breakpoint
CREATE TRIGGER memory_l2_search_update AFTER UPDATE OF title, summary, body ON memory_l2 BEGIN
  UPDATE memory_l2_search SET title = NEW.title, summary = NEW.summary, body = NEW.body WHERE l2_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_l2_search_delete AFTER DELETE ON memory_l2 BEGIN
  DELETE FROM memory_l2_search WHERE l2_id = OLD.id;
END;
