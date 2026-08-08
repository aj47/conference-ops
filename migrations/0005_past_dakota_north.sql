CREATE TABLE `communication_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`offset_days` integer DEFAULT 2 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_schedule_event_kind_unique` ON `communication_schedules` (`event_id`,`kind`);--> statement-breakpoint
ALTER TABLE `message_templates` ADD `kind` text DEFAULT 'reminder' NOT NULL;
--> statement-breakpoint
UPDATE message_templates SET kind = 'calendar'
WHERE lower(name) LIKE '%schedul%' OR lower(name) LIKE '%calendar%';
--> statement-breakpoint
INSERT OR IGNORE INTO communication_schedules (id, event_id, kind, enabled, offset_days, created_at, updated_at)
SELECT 'schedule-cfp-draft-' || id, id, 'cfp_draft', 1, 2, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM events WHERE deleted_at IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO communication_schedules (id, event_id, kind, enabled, offset_days, created_at, updated_at)
SELECT 'schedule-task-overdue-' || id, id, 'task_overdue', 1, 2, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM events WHERE deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at)
SELECT 'message-confirmation-' || e.id, e.id, 'submission_confirmation', 'Submission confirmation',
  'We received your {{event.name}} proposal',
  '<p>Hi {{speaker.name}},</p><p>Your proposal is in the review queue.</p><p><a href="{{speaker.portal_url}}">Open your portal</a></p>',
  'Hi {{speaker.name}}, your proposal is in the review queue. Open your portal: {{speaker.portal_url}}',
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_templates mt WHERE mt.event_id = e.id AND mt.kind = 'submission_confirmation');
--> statement-breakpoint
INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at)
SELECT 'message-acceptance-' || e.id, e.id, 'acceptance', 'Acceptance decision',
  'You are speaking at {{event.name}}',
  '<p>Hi {{speaker.name}},</p><p>Your proposal <strong>{{proposal.title}}</strong> has been accepted.</p><p><a href="{{speaker.portal_url}}">Open onboarding</a></p><p>{{decision.feedback}}</p>',
  'Hi {{speaker.name}}, your proposal {{proposal.title}} has been accepted. Open onboarding: {{speaker.portal_url}}. {{decision.feedback}}',
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_templates mt WHERE mt.event_id = e.id AND mt.kind = 'acceptance');
--> statement-breakpoint
INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at)
SELECT 'message-rejection-' || e.id, e.id, 'rejection', 'Decline decision',
  'Your {{event.name}} proposal',
  '<p>Hi {{speaker.name}},</p><p>Thank you for submitting <strong>{{proposal.title}}</strong>. We are not able to include it in this program.</p><p>{{decision.feedback}}</p>',
  'Hi {{speaker.name}}, thank you for submitting {{proposal.title}}. We are not able to include it in this program. {{decision.feedback}}',
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_templates mt WHERE mt.event_id = e.id AND mt.kind = 'rejection');
--> statement-breakpoint
INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at)
SELECT 'message-reminder-' || e.id, e.id, 'reminder', 'Speaker task reminder',
  'Speaker tasks due · {{event.name}}',
  '<p>Hi {{speaker.name}},</p><p>You have {{task.count}} outstanding speaker task(s).</p><p><a href="{{speaker.portal_url}}">Open your portal</a></p>',
  'Hi {{speaker.name}}, you have {{task.count}} outstanding speaker task(s). Open your portal: {{speaker.portal_url}}',
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_templates mt WHERE mt.event_id = e.id AND mt.kind = 'reminder');
--> statement-breakpoint
INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at)
SELECT 'message-calendar-' || e.id, e.id, 'calendar', 'Session calendar invitation',
  'Your {{event.name}} session is scheduled',
  '<p>Your session has a time and room. The calendar invitation is attached.</p>',
  'Your session has a time and room. The calendar invitation is attached.',
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_templates mt WHERE mt.event_id = e.id AND mt.kind = 'calendar');
--> statement-breakpoint
INSERT INTO submission_forms
  (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, published_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, created_at, updated_at)
SELECT 'hotel-form-' || e.id, e.id, 'Hotel stay requirements', 'hotel-stay', 'portal', 'contact', 'session', 0, 'published', 1, 1, 1, 1, 0,
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM submission_forms sf WHERE sf.event_id = e.id AND sf.kind = 'portal' AND lower(sf.name) LIKE '%hotel%');
--> statement-breakpoint
INSERT INTO form_versions
  (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, published_at, created_by, created_at)
SELECT 'hotel-version-' || sf.event_id, sf.id, 1, 'Hotel stay requirements', 'Hotel', 'Plan your stay',
  'Tell the event team whether you need an event-provided room and when you expect to arrive.', 'Your hotel requirements are saved.', 1, 0,
  '[{"id":"hotel-needed","label":"Do you need an event-provided hotel room?","type":"checkbox","required":true,"section":"proposal"},{"id":"hotel-arrival","label":"Expected arrival date and time","type":"short_text","required":true,"section":"proposal","condition":{"sourceFieldId":"hotel-needed","operator":"equals","value":"true"}},{"id":"hotel-notes","label":"Accessibility or stay notes","type":"long_text","required":false,"section":"proposal","condition":{"sourceFieldId":"hotel-needed","operator":"equals","value":"true"}}]',
  '{"proposalSectionTitle":"Hotel stay requirements","proposalPageHeading":"Hotel","proposalInstructions":"Share only the travel details the event team needs.","participantSectionTitle":"Speaker details","participantPageHeading":"Speaker","participantInstructions":"","participantMin":1,"combinedCharacterLimit":10000,"submissionType":"session","collectsParticipants":false,"maxSubmissionsPerUser":1,"redirectToPortal":true,"confirmationEmailEnabled":false}',
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  (SELECT em.user_id FROM event_memberships em WHERE em.event_id = sf.event_id AND em.role = 'organizer' ORDER BY em.created_at LIMIT 1),
  CAST(strftime('%s','now') AS INTEGER) * 1000
FROM submission_forms sf WHERE sf.id = 'hotel-form-' || sf.event_id
  AND NOT EXISTS (SELECT 1 FROM form_versions fv WHERE fv.form_id = sf.id);
--> statement-breakpoint
INSERT INTO submission_forms
  (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, published_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, created_at, updated_at)
SELECT 'flight-form-' || e.id, e.id, 'Flight reimbursement', 'flight-reimbursement', 'portal', 'contact', 'session', 0, 'published', 1, 1, 1, 1, 0,
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM submission_forms sf WHERE sf.event_id = e.id AND sf.kind = 'portal' AND lower(sf.name) LIKE '%flight%');
--> statement-breakpoint
INSERT INTO form_versions
  (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, published_at, created_by, created_at)
SELECT 'flight-version-' || sf.event_id, sf.id, 1, 'Flight reimbursement', 'Travel', 'Plan your travel',
  'Share the itinerary and reimbursement details the event team needs.', 'Your travel details are saved.', 1, 0,
  '[{"id":"flight-needed","label":"Will you request flight reimbursement?","type":"checkbox","required":true,"section":"proposal"},{"id":"flight-itinerary","label":"Proposed itinerary or booking link","type":"long_text","required":true,"section":"proposal","condition":{"sourceFieldId":"flight-needed","operator":"equals","value":"true"}},{"id":"flight-amount","label":"Estimated reimbursement amount","type":"short_text","required":true,"section":"proposal","condition":{"sourceFieldId":"flight-needed","operator":"equals","value":"true"}}]',
  '{"proposalSectionTitle":"Flight reimbursement","proposalPageHeading":"Travel","proposalInstructions":"Do not include card or passport numbers.","participantSectionTitle":"Speaker details","participantPageHeading":"Speaker","participantInstructions":"","participantMin":1,"combinedCharacterLimit":10000,"submissionType":"session","collectsParticipants":false,"maxSubmissionsPerUser":1,"redirectToPortal":true,"confirmationEmailEnabled":false}',
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  (SELECT em.user_id FROM event_memberships em WHERE em.event_id = sf.event_id AND em.role = 'organizer' ORDER BY em.created_at LIMIT 1),
  CAST(strftime('%s','now') AS INTEGER) * 1000
FROM submission_forms sf WHERE sf.id = 'flight-form-' || sf.event_id
  AND NOT EXISTS (SELECT 1 FROM form_versions fv WHERE fv.form_id = sf.id);
--> statement-breakpoint
INSERT INTO task_templates
  (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, form_version_id, created_at, updated_at)
SELECT 'hotel-task-' || e.id, e.id, 'Hotel stay requirements', 'Tell the event team whether you need a hotel stay and share arrival details.', 'form', 'contact', 'form', 21,
  (SELECT fv.id FROM form_versions fv JOIN submission_forms sf ON sf.id = fv.form_id WHERE sf.event_id = e.id AND sf.kind = 'portal' AND lower(sf.name) LIKE '%hotel%' ORDER BY fv.version DESC LIMIT 1),
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM task_templates tt WHERE tt.event_id = e.id AND lower(tt.title) LIKE '%hotel%');
--> statement-breakpoint
INSERT INTO task_templates
  (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, form_version_id, created_at, updated_at)
SELECT 'flight-task-' || e.id, e.id, 'Flight reimbursement', 'Share the itinerary and reimbursement details the event team needs.', 'form', 'contact', 'form', 18,
  (SELECT fv.id FROM form_versions fv JOIN submission_forms sf ON sf.id = fv.form_id WHERE sf.event_id = e.id AND sf.kind = 'portal' AND lower(sf.name) LIKE '%flight%' ORDER BY fv.version DESC LIMIT 1),
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM task_templates tt WHERE tt.event_id = e.id AND lower(tt.title) LIKE '%flight%');
--> statement-breakpoint
INSERT INTO speaker_tasks
  (id, event_id, template_id, speaker_profile_id, proposal_id, title, description, type, status, due_at, created_at, updated_at)
SELECT 'task-' || lower(hex(randomblob(16))), sp.event_id, tt.id, sp.id, NULL, tt.title, tt.description, tt.type,
  CASE WHEN e.starts_at - (tt.relative_due_days * 86400000) < CAST(strftime('%s','now') AS INTEGER) * 1000 THEN 'overdue' ELSE 'not_started' END,
  e.starts_at - (tt.relative_due_days * 86400000), CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM speaker_profiles sp
JOIN events e ON e.id = sp.event_id
JOIN task_templates tt ON tt.event_id = sp.event_id AND tt.target_type = 'contact' AND (lower(tt.title) LIKE '%hotel%' OR lower(tt.title) LIKE '%flight%')
WHERE EXISTS (
  SELECT 1 FROM proposal_speakers ps JOIN proposals p ON p.id = ps.proposal_id
  WHERE ps.speaker_profile_id = sp.id AND p.event_id = sp.event_id AND p.status IN ('accepted','session')
)
AND NOT EXISTS (
  SELECT 1 FROM speaker_tasks st WHERE st.event_id = sp.event_id AND st.template_id = tt.id AND st.speaker_profile_id = sp.id AND st.proposal_id IS NULL
);
