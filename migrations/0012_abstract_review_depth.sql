CREATE TABLE `ai_review_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`round_id` text NOT NULL,
	`score` integer NOT NULL,
	`rationale` text NOT NULL,
	`model_label` text DEFAULT 'Conference Ops bounded evaluator' NOT NULL,
	`overridden_score` integer,
	`override_reason` text,
	`overridden_by` text,
	`overridden_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `review_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`overridden_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_review_evaluation_unique` ON `ai_review_evaluations` (`proposal_id`,`round_id`);--> statement-breakpoint
CREATE INDEX `ai_review_event_idx` ON `ai_review_evaluations` (`event_id`);--> statement-breakpoint
CREATE TABLE `review_round_reviewers` (
	`round_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`assignment_cap` integer DEFAULT 25 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`round_id`, `reviewer_user_id`),
	FOREIGN KEY (`round_id`) REFERENCES `review_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_round_reviewer_user_idx` ON `review_round_reviewers` (`reviewer_user_id`);--> statement-breakpoint
ALTER TABLE `proposal_speakers` ADD `participant_role` text DEFAULT 'Presenter' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_assignments` ADD `recused_at` integer;--> statement-breakpoint
ALTER TABLE `review_assignments` ADD `recusal_reason` text;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `opens_at` integer;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `closes_at` integer;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `anonymized` integer DEFAULT false NOT NULL;