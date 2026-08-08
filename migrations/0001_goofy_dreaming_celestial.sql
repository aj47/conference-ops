PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
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
INSERT INTO `__new_outbox`("id", "event_id", "kind", "idempotency_key", "payload", "status", "attempts", "available_at", "last_error", "sent_at", "created_at", "updated_at") SELECT "id", "event_id", "kind", "idempotency_key", "payload", "status", "attempts", "available_at", "last_error", "sent_at", "created_at", "updated_at" FROM `outbox`;--> statement-breakpoint
DROP TABLE `outbox`;--> statement-breakpoint
ALTER TABLE `__new_outbox` RENAME TO `outbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_idempotency_unique` ON `outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbox_due_idx` ON `outbox` (`status`,`available_at`);--> statement-breakpoint
ALTER TABLE `form_versions` ADD `public_title` text NOT NULL;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `page_heading` text DEFAULT 'Apply' NOT NULL;--> statement-breakpoint
ALTER TABLE `form_versions` ADD `settings` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `submission_forms` ADD `published_version` integer;