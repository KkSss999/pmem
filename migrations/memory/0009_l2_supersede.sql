ALTER TABLE `memory_l2` ADD `superseded_by` text REFERENCES `memory_l2`(`id`);--> statement-breakpoint
CREATE INDEX `memory_l2_superseded_by` ON `memory_l2` (`superseded_by`);
