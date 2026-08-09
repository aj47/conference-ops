DROP INDEX `review_assignment_unique`;--> statement-breakpoint
ALTER TABLE `review_assignments` ADD `review_cycle` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `review_assignment_unique` ON `review_assignments` (`proposal_id`,`round_id`,`reviewer_user_id`,`review_cycle`);--> statement-breakpoint
ALTER TABLE `proposals` ADD `review_cycle` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `proposals`
SET `review_cycle` = 2
WHERE `status` IN ('changes_requested', 'revision_open')
  AND `revision_requested_at` IS NOT NULL;
