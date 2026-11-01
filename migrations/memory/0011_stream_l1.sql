CREATE TABLE `memory_l1_stream_new` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `space_id` text NOT NULL,
  `content` text NOT NULL,
  `abstraction` text NOT NULL,
  `maintenance_status` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "memory_l1_maintenance_check" CHECK("memory_l1_stream_new"."maintenance_status" IN ('pending', 'complete', 'failed'))
);
--> statement-breakpoint
INSERT INTO `memory_l1_stream_new` (`id`, `job_id`, `space_id`, `content`, `abstraction`, `maintenance_status`, `created_at`)
SELECT `id`, `job_id`, `space_id`, `content`, `abstraction`, `maintenance_status`, `created_at` FROM `memory_l1`;
--> statement-breakpoint
DROP TABLE `memory_l1`;
--> statement-breakpoint
ALTER TABLE `memory_l1_stream_new` RENAME TO `memory_l1`;
--> statement-breakpoint
CREATE INDEX `memory_l1_space` ON `memory_l1` (`space_id`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS memory_l1_search_insert;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_insert AFTER INSERT ON memory_l1 BEGIN
  INSERT INTO memory_l1_search(memory_id, content, abstraction, cues)
  VALUES (NEW.id, NEW.content, NEW.abstraction, '');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS memory_l1_search_update;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_update AFTER UPDATE OF content, abstraction ON memory_l1 BEGIN
  UPDATE memory_l1_search SET content = NEW.content, abstraction = NEW.abstraction WHERE memory_id = NEW.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS memory_l1_search_delete;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_delete AFTER DELETE ON memory_l1 BEGIN
  DELETE FROM memory_l1_search WHERE memory_id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS memory_l1_search_cue_insert;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_cue_insert AFTER INSERT ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = NEW.memory_id), '') WHERE memory_id = NEW.memory_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS memory_l1_search_cue_delete;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_cue_delete AFTER DELETE ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = OLD.memory_id), '') WHERE memory_id = OLD.memory_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS memory_l1_search_cue_update;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_cue_update AFTER UPDATE ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = OLD.memory_id), '') WHERE memory_id = OLD.memory_id;
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = NEW.memory_id), '') WHERE memory_id = NEW.memory_id;
END;
