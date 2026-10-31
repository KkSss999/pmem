CREATE TABLE `memory_l1_job_results` (
	`job_id` text NOT NULL,
	`memory_id` text NOT NULL,
	PRIMARY KEY(`job_id`, `memory_id`),
	FOREIGN KEY (`job_id`) REFERENCES `memory_l1_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_l1`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_l1_job_result_reverse` ON `memory_l1_job_results` (`memory_id`);--> statement-breakpoint
CREATE TABLE `memory_l1_maintenance_tasks` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_id` text NOT NULL,
	`space_id` text NOT NULL,
	`state` text NOT NULL,
	`claim_token` text,
	`failure_code` text,
	`outcome` text,
	`result_memory_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l1_maintenance_state_check" CHECK("memory_l1_maintenance_tasks"."state" IN ('pending', 'running', 'succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l1_maintenance_memory` ON `memory_l1_maintenance_tasks` (`memory_id`);--> statement-breakpoint
CREATE INDEX `memory_l1_maintenance_state` ON `memory_l1_maintenance_tasks` (`state`,`sequence`);
--> statement-breakpoint
INSERT INTO memory_l1_job_results (job_id, memory_id) SELECT job_id, id FROM memory_l1;
--> statement-breakpoint
INSERT INTO memory_l1_maintenance_tasks (memory_id, space_id, state, result_memory_id, created_at, updated_at)
SELECT id, space_id, CASE maintenance_status WHEN 'complete' THEN 'succeeded' WHEN 'failed' THEN 'failed' ELSE 'pending' END,
       id, created_at, created_at FROM memory_l1 ORDER BY created_at, id;
