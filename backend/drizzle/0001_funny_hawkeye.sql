CREATE TABLE `acp_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`acp_session_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_acp_sessions_session` ON `acp_sessions` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_acp_sessions_session_name` ON `acp_sessions` (`session_id`,`name`);