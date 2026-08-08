DROP INDEX `event_org_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `event_slug_unique` ON `events` (`slug`);