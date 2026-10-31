-- Custom SQL migration file, put your code below! --
CREATE VIRTUAL TABLE memory_l1_search USING fts5(memory_id UNINDEXED, content, abstraction, cues, tokenize='trigram');
--> statement-breakpoint
INSERT INTO memory_l1_search(memory_id, content, abstraction, cues)
SELECT m.id, m.content, m.abstraction,
       COALESCE((SELECT group_concat(c.cue, ' ') FROM memory_l1_cues c WHERE c.memory_id = m.id), '')
FROM memory_l1 m;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_insert AFTER INSERT ON memory_l1 BEGIN
  INSERT INTO memory_l1_search(memory_id, content, abstraction, cues)
  VALUES (NEW.id, NEW.content, NEW.abstraction, '');
END;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_update AFTER UPDATE OF content, abstraction ON memory_l1 BEGIN
  UPDATE memory_l1_search SET content = NEW.content, abstraction = NEW.abstraction WHERE memory_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_delete AFTER DELETE ON memory_l1 BEGIN
  DELETE FROM memory_l1_search WHERE memory_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_cue_insert AFTER INSERT ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = NEW.memory_id), '') WHERE memory_id = NEW.memory_id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_cue_delete AFTER DELETE ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = OLD.memory_id), '') WHERE memory_id = OLD.memory_id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_l1_search_cue_update AFTER UPDATE ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = OLD.memory_id), '') WHERE memory_id = OLD.memory_id;
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = NEW.memory_id), '') WHERE memory_id = NEW.memory_id;
END;
