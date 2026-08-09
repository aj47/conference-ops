CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`editor_user_id` text,
	`editor_name` text NOT NULL,
	`restored_from_version` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`editor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_revision_entity_version_unique` ON `content_revisions` (`event_id`,`entity_type`,`entity_id`,`version`);--> statement-breakpoint
CREATE INDEX `content_revision_entity_time_idx` ON `content_revisions` (`event_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_content_status` (
	`session_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `program_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_content_event_status_idx` ON `session_content_status` (`event_id`,`status`);--> statement-breakpoint
CREATE TABLE `speaker_communication_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`recipient_ids` text DEFAULT '[]' NOT NULL,
	`recipient_names` text DEFAULT '[]' NOT NULL,
	`subject` text NOT NULL,
	`body_template` text NOT NULL,
	`rendered_previews` text DEFAULT '[]' NOT NULL,
	`delivery_mode` text NOT NULL,
	`status` text NOT NULL,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `speaker_communication_event_time_idx` ON `speaker_communication_logs` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `speaker_operations` (
	`speaker_profile_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`workflow_status` text DEFAULT 'invited' NOT NULL,
	`social_links` text DEFAULT '{}' NOT NULL,
	`travel_details` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`speaker_profile_id`) REFERENCES `speaker_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `speaker_operations_event_status_idx` ON `speaker_operations` (`event_id`,`workflow_status`);
--> statement-breakpoint
CREATE TRIGGER "airtable_review_round_reviewers_insert" AFTER INSERT ON "review_round_reviewers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_round_reviewer', json_array(NEW."round_id", NEW."reviewer_user_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_review_round_reviewers_update" AFTER UPDATE ON "review_round_reviewers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_round_reviewer', json_array(NEW."round_id", NEW."reviewer_user_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_review_round_reviewers_delete" AFTER DELETE ON "review_round_reviewers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_round_reviewer', json_array(OLD."round_id", OLD."reviewer_user_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_ai_review_evaluations_insert" AFTER INSERT ON "ai_review_evaluations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'ai_review_evaluation', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_ai_review_evaluations_update" AFTER UPDATE ON "ai_review_evaluations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'ai_review_evaluation', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_ai_review_evaluations_delete" AFTER DELETE ON "ai_review_evaluations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'ai_review_evaluation', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_speaker_operations_insert" AFTER INSERT ON "speaker_operations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_operation', json_array(NEW."speaker_profile_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_speaker_operations_update" AFTER UPDATE ON "speaker_operations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_operation', json_array(NEW."speaker_profile_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_speaker_operations_delete" AFTER DELETE ON "speaker_operations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_operation', json_array(OLD."speaker_profile_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_session_content_status_insert" AFTER INSERT ON "session_content_status"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'session_content_status', json_array(NEW."session_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_session_content_status_update" AFTER UPDATE ON "session_content_status"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'session_content_status', json_array(NEW."session_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_session_content_status_delete" AFTER DELETE ON "session_content_status"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'session_content_status', json_array(OLD."session_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
INSERT INTO `session_content_status` (`session_id`, `event_id`, `status`, `created_at`, `updated_at`)
SELECT `id`, `event_id`, 'approved', `created_at`, `updated_at`
FROM `program_sessions`
WHERE `status` = 'published'
ON CONFLICT(`session_id`) DO NOTHING;--> statement-breakpoint
CREATE TRIGGER "airtable_content_revisions_insert" AFTER INSERT ON "content_revisions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'content_revision', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_content_revisions_update" AFTER UPDATE ON "content_revisions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'content_revision', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_content_revisions_delete" AFTER DELETE ON "content_revisions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'content_revision', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_speaker_communication_logs_insert" AFTER INSERT ON "speaker_communication_logs"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_communication_log', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_speaker_communication_logs_update" AFTER UPDATE ON "speaker_communication_logs"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_communication_log', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER "airtable_speaker_communication_logs_delete" AFTER DELETE ON "speaker_communication_logs"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_communication_log', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;
