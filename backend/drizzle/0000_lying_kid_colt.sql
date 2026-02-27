CREATE TABLE `diff_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`from_ref` text NOT NULL,
	`to_ref` text NOT NULL,
	`resolved_from` text NOT NULL,
	`resolved_to` text NOT NULL,
	`repo_root` text NOT NULL,
	`path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diff_entry_files` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`file_path` text NOT NULL,
	`additions` integer NOT NULL,
	`deletions` integer NOT NULL,
	`before_content` text NOT NULL,
	`after_content` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `diff_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_diff_entry_files_entry_id` ON `diff_entry_files` (`entry_id`);