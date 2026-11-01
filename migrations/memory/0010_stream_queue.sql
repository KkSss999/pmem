CREATE TABLE `memory_stream_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `scope_id` text NOT NULL,
  `kind` text NOT NULL,
  `subject_id` text NOT NULL,
  `source_hash` text NOT NULL,
  `state` text NOT NULL,
  `attempt` integer NOT NULL DEFAULT 0,
  `error_code` text,
  `created_at` text NOT NULL,
  `started_at` text,
  `finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_stream_queue_item` ON `memory_stream_queue` (`workspace_id`,`scope_id`,`kind`,`subject_id`,`source_hash`);
--> statement-breakpoint
CREATE INDEX `memory_stream_queue_state` ON `memory_stream_queue` (`workspace_id`,`scope_id`,`state`,`created_at`);
CREATE TABLE `memory_stream_sessions` (
  `workspace_id` text NOT NULL,
  `scope_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `session_id` text NOT NULL,
  `context_tokens` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`workspace_id`, `scope_id`)
);
