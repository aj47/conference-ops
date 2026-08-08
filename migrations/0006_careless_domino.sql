CREATE TABLE `proposal_reviewer_groups` (
	`proposal_id` text NOT NULL,
	`reviewer_group_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `reviewer_group_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_group_id`) REFERENCES `reviewer_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_reviewer_group_idx` ON `proposal_reviewer_groups` (`reviewer_group_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO proposal_reviewer_groups (proposal_id, reviewer_group_id)
SELECT id, reviewer_group_id FROM proposals WHERE reviewer_group_id IS NOT NULL;
