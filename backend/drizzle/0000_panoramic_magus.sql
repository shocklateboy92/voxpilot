CREATE TABLE `artifact_files` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`path` text NOT NULL,
	`change_type` text NOT NULL,
	`old_path` text,
	`additions` integer NOT NULL,
	`deletions` integer NOT NULL,
	`viewed` integer DEFAULT false NOT NULL,
	`html` text NOT NULL,
	`hunks_json` text,
	`full_text_available` integer DEFAULT false NOT NULL,
	`full_text_line_count` integer,
	`full_text_content` text,
	`full_text_html` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `review_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_artifact_files_artifact` ON `artifact_files` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_call_id` text,
	`artifact_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_messages_session` ON `messages` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `review_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`commit_ref` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_files` integer NOT NULL,
	`total_additions` integer NOT NULL,
	`total_deletions` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`file_id` text NOT NULL,
	`line_id` text,
	`line_number` integer,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `review_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `artifact_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_review_comments_artifact` ON `review_comments` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
