CREATE TABLE `airtable_change_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`local_key` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`available_at` integer NOT NULL,
	`lease_expires_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `airtable_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_change_entity_unique` ON `airtable_change_queue` (`connection_id`,`entity_type`,`local_key`);--> statement-breakpoint
CREATE INDEX `airtable_change_due_idx` ON `airtable_change_queue` (`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `airtable_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`airtable_record_id` text NOT NULL,
	`command_type` text NOT NULL,
	`target_entity` text NOT NULL,
	`target_key` text NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`requested_at` integer NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `airtable_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_command_remote_unique` ON `airtable_commands` (`connection_id`,`airtable_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_command_idempotency_unique` ON `airtable_commands` (`connection_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `airtable_command_status_idx` ON `airtable_commands` (`connection_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `airtable_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`local_key` text NOT NULL,
	`airtable_record_id` text,
	`reason` text NOT NULL,
	`local_hash` text,
	`remote_hash` text,
	`remote_payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `airtable_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `airtable_conflict_open_idx` ON `airtable_conflicts` (`connection_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `airtable_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`base_id` text NOT NULL,
	`records_table_id` text NOT NULL,
	`commands_table_id` text NOT NULL,
	`authority` text DEFAULT 'd1' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`webhook_id` text,
	`webhook_cursor` integer DEFAULT 0 NOT NULL,
	`webhook_expires_at` integer,
	`last_push_at` integer,
	`last_pull_at` integer,
	`last_reconciled_at` integer,
	`reconciliation_started_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_connection_base_unique` ON `airtable_connections` (`base_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_connection_event_unique` ON `airtable_connections` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_connection_one_global_enabled` ON `airtable_connections` (`enabled`) WHERE `airtable_connections`.`event_id` IS NULL AND `airtable_connections`.`enabled` = 1;--> statement-breakpoint
CREATE INDEX `airtable_connection_enabled_idx` ON `airtable_connections` (`enabled`,`status`);--> statement-breakpoint
CREATE TABLE `airtable_record_maps` (
	`connection_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`local_key` text NOT NULL,
	`airtable_record_id` text NOT NULL,
	`last_local_hash` text,
	`last_remote_hash` text,
	`last_remote_transaction` integer,
	`last_synced_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `entity_type`, `local_key`),
	FOREIGN KEY (`connection_id`) REFERENCES `airtable_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_record_remote_unique` ON `airtable_record_maps` (`connection_id`,`airtable_record_id`);
--> statement-breakpoint
-- Airtable canonical-record change capture
CREATE TRIGGER "airtable_user_insert" AFTER INSERT ON "user"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'person', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_user_update" AFTER UPDATE ON "user"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'person', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_user_delete" AFTER DELETE ON "user"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'person', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_organizations_insert" AFTER INSERT ON "organizations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'organization', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_organizations_update" AFTER UPDATE ON "organizations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'organization', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_organizations_delete" AFTER DELETE ON "organizations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'organization', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_organization_members_insert" AFTER INSERT ON "organization_members"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'organization_member', json_array(NEW."organization_id", NEW."user_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_organization_members_update" AFTER UPDATE ON "organization_members"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'organization_member', json_array(NEW."organization_id", NEW."user_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_organization_members_delete" AFTER DELETE ON "organization_members"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'organization_member', json_array(OLD."organization_id", OLD."user_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_events_insert" AFTER INSERT ON "events"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_events_update" AFTER UPDATE ON "events"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_events_delete" AFTER DELETE ON "events"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_event_memberships_insert" AFTER INSERT ON "event_memberships"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event_membership', json_array(NEW."event_id", NEW."user_id", NEW."role"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_event_memberships_update" AFTER UPDATE ON "event_memberships"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event_membership', json_array(NEW."event_id", NEW."user_id", NEW."role"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_event_memberships_delete" AFTER DELETE ON "event_memberships"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event_membership', json_array(OLD."event_id", OLD."user_id", OLD."role"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_event_invitations_insert" AFTER INSERT ON "event_invitations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event_invitation', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_event_invitations_update" AFTER UPDATE ON "event_invitations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event_invitation', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_event_invitations_delete" AFTER DELETE ON "event_invitations"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'event_invitation', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_submission_forms_insert" AFTER INSERT ON "submission_forms"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'submission_form', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_submission_forms_update" AFTER UPDATE ON "submission_forms"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'submission_form', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_submission_forms_delete" AFTER DELETE ON "submission_forms"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'submission_form', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_form_versions_insert" AFTER INSERT ON "form_versions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'form_version', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_form_versions_update" AFTER UPDATE ON "form_versions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'form_version', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_form_versions_delete" AFTER DELETE ON "form_versions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'form_version', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_reviewer_groups_insert" AFTER INSERT ON "reviewer_groups"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'reviewer_group', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_reviewer_groups_update" AFTER UPDATE ON "reviewer_groups"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'reviewer_group', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_reviewer_groups_delete" AFTER DELETE ON "reviewer_groups"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'reviewer_group', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_reviewer_group_members_insert" AFTER INSERT ON "reviewer_group_members"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'reviewer_group_member', json_array(NEW."reviewer_group_id", NEW."user_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_reviewer_group_members_update" AFTER UPDATE ON "reviewer_group_members"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'reviewer_group_member', json_array(NEW."reviewer_group_id", NEW."user_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_reviewer_group_members_delete" AFTER DELETE ON "reviewer_group_members"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'reviewer_group_member', json_array(OLD."reviewer_group_id", OLD."user_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposal_reviewer_groups_insert" AFTER INSERT ON "proposal_reviewer_groups"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal_reviewer_group', json_array(NEW."proposal_id", NEW."reviewer_group_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposal_reviewer_groups_update" AFTER UPDATE ON "proposal_reviewer_groups"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal_reviewer_group', json_array(NEW."proposal_id", NEW."reviewer_group_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposal_reviewer_groups_delete" AFTER DELETE ON "proposal_reviewer_groups"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal_reviewer_group', json_array(OLD."proposal_id", OLD."reviewer_group_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_speaker_profiles_insert" AFTER INSERT ON "speaker_profiles"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_profile', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_speaker_profiles_update" AFTER UPDATE ON "speaker_profiles"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_profile', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_speaker_profiles_delete" AFTER DELETE ON "speaker_profiles"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_profile', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposals_insert" AFTER INSERT ON "proposals"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposals_update" AFTER UPDATE ON "proposals"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposals_delete" AFTER DELETE ON "proposals"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposal_speakers_insert" AFTER INSERT ON "proposal_speakers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal_speaker', json_array(NEW."proposal_id", NEW."speaker_profile_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposal_speakers_update" AFTER UPDATE ON "proposal_speakers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal_speaker', json_array(NEW."proposal_id", NEW."speaker_profile_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_proposal_speakers_delete" AFTER DELETE ON "proposal_speakers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'proposal_speaker', json_array(OLD."proposal_id", OLD."speaker_profile_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_review_rounds_insert" AFTER INSERT ON "review_rounds"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_round', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_review_rounds_update" AFTER UPDATE ON "review_rounds"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_round', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_review_rounds_delete" AFTER DELETE ON "review_rounds"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_round', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_review_assignments_insert" AFTER INSERT ON "review_assignments"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_assignment', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_review_assignments_update" AFTER UPDATE ON "review_assignments"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_assignment', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_review_assignments_delete" AFTER DELETE ON "review_assignments"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'review_assignment', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_tracks_insert" AFTER INSERT ON "tracks"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'track', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_tracks_update" AFTER UPDATE ON "tracks"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'track', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_tracks_delete" AFTER DELETE ON "tracks"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'track', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_rooms_insert" AFTER INSERT ON "rooms"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'room', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_rooms_update" AFTER UPDATE ON "rooms"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'room', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_rooms_delete" AFTER DELETE ON "rooms"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'room', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_program_sessions_insert" AFTER INSERT ON "program_sessions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'program_session', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_program_sessions_update" AFTER UPDATE ON "program_sessions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'program_session', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_program_sessions_delete" AFTER DELETE ON "program_sessions"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'program_session', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_session_speakers_insert" AFTER INSERT ON "session_speakers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'session_speaker', json_array(NEW."session_id", NEW."speaker_profile_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_session_speakers_update" AFTER UPDATE ON "session_speakers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'session_speaker', json_array(NEW."session_id", NEW."speaker_profile_id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_session_speakers_delete" AFTER DELETE ON "session_speakers"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'session_speaker', json_array(OLD."session_id", OLD."speaker_profile_id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_uploads_insert" AFTER INSERT ON "uploads"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'upload', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_uploads_update" AFTER UPDATE ON "uploads"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'upload', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_uploads_delete" AFTER DELETE ON "uploads"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'upload', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_file_requests_insert" AFTER INSERT ON "file_requests"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'file_request', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_file_requests_update" AFTER UPDATE ON "file_requests"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'file_request', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_file_requests_delete" AFTER DELETE ON "file_requests"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'file_request', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_file_request_responses_insert" AFTER INSERT ON "file_request_responses"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'file_request_response', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_file_request_responses_update" AFTER UPDATE ON "file_request_responses"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'file_request_response', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_file_request_responses_delete" AFTER DELETE ON "file_request_responses"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'file_request_response', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_templates_insert" AFTER INSERT ON "task_templates"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_template', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_templates_update" AFTER UPDATE ON "task_templates"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_template', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_templates_delete" AFTER DELETE ON "task_templates"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_template', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_speaker_tasks_insert" AFTER INSERT ON "speaker_tasks"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_task', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_speaker_tasks_update" AFTER UPDATE ON "speaker_tasks"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_task', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_speaker_tasks_delete" AFTER DELETE ON "speaker_tasks"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'speaker_task', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_responses_insert" AFTER INSERT ON "task_responses"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_response', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_responses_update" AFTER UPDATE ON "task_responses"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_response', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_responses_delete" AFTER DELETE ON "task_responses"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_response', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_embeds_insert" AFTER INSERT ON "embeds"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'embed', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_embeds_update" AFTER UPDATE ON "embeds"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'embed', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_embeds_delete" AFTER DELETE ON "embeds"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'embed', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_resource_pages_insert" AFTER INSERT ON "resource_pages"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'resource_page', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_resource_pages_update" AFTER UPDATE ON "resource_pages"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'resource_page', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_resource_pages_delete" AFTER DELETE ON "resource_pages"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'resource_page', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_message_templates_insert" AFTER INSERT ON "message_templates"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'message_template', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_message_templates_update" AFTER UPDATE ON "message_templates"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'message_template', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_message_templates_delete" AFTER DELETE ON "message_templates"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'message_template', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_communication_schedules_insert" AFTER INSERT ON "communication_schedules"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'communication_schedule', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_communication_schedules_update" AFTER UPDATE ON "communication_schedules"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'communication_schedule', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_communication_schedules_delete" AFTER DELETE ON "communication_schedules"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'communication_schedule', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_audit_logs_insert" AFTER INSERT ON "audit_logs"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'audit_log', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_audit_logs_update" AFTER UPDATE ON "audit_logs"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'audit_log', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_audit_logs_delete" AFTER DELETE ON "audit_logs"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'audit_log', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
