CREATE TABLE `task_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`task_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `speaker_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_comment_task_time_idx` ON `task_comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_comment_event_idx` ON `task_comments` (`event_id`);--> statement-breakpoint
ALTER TABLE `speaker_tasks` ADD `external_url` text;--> statement-breakpoint
ALTER TABLE `task_templates` ADD `external_url` text;