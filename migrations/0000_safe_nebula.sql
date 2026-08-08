CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_event_time_idx` ON `audit_logs` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_unique` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `embeds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `embed_event_name_unique` ON `embeds` (`event_id`,`name`);--> statement-breakpoint
CREATE TABLE `event_memberships` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`, `role`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_membership_user_idx` ON `event_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`timezone` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`cfp_closes_at` integer,
	`venue` text DEFAULT '' NOT NULL,
	`website_url` text,
	`accent` text DEFAULT '#e05b3f' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`public_agenda_revision` integer DEFAULT 0 NOT NULL,
	`allowed_embed_origins` text DEFAULT '[]' NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_org_slug_unique` ON `events` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `event_org_idx` ON `events` (`organization_id`);--> statement-breakpoint
CREATE TABLE `file_request_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`file_request_id` text NOT NULL,
	`target_id` text NOT NULL,
	`uploader_user_id` text NOT NULL,
	`upload_ids` text DEFAULT '[]' NOT NULL,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_request_id`) REFERENCES `file_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_request_target_unique` ON `file_request_responses` (`file_request_id`,`target_id`);--> statement-breakpoint
CREATE INDEX `file_request_uploader_idx` ON `file_request_responses` (`uploader_user_id`);--> statement-breakpoint
CREATE TABLE `file_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions_html` text DEFAULT '' NOT NULL,
	`target_type` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_request_event_type_idx` ON `file_requests` (`event_id`,`target_type`);--> statement-breakpoint
CREATE TABLE `form_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`version` integer NOT NULL,
	`welcome_title` text NOT NULL,
	`welcome_copy` text NOT NULL,
	`confirmation_copy` text NOT NULL,
	`max_speakers` integer DEFAULT 1 NOT NULL,
	`allow_multiple_drafts` integer DEFAULT true NOT NULL,
	`fields` text NOT NULL,
	`published_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `submission_forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_version_unique` ON `form_versions` (`form_id`,`version`);--> statement-breakpoint
CREATE TABLE `integration_sync_records` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`provider` text NOT NULL,
	`entity_type` text NOT NULL,
	`local_id` text NOT NULL,
	`remote_id` text,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_entity_unique` ON `integration_sync_records` (`provider`,`event_id`,`entity_type`,`local_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_member_user_idx` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_idempotency_unique` ON `outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbox_due_idx` ON `outbox` (`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `program_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`proposal_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`track_id` text,
	`room_id` text,
	`starts_at` integer,
	`ends_at` integer,
	`status` text DEFAULT 'unscheduled' NOT NULL,
	`override_reason` text,
	`calendar_uid` text NOT NULL,
	`calendar_sequence` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_event_time_idx` ON `program_sessions` (`event_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `session_room_time_idx` ON `program_sessions` (`room_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `session_track_time_idx` ON `program_sessions` (`track_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `proposal_speakers` (
	`proposal_id` text NOT NULL,
	`speaker_profile_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`proposal_id`, `speaker_profile_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`speaker_profile_id`) REFERENCES `speaker_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`form_version_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`reviewer_group_id` text,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`category` text NOT NULL,
	`format` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`level` text NOT NULL,
	`responses` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` integer,
	`decided_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_version_id`) REFERENCES `form_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_group_id`) REFERENCES `reviewer_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposal_event_status_idx` ON `proposals` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `proposal_owner_idx` ON `proposals` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `resource_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`sanitized_html` text DEFAULT '' NOT NULL,
	`embed_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_event_slug_unique` ON `resource_pages` (`event_id`,`slug`);--> statement-breakpoint
CREATE TABLE `review_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`round_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scores` text DEFAULT '{}' NOT NULL,
	`total_score` integer,
	`recommendation` text,
	`notes` text,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `review_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_assignment_unique` ON `review_assignments` (`proposal_id`,`round_id`,`reviewer_user_id`);--> statement-breakpoint
CREATE INDEX `reviewer_queue_idx` ON `review_assignments` (`reviewer_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `review_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`round` integer NOT NULL,
	`rubric` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviewer_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_speakers` (
	`session_id` text NOT NULL,
	`speaker_profile_id` text NOT NULL,
	PRIMARY KEY(`session_id`, `speaker_profile_id`),
	FOREIGN KEY (`session_id`) REFERENCES `program_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`speaker_profile_id`) REFERENCES `speaker_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_speaker_conflict_idx` ON `session_speakers` (`speaker_profile_id`);--> statement-breakpoint
CREATE TABLE `speaker_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`pronouns` text,
	`city` text,
	`headshot_upload_id` text,
	`profile_complete` integer DEFAULT false NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speaker_user_event_unique` ON `speaker_profiles` (`user_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `speaker_email_event_unique` ON `speaker_profiles` (`email`,`event_id`);--> statement-breakpoint
CREATE INDEX `speaker_event_idx` ON `speaker_profiles` (`event_id`);--> statement-breakpoint
CREATE TABLE `speaker_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`template_id` text,
	`speaker_profile_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`due_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `task_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaker_profile_id`) REFERENCES `speaker_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_event_status_due_idx` ON `speaker_tasks` (`event_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `task_speaker_idx` ON `speaker_tasks` (`speaker_profile_id`);--> statement-breakpoint
CREATE TABLE `submission_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'cfp' NOT NULL,
	`target_type` text DEFAULT 'submission' NOT NULL,
	`submission_type` text DEFAULT 'abstract' NOT NULL,
	`collects_participants` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`max_submissions_per_user` integer,
	`redirect_to_portal` integer DEFAULT true NOT NULL,
	`confirmation_email_enabled` integer DEFAULT true NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_form_event_slug_unique` ON `submission_forms` (`event_id`,`slug`);--> statement-breakpoint
CREATE INDEX `submission_form_event_idx` ON `submission_forms` (`event_id`);--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`target_type` text DEFAULT 'contact' NOT NULL,
	`completion_mode` text DEFAULT 'manual' NOT NULL,
	`relative_due_days` integer DEFAULT 7 NOT NULL,
	`form_version_id` text,
	`file_request_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_version_id`) REFERENCES `form_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_request_id`) REFERENCES `file_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`purpose` text NOT NULL,
	`public` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_object_key_unique` ON `uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `upload_event_owner_idx` ON `uploads` (`event_id`,`owner_user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);