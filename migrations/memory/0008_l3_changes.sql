CREATE TABLE `memory_l3_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`l2_id` text NOT NULL,
	`kind` text NOT NULL,
	`l2_hash` text NOT NULL,
	`state` text NOT NULL,
	`job_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`l2_id`) REFERENCES `memory_l2`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l3_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l3_change_kind_check" CHECK("memory_l3_changes"."kind" IN ('created', 'updated', 'scope_changed', 'merged', 'removed')),
	CONSTRAINT "memory_l3_change_state_check" CHECK("memory_l3_changes"."state" IN ('pending', 'claimed', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `memory_l3_change_pending` ON `memory_l3_changes` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_l3_change_l2` ON `memory_l3_changes` (`l2_id`);--> statement-breakpoint
CREATE TABLE `memory_l3_job_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`result_index` integer NOT NULL,
	`state` text NOT NULL,
	`action` text NOT NULL,
	`keyword_id` text,
	`l2_ids_json` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l3_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`keyword_id`) REFERENCES `memory_l3_keywords`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l3_job_result_state_check" CHECK("memory_l3_job_results"."state" IN ('committed', 'failed', 'skipped')),
	CONSTRAINT "memory_l3_job_result_action_check" CHECK("memory_l3_job_results"."action" IN ('upsert'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l3_job_result_index` ON `memory_l3_job_results` (`job_id`,`result_index`);--> statement-breakpoint
CREATE INDEX `memory_l3_job_result_keyword` ON `memory_l3_job_results` (`keyword_id`);--> statement-breakpoint
CREATE TABLE `memory_l3_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`run_id` text,
	`prompt_version` text,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	CONSTRAINT "memory_l3_job_state_check" CHECK("memory_l3_jobs"."state" IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `memory_l3_job_state` ON `memory_l3_jobs` (`state`);