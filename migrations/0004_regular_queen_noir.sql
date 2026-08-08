ALTER TABLE `speaker_tasks` ADD `proposal_id` text REFERENCES proposals(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `task_contact_template_speaker_idx` ON `speaker_tasks` (`template_id`,`speaker_profile_id`) WHERE "speaker_tasks"."proposal_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `task_submission_template_speaker_proposal_unique` ON `speaker_tasks` (`template_id`,`speaker_profile_id`,`proposal_id`) WHERE "speaker_tasks"."proposal_id" IS NOT NULL;
