CREATE TABLE `pmem_migrations` (
	`id` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`applied_at` text NOT NULL
);
