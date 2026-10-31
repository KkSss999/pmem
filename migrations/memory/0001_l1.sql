CREATE TABLE `memory_l1_cues` (
	`memory_id` text NOT NULL,
	`cue` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_l1`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l1_cue_unique` ON `memory_l1_cues` (`memory_id`,`cue`);--> statement-breakpoint
CREATE TABLE `memory_l1_job_sources` (
	`job_id` text NOT NULL,
	`l0_id` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l1_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`l0_id`) REFERENCES `memory_l0_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l1_job_source_unique` ON `memory_l1_job_sources` (`job_id`,`l0_id`);--> statement-breakpoint
CREATE TABLE `memory_l1_job_spaces` (
	`job_id` text NOT NULL,
	`space_id` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l1_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l1_job_space_unique` ON `memory_l1_job_spaces` (`job_id`,`space_id`);--> statement-breakpoint
CREATE TABLE `memory_l1_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`failure_code` text,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l1_job_state_check" CHECK("memory_l1_jobs"."state" IN ('pending', 'running', 'succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `memory_l1_job_state` ON `memory_l1_jobs` (`space_id`,`state`);--> statement-breakpoint
CREATE TABLE `memory_l1` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`space_id` text NOT NULL,
	`content` text NOT NULL,
	`abstraction` text NOT NULL,
	`maintenance_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `memory_l1_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_l1_maintenance_check" CHECK("memory_l1"."maintenance_status" IN ('pending', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `memory_l1_space` ON `memory_l1` (`space_id`);--> statement-breakpoint
CREATE TABLE `memory_l1_sources` (
	`memory_id` text NOT NULL,
	`l0_id` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_l1`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`l0_id`) REFERENCES `memory_l0_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l1_source_unique` ON `memory_l1_sources` (`memory_id`,`l0_id`);--> statement-breakpoint
CREATE INDEX `memory_l1_source_reverse` ON `memory_l1_sources` (`l0_id`,`memory_id`);--> statement-breakpoint
CREATE TABLE `memory_l1_space_links` (
	`memory_id` text NOT NULL,
	`space_id` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_l1`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l1_space_link_unique` ON `memory_l1_space_links` (`memory_id`,`space_id`);--> statement-breakpoint
CREATE INDEX `memory_l1_space_link_reverse` ON `memory_l1_space_links` (`space_id`,`memory_id`);