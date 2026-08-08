CREATE TABLE `event_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_invitations_token_hash_unique` ON `event_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `event_invitation_email_idx` ON `event_invitations` (`email`,`expires_at`);--> statement-breakpoint
CREATE TABLE `reviewer_group_members` (
	`reviewer_group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`reviewer_group_id`, `user_id`),
	FOREIGN KEY (`reviewer_group_id`) REFERENCES `reviewer_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviewer_group_user_idx` ON `reviewer_group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `task_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`respondent_user_id` text NOT NULL,
	`responses` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `speaker_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`respondent_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_response_unique` ON `task_responses` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_response_user_idx` ON `task_responses` (`respondent_user_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `logo_upload_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `background_upload_id` text;--> statement-breakpoint
ALTER TABLE `program_sessions` ADD `origin` text DEFAULT 'proposal' NOT NULL;--> statement-breakpoint
ALTER TABLE `program_sessions` ADD `format` text DEFAULT 'talk' NOT NULL;--> statement-breakpoint
ALTER TABLE `program_sessions` ADD `capacity` integer;--> statement-breakpoint
ALTER TABLE `program_sessions` ADD `ceu_credits` text;--> statement-breakpoint
ALTER TABLE `program_sessions` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `session_proposal_unique` ON `program_sessions` (`proposal_id`);--> statement-breakpoint
ALTER TABLE `speaker_tasks` ADD `artifact_upload_id` text REFERENCES uploads(id);