ALTER TABLE `proposals` ADD `revision_requested_by` text;
--> statement-breakpoint
-- Airtable canonical-record change capture
CREATE TRIGGER "airtable_task_comments_insert" AFTER INSERT ON "task_comments"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_comment', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_comments_update" AFTER UPDATE ON "task_comments"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_comment', json_array(NEW."id"), 'upsert', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
CREATE TRIGGER "airtable_task_comments_delete" AFTER DELETE ON "task_comments"
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), (SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1), 'task_comment', json_array(OLD."id"), 'tombstone', 'queued', 0, 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), NULL, NULL, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
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
