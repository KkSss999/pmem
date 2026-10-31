CREATE TABLE `memory_l3_keyword_l2_links` (
	`keyword_id` text NOT NULL,
	`l2_id` text NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `memory_l3_keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`l2_id`) REFERENCES `memory_l2`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l3_keyword_l2_unique` ON `memory_l3_keyword_l2_links` (`keyword_id`,`l2_id`);--> statement-breakpoint
CREATE INDEX `memory_l3_keyword_l2_reverse` ON `memory_l3_keyword_l2_links` (`l2_id`,`keyword_id`);--> statement-breakpoint
CREATE TABLE `memory_l3_keyword_spaces` (
	`keyword_id` text NOT NULL,
	`space_id` text NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `memory_l3_keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `memory_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l3_keyword_space_unique` ON `memory_l3_keyword_spaces` (`keyword_id`,`space_id`);--> statement-breakpoint
CREATE INDEX `memory_l3_keyword_space_reverse` ON `memory_l3_keyword_spaces` (`space_id`,`keyword_id`);--> statement-breakpoint
CREATE TABLE `memory_l3_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`normalized_term` text NOT NULL,
	`aliases_json` text NOT NULL,
	`kind` text NOT NULL,
	`scope_key` text NOT NULL,
	`base_weight` integer NOT NULL,
	`weight` integer NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_hit_at` text,
	`needs_refresh` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_l3_keyword_kind_check" CHECK("memory_l3_keywords"."kind" IN ('topic', 'entity', 'preference', 'tool', 'concept', 'other')),
	CONSTRAINT "memory_l3_keyword_weight_check" CHECK("memory_l3_keywords"."base_weight" BETWEEN 1 AND 5 AND "memory_l3_keywords"."weight" BETWEEN 1 AND 50),
	CONSTRAINT "memory_l3_keyword_flags_check" CHECK("memory_l3_keywords"."hit_count" >= 0 AND "memory_l3_keywords"."needs_refresh" IN (0, 1)),
	CONSTRAINT "memory_l3_keyword_state_check" CHECK("memory_l3_keywords"."state" IN ('active', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_l3_keyword_scope_term` ON `memory_l3_keywords` (`scope_key`,`normalized_term`);--> statement-breakpoint
CREATE INDEX `memory_l3_keyword_term` ON `memory_l3_keywords` (`normalized_term`);--> statement-breakpoint
CREATE INDEX `memory_l3_keyword_scope_weight` ON `memory_l3_keywords` (`scope_key`,`weight`);--> statement-breakpoint
CREATE INDEX `memory_l3_keyword_expiry` ON `memory_l3_keywords` (`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `memory_l3_keyword_refresh` ON `memory_l3_keywords` (`needs_refresh`);


--> statement-breakpoint
CREATE VIRTUAL TABLE memory_l3_fts USING fts5(keyword_id UNINDEXED, term, aliases, tokenize='trigram');--> statement-breakpoint
INSERT INTO memory_l3_fts(keyword_id, term, aliases)
SELECT id, term, aliases_json FROM memory_l3_keywords;--> statement-breakpoint
CREATE TRIGGER memory_l3_fts_insert AFTER INSERT ON memory_l3_keywords BEGIN
  INSERT INTO memory_l3_fts(keyword_id, term, aliases)
  VALUES (NEW.id, NEW.term, NEW.aliases_json);
END;--> statement-breakpoint
CREATE TRIGGER memory_l3_fts_update AFTER UPDATE OF term, aliases_json ON memory_l3_keywords BEGIN
  UPDATE memory_l3_fts SET term = NEW.term, aliases = NEW.aliases_json WHERE keyword_id = NEW.id;
END;--> statement-breakpoint
CREATE TRIGGER memory_l3_fts_delete AFTER DELETE ON memory_l3_keywords BEGIN
  DELETE FROM memory_l3_fts WHERE keyword_id = OLD.id;
END;
