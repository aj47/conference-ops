-- DEMO DATA ONLY. Never execute this file against a production database.
-- Render it with scripts/render-demo-seed.mjs so Better Auth receives a real
-- password hash without committing the demo password or hash to source control.

PRAGMA foreign_keys = ON;

INSERT OR REPLACE INTO user
  (id, name, email, email_verified, image, created_at, updated_at)
VALUES
  ('user-organizer', 'Maya Chen', 'maya@aiengineer.events', 1, NULL, 1785585600000, 1786174200000),
  ('user-reviewer', 'Dev Patel', 'dev@aiengineer.events', 1, NULL, 1785585600000, 1786174200000),
  ('user-applicant', 'Leah Okafor', 'leah@example.com', 1, NULL, 1785585600000, 1786174200000),
  ('user-speaker', 'Marco Ruiz', 'marco@example.com', 1, NULL, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO account
  (id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
   access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at)
VALUES
  ('account-organizer', 'user-organizer', 'credential', 'user-organizer', NULL, NULL, NULL, NULL, NULL, NULL, '__DEMO_PASSWORD_HASH__', 1785585600000, 1786174200000),
  ('account-reviewer', 'user-reviewer', 'credential', 'user-reviewer', NULL, NULL, NULL, NULL, NULL, NULL, '__DEMO_PASSWORD_HASH__', 1785585600000, 1786174200000),
  ('account-applicant', 'user-applicant', 'credential', 'user-applicant', NULL, NULL, NULL, NULL, NULL, NULL, '__DEMO_PASSWORD_HASH__', 1785585600000, 1786174200000),
  ('account-speaker', 'user-speaker', 'credential', 'user-speaker', NULL, NULL, NULL, NULL, NULL, NULL, '__DEMO_PASSWORD_HASH__', 1785585600000, 1786174200000);

INSERT OR REPLACE INTO organizations
  (id, name, slug, created_at, updated_at)
VALUES
  ('org-aie', 'AI Engineer Events', 'ai-engineer-events', 1785585600000, 1786174200000);

INSERT OR REPLACE INTO organization_members
  (organization_id, user_id, role, created_at)
VALUES
  ('org-aie', 'user-organizer', 'owner', 1785585600000),
  ('org-aie', 'user-reviewer', 'member', 1785585600000);

INSERT OR REPLACE INTO events
  (id, organization_id, slug, name, short_name, description, timezone, starts_at,
   ends_at, cfp_closes_at, venue, website_url, accent, logo_upload_id,
   background_upload_id, status,
   public_agenda_revision, allowed_embed_origins, deleted_at, created_at, updated_at)
VALUES
  ('event-aie-2026', 'org-aie', 'ai-engineer-summit-2026',
   'AI Engineer Summit 2026', 'AIE 2026',
   'A working conference for people building, evaluating, and operating AI systems.',
   'America/Los_Angeles', 1787932800000, 1788051600000, 1786597200000,
   'Fort Mason Center, San Francisco', 'https://example.com/ai-engineer-summit',
   '#e05b3f', NULL, NULL, 'review', 7,
   '["https://www.example.com","http://localhost:5173"]', NULL,
   1785585600000, 1786174200000);

INSERT OR REPLACE INTO event_memberships
  (event_id, user_id, role, invited_by, accepted_at, created_at)
VALUES
  ('event-aie-2026', 'user-organizer', 'organizer', 'user-organizer', 1785585600000, 1785585600000),
  ('event-aie-2026', 'user-reviewer', 'reviewer', 'user-organizer', 1785585600000, 1785585600000),
  ('event-aie-2026', 'user-applicant', 'applicant', 'user-organizer', 1785585600000, 1785585600000),
  ('event-aie-2026', 'user-speaker', 'speaker', 'user-organizer', 1785585600000, 1785585600000);

INSERT OR REPLACE INTO event_invitations
  (id, event_id, email, role, token_hash, invited_by, expires_at, accepted_at, created_at)
VALUES
  ('invite-reviewer-2', 'event-aie-2026', 'reviewer.two@example.com', 'reviewer',
   'demo-nonsecret-token-hash-reviewer-2', 'user-organizer', 1786838340000, NULL,
   1786174200000);

INSERT OR REPLACE INTO submission_forms
  (id, event_id, name, slug, kind, target_type, submission_type,
   collects_participants, status, current_version, published_version,
   max_submissions_per_user, redirect_to_portal, confirmation_email_enabled,
   opens_at, closes_at, created_at, updated_at)
VALUES
  ('form-main-cfp', 'event-aie-2026', 'AI Engineer Summit 2026 CFP', 'call-for-speakers',
   'cfp', 'submission', 'abstract', 1, 'published', 3, 2, 3, 1, 1,
   1785585600000, 1786597200000, 1785585600000, 1786174200000),
  ('form-logistics', 'event-aie-2026', 'Workshop logistics', 'workshop-logistics',
   'portal', 'submission', 'session', 0, 'published', 1, 1, 1, 1, 1,
   NULL, 1787097540000, 1785585600000, 1786174200000),
  ('form-lightning', 'event-aie-2026', 'Lightning talk late submissions', 'lightning-late',
   'cfp', 'submission', 'abstract', 1, 'draft', 1, NULL, 1, 1, 0,
   NULL, NULL, 1786174200000, 1786174200000);

INSERT OR REPLACE INTO form_versions
  (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy,
   confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings,
   published_at, created_by, created_at)
VALUES
  ('form-version-cfp-1', 'form-main-cfp', 1,
   'Call for Speakers · AI Engineer Summit 2026', 'Apply',
   'Bring the work behind the breakthrough',
   'Share the decisions, failures, and evidence your peers can use on Monday.',
   'Your proposal is in. You can revise it until the call closes.', 4, 1,
   '[{"id":"field-title","label":"Session title","type":"short_text","required":true,"description":"Clear, specific, and under 100 characters."},{"id":"field-summary","label":"Abstract","type":"long_text","required":true},{"id":"field-category","label":"Program category","type":"select","required":true,"options":["Agents in production","Model infrastructure","Evaluation & safety","Developer experience"]},{"id":"field-format","label":"Preferred format","type":"select","required":true,"options":["Talk","Workshop","Panel","Lightning talk"]}]',
   '{"reviewMode":"blind","source":"demo"}', 1785867600000, 'user-organizer', 1785585600000),
  ('form-version-cfp-2', 'form-main-cfp', 2,
   'Call for Speakers · AI Engineer Summit 2026', 'Apply',
   'Bring the work behind the breakthrough',
   'We want practical stories from people shipping AI systems. Share the decisions, failures, and evidence your peers can use on Monday.',
   'Your proposal is in. You can return to revise it until the call closes, and we will email you when review begins.', 4, 1,
   '[{"id":"field-title","label":"Session title","type":"short_text","required":true,"description":"Clear, specific, and under 100 characters."},{"id":"field-summary","label":"Abstract","type":"long_text","required":true,"description":"What will attendees learn, and what evidence will you share?"},{"id":"field-category","label":"Program category","type":"select","required":true,"options":["Agents in production","Model infrastructure","Evaluation & safety","Developer experience"]},{"id":"field-format","label":"Preferred format","type":"select","required":true,"options":["Talk","Workshop","Panel","Lightning talk"]},{"id":"field-repo","label":"Relevant project or repository","type":"url","required":false},{"id":"field-workshop-needs","label":"Workshop setup requirements","type":"long_text","required":true,"condition":{"sourceFieldId":"field-format","operator":"equals","value":"Workshop"}}]',
   '{"reviewMode":"blind","source":"demo"}', 1785867600000, 'user-organizer', 1785867600000),
  ('form-version-cfp-3', 'form-main-cfp', 3,
   'Call for Speakers · AI Engineer Summit 2026', 'Apply',
   'Show the work, not just the outcome',
   'Tell us what you shipped, what broke, and what another engineer can reuse.',
   'Thanks. Your draft is safe and the program team will follow up after review.', 4, 1,
   '[{"id":"field-title","label":"Session title","type":"short_text","required":true},{"id":"field-summary","label":"Abstract","type":"long_text","required":true},{"id":"field-category","label":"Program category","type":"select","required":true,"options":["Agents in production","Model infrastructure","Evaluation & safety","Developer experience"]},{"id":"field-format","label":"Preferred format","type":"select","required":true,"options":["Talk","Workshop","Panel","Lightning talk"]},{"id":"field-takeaways","label":"Three concrete takeaways","type":"long_text","required":true}]',
   '{"reviewMode":"blind","changeNote":"Unpublished copy and takeaway-field draft"}', NULL, 'user-organizer', 1786174200000),
  ('form-version-logistics-1', 'form-logistics', 1,
   'Workshop production details', 'Details',
   'Help production prepare your room',
   'Answer once for the accepted workshop. Your response remains attached to the session.',
   'Saved. Production can now review your requirements.', 1, 0,
   '[{"id":"field-layout","label":"Preferred room layout","type":"select","required":true,"options":["Classroom","Pods","Theater"]},{"id":"field-installs","label":"Attendee prerequisites","type":"long_text","required":true},{"id":"field-network","label":"Network or power requirements","type":"long_text","required":false}]',
   '{"portalTask":true,"lockAfterSubmit":false}', 1786174200000, 'user-organizer', 1786174200000),
  ('form-version-lightning-1', 'form-lightning', 1,
   'Lightning talks', 'Apply', 'Pitch one sharp idea',
   'A five-minute demo or lesson with one memorable takeaway.',
   'Draft saved.', 1, 0,
   '[{"id":"field-title","label":"Title","type":"short_text","required":true},{"id":"field-summary","label":"What will you show?","type":"long_text","required":true}]',
   '{"source":"demo"}', NULL, 'user-organizer', 1786174200000);

INSERT OR REPLACE INTO submission_forms
  (id, event_id, name, slug, kind, target_type, submission_type,
   collects_participants, status, current_version, published_version,
   max_submissions_per_user, redirect_to_portal, confirmation_email_enabled,
   opens_at, closes_at, created_at, updated_at)
VALUES
  ('form-hotel', 'event-aie-2026', 'Hotel stay requirements', 'hotel-stay',
   'portal', 'contact', 'session', 0, 'published', 1, 1, 1, 1, 0,
   NULL, NULL, 1785585600000, 1786174200000),
  ('form-flight', 'event-aie-2026', 'Flight reimbursement', 'flight-reimbursement',
   'portal', 'contact', 'session', 0, 'published', 1, 1, 1, 1, 0,
   NULL, NULL, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO form_versions
  (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy,
   confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings,
   published_at, created_by, created_at)
VALUES
  ('form-version-hotel-1', 'form-hotel', 1, 'Hotel stay requirements', 'Hotel',
   'Plan your stay', 'Tell the event team whether you need an event-provided room and when you expect to arrive.',
   'Your hotel requirements are saved.', 1, 0,
   '[{"id":"hotel-needed","label":"Do you need an event-provided hotel room?","type":"checkbox","required":true,"section":"proposal"},{"id":"hotel-arrival","label":"Expected arrival date and time","type":"short_text","required":true,"section":"proposal","condition":{"sourceFieldId":"hotel-needed","operator":"equals","value":"true"}},{"id":"hotel-notes","label":"Accessibility or stay notes","type":"long_text","required":false,"section":"proposal","condition":{"sourceFieldId":"hotel-needed","operator":"equals","value":"true"}}]',
   '{"proposalSectionTitle":"Hotel stay requirements","proposalPageHeading":"Hotel","proposalInstructions":"Share only the travel details the event team needs.","participantSectionTitle":"Speaker details","participantPageHeading":"Speaker","participantInstructions":"","participantMin":1,"combinedCharacterLimit":10000,"submissionType":"session","collectsParticipants":false,"maxSubmissionsPerUser":1,"redirectToPortal":true,"confirmationEmailEnabled":false}',
   1786174200000, 'user-organizer', 1785585600000),
  ('form-version-flight-1', 'form-flight', 1, 'Flight reimbursement', 'Travel',
   'Plan your travel', 'Share the itinerary and reimbursement details the event team needs.',
   'Your travel details are saved.', 1, 0,
   '[{"id":"flight-needed","label":"Will you request flight reimbursement?","type":"checkbox","required":true,"section":"proposal"},{"id":"flight-itinerary","label":"Proposed itinerary or booking link","type":"long_text","required":true,"section":"proposal","condition":{"sourceFieldId":"flight-needed","operator":"equals","value":"true"}},{"id":"flight-amount","label":"Estimated reimbursement amount","type":"short_text","required":true,"section":"proposal","condition":{"sourceFieldId":"flight-needed","operator":"equals","value":"true"}}]',
   '{"proposalSectionTitle":"Flight reimbursement","proposalPageHeading":"Travel","proposalInstructions":"Do not include card or passport numbers.","participantSectionTitle":"Speaker details","participantPageHeading":"Speaker","participantInstructions":"","participantMin":1,"combinedCharacterLimit":10000,"submissionType":"session","collectsParticipants":false,"maxSubmissionsPerUser":1,"redirectToPortal":true,"confirmationEmailEnabled":false}',
   1786174200000, 'user-organizer', 1785585600000);

INSERT OR REPLACE INTO reviewer_groups
  (id, event_id, name, category, created_at, updated_at)
VALUES
  ('group-eval', 'event-aie-2026', 'Evaluation committee', 'Evaluation & safety', 1785585600000, 1786174200000),
  ('group-agents', 'event-aie-2026', 'Agent systems committee', 'Agents in production', 1785585600000, 1786174200000),
  ('group-infra', 'event-aie-2026', 'Infrastructure committee', 'Model infrastructure', 1785585600000, 1786174200000),
  ('group-dx', 'event-aie-2026', 'DX committee', 'Developer experience', 1785585600000, 1786174200000);

INSERT OR REPLACE INTO reviewer_group_members
  (reviewer_group_id, user_id, created_at)
VALUES
  ('group-eval', 'user-reviewer', 1785585600000),
  ('group-agents', 'user-reviewer', 1785585600000),
  ('group-infra', 'user-reviewer', 1785585600000),
  ('group-dx', 'user-reviewer', 1785585600000);

INSERT OR REPLACE INTO speaker_profiles
  (id, user_id, event_id, name, email, title, company, bio, pronouns, city,
   headshot_upload_id, profile_complete, published, created_at, updated_at)
VALUES
  ('speaker-marco', 'user-speaker', 'event-aie-2026', 'Marco Ruiz', 'marco@example.com',
   'Staff AI Engineer', 'Northstar',
   'Builds reliable agent systems and the evaluation loops that keep them honest.',
   'he/him', 'Austin, TX', NULL, 1, 1, 1785585600000, 1786174200000),
  ('speaker-leah', 'user-applicant', 'event-aie-2026', 'Leah Okafor', 'leah@example.com',
   'Founder', 'Tracewell', 'Works on observability for long-running AI workflows.',
   'she/her', 'London, UK', NULL, 0, 0, 1785585600000, 1786174200000),
  ('speaker-priya', NULL, 'event-aie-2026', 'Priya Nair', 'priya@example.com',
   'Research Engineer', 'Cedar Labs', 'Researches evaluation methods for tool-using models.',
   'she/her', 'Toronto, CA', NULL, 1, 1, 1785585600000, 1786174200000),
  ('speaker-jon', NULL, 'event-aie-2026', 'Jon Bell', 'jon@example.com',
   'Developer Advocate', 'Patchwork', 'Teaches teams how to debug and ship AI products.',
   'he/him', 'Seattle, WA', NULL, 1, 1, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO proposals
  (id, event_id, form_version_id, owner_user_id, reviewer_group_id, title, summary,
   category, format, duration_minutes, level, responses, status, submitted_at,
   decided_at, version, created_at, updated_at)
VALUES
  ('proposal-1', 'event-aie-2026', 'form-version-cfp-2', 'user-speaker', 'group-eval',
   'The eval flywheel that caught our agent regressions',
   'A field report on turning traces into targeted evals, release gates, and weekly product decisions.',
   'Evaluation & safety', 'talk', 30, 'intermediate',
   '{"field-title":"The eval flywheel that caught our agent regressions","field-summary":"A field report on turning traces into targeted evals.","field-category":"Evaluation & safety","field-format":"Talk","tags":["evals","production"]}',
   'session', 1785867600000, 1786174200000, 2, 1785585600000, 1786174200000),
  ('proposal-2', 'event-aie-2026', 'form-version-cfp-2', 'user-applicant', 'group-agents',
   'Observability for agents that run all afternoon',
   'How we model progress, retries, handoffs, and failure without drowning operators in traces.',
   'Agents in production', 'talk', 30, 'advanced',
   '{"field-format":"Talk","tags":["agents","observability"]}',
   'under_review', 1786001700000, NULL, 1, 1785585600000, 1786174200000),
  ('proposal-3', 'event-aie-2026', 'form-version-cfp-2', 'user-organizer', 'group-eval',
   'Red-team your tool-using model',
   'A hands-on lab for generating adversarial tool calls and converting incidents into repeatable tests.',
   'Evaluation & safety', 'workshop', 60, 'intermediate',
   '{"field-format":"Workshop","field-workshop-needs":"Reliable Wi-Fi, tables, and one power outlet per pair.","tags":["security","workshop"]}',
   'accepted', 1785762000000, 1786174200000, 1, 1785585600000, 1786174200000),
  ('proposal-4', 'event-aie-2026', 'form-version-cfp-2', 'user-organizer', 'group-dx',
   'Designing the first ten minutes of an AI SDK',
   'What developer interviews taught us about quickstarts, errors, and examples.',
   'Developer experience', 'talk', 25, 'introductory',
   '{"field-format":"Talk","tags":["DX","SDK"]}',
   'waitlisted', 1785945600000, 1786174200000, 1, 1785585600000, 1786174200000),
  ('proposal-5', 'event-aie-2026', 'form-version-cfp-2', 'user-speaker', 'group-infra',
   'Serving small models at the edge',
   'Latency and cost lessons from routing compact models near users.',
   'Model infrastructure', 'lightning', 10, 'intermediate',
   '{"field-format":"Lightning talk","tags":["edge","latency"]}',
   'submitted', 1786133400000, NULL, 1, 1785585600000, 1786174200000),
  ('proposal-6', 'event-aie-2026', 'form-version-cfp-2', 'user-applicant', 'group-agents',
   'When multi-agent delegation adds latency instead of leverage',
   'A measurement-driven account of orchestration overhead and simpler alternatives.',
   'Agents in production', 'talk', 25, 'advanced',
   '{"field-format":"Talk","tags":["agents","performance"]}',
   'decline_queue', 1785949200000, NULL, 1, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO proposal_speakers
  (proposal_id, speaker_profile_id, sort_order)
VALUES
  ('proposal-1', 'speaker-marco', 0),
  ('proposal-2', 'speaker-leah', 0),
  ('proposal-3', 'speaker-priya', 0),
  ('proposal-4', 'speaker-jon', 0),
  ('proposal-5', 'speaker-marco', 0),
  ('proposal-6', 'speaker-leah', 0);

INSERT OR REPLACE INTO proposal_reviewer_groups
  (proposal_id, reviewer_group_id)
VALUES
  ('proposal-1', 'group-eval'),
  ('proposal-2', 'group-agents'),
  ('proposal-3', 'group-eval'),
  ('proposal-4', 'group-agents'),
  ('proposal-5', 'group-eval'),
  ('proposal-6', 'group-eval');

INSERT OR REPLACE INTO review_rounds
  (id, event_id, name, round, rubric, status, created_at, updated_at)
VALUES
  ('round-1', 'event-aie-2026', 'Program review', 1,
   '[{"id":"relevance","label":"Audience relevance","weight":2,"maxScore":5},{"id":"evidence","label":"Evidence and specificity","weight":3,"maxScore":5},{"id":"delivery","label":"Likely delivery quality","weight":1,"maxScore":5}]',
   'active', 1785585600000, 1786174200000);

INSERT OR REPLACE INTO review_assignments
  (id, proposal_id, round_id, reviewer_user_id, status, scores, total_score,
   recommendation, notes, submitted_at, created_at, updated_at)
VALUES
  ('review-1', 'proposal-2', 'round-1', 'user-reviewer', 'in_progress',
   '{"relevance":5,"evidence":4,"delivery":4}', 4.33, 'yes',
   'Strong operational detail; ask for a clearer failure story.', NULL, 1785585600000, 1786174200000),
  ('review-2', 'proposal-5', 'round-1', 'user-reviewer', 'pending',
   '{}', NULL, NULL, NULL, NULL, 1785585600000, 1786174200000),
  ('review-3', 'proposal-1', 'round-1', 'user-reviewer', 'submitted',
   '{"relevance":5,"evidence":5,"delivery":4}', 4.83, 'strong_yes',
   'Concrete and immediately useful.', 1786174200000, 1785585600000, 1786174200000),
  ('review-4', 'proposal-6', 'round-1', 'user-reviewer', 'submitted',
   '{"relevance":3,"evidence":3,"delivery":3}', 3.0, 'maybe',
   'Useful premise but overlaps the observability session.', 1786174200000, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO tracks
  (id, event_id, name, color, created_at, updated_at)
VALUES
  ('track-build', 'event-aie-2026', 'Build', '#2d6a6c', 1785585600000, 1786174200000),
  ('track-operate', 'event-aie-2026', 'Operate', '#b44932', 1785585600000, 1786174200000),
  ('track-evaluate', 'event-aie-2026', 'Evaluate', '#7564a8', 1785585600000, 1786174200000);

INSERT OR REPLACE INTO rooms
  (id, event_id, name, capacity, created_at, updated_at)
VALUES
  ('room-cowell', 'event-aie-2026', 'Cowell Theater', 420, 1785585600000, 1786174200000),
  ('room-gallery', 'event-aie-2026', 'Gallery 308', 180, 1785585600000, 1786174200000),
  ('room-firehouse', 'event-aie-2026', 'Firehouse', 90, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO program_sessions
  (id, event_id, proposal_id, origin, title, description, format, capacity,
   ceu_credits, client_id, track_id, room_id, starts_at, ends_at, status,
   override_reason, calendar_uid, calendar_sequence, version, created_at, updated_at)
VALUES
  ('session-opening', 'event-aie-2026', NULL, 'direct_program', 'Opening call',
   'What we are here to build together.', 'keynote', 420, NULL, NULL,
   'track-build', 'room-cowell',
   1787932800000, 1787934000000, 'published', NULL,
   'opening-2026@conference-ops.example', 1, 2, 1785585600000, 1786174200000),
  ('session-evals', 'event-aie-2026', 'proposal-1', 'proposal',
   'The eval flywheel that caught our agent regressions', 'A production case study.',
   'talk', 420, '0.5', NULL,
   'track-evaluate', 'room-cowell', 1787934600000, 1787936400000, 'scheduled', NULL,
   'evals-2026@conference-ops.example', 0, 1, 1785585600000, 1786174200000),
  ('session-redteam', 'event-aie-2026', 'proposal-3', 'proposal',
   'Red-team your tool-using model', 'Hands-on workshop.',
   'workshop', 180, '1.0', NULL,
   'track-evaluate', 'room-gallery', 1787937000000, 1787940600000, 'scheduled', NULL,
   'redteam-2026@conference-ops.example', 0, 1, 1785585600000, 1786174200000),
  ('session-unscheduled', 'event-aie-2026', 'proposal-4', 'proposal',
   'Designing the first ten minutes of an AI SDK', 'Developer experience case study.',
   'talk', NULL, NULL, NULL,
   'track-build', NULL, NULL, NULL, 'unscheduled', NULL,
   'dx-2026@conference-ops.example', 0, 1, 1785585600000, 1786174200000);

-- The curated fixture is already content-approved. Sessions created after
-- seeding receive no status row and remain private until an organizer grants
-- explicit approval.
INSERT OR REPLACE INTO session_content_status
  (session_id, event_id, status, created_at, updated_at)
SELECT id, event_id, 'approved', created_at, updated_at
FROM program_sessions
WHERE event_id = 'event-aie-2026';

INSERT OR REPLACE INTO session_speakers
  (session_id, speaker_profile_id)
VALUES
  ('session-opening', 'speaker-jon'),
  ('session-evals', 'speaker-marco'),
  ('session-redteam', 'speaker-priya'),
  ('session-unscheduled', 'speaker-jon');

INSERT OR REPLACE INTO file_requests
  (id, event_id, title, instructions_html, target_type, required, status, created_at, updated_at)
VALUES
  ('file-request-slides', 'event-aie-2026', 'Upload final slides',
   '<p>Upload PDF or PPTX files only, with a 50 MB maximum per file. Production will review the latest response.</p>',
   'submission', 1, 'published', 1785585600000, 1786174200000);

INSERT OR REPLACE INTO task_templates
  (id, event_id, title, description, type, target_type, completion_mode,
   relative_due_days, form_version_id, file_request_id, created_at, updated_at)
VALUES
  ('template-profile', 'event-aie-2026', 'Confirm speaker profile',
   'Review your title, company, bio, and public headshot.', 'profile', 'contact',
   'manual', 7, NULL, NULL, 1785585600000, 1786174200000),
  ('template-slides', 'event-aie-2026', 'Upload final slides',
   'PDF or PPTX, maximum 50 MB.', 'upload', 'submission',
   'file_request', 14, NULL, 'file-request-slides', 1785585600000, 1786174200000),
  ('template-logistics', 'event-aie-2026', 'Workshop logistics',
   'Tell production what attendees need to bring and install.', 'form', 'submission',
   'form', 10, 'form-version-logistics-1', NULL, 1785585600000, 1786174200000),
  ('template-calendar', 'event-aie-2026', 'Accept calendar invitation',
   'Confirm the scheduled session time.', 'calendar', 'contact',
   'manual', 5, NULL, NULL, 1785585600000, 1786174200000),
  ('template-hotel', 'event-aie-2026', 'Hotel stay requirements',
   'Tell the event team whether you need a hotel stay and share arrival details.', 'form', 'contact',
   'form', 21, 'form-version-hotel-1', NULL, 1785585600000, 1786174200000),
  ('template-flight', 'event-aie-2026', 'Flight reimbursement',
   'Share the itinerary and reimbursement details the event team needs.', 'form', 'contact',
   'form', 18, 'form-version-flight-1', NULL, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO speaker_tasks
  (id, event_id, template_id, speaker_profile_id, proposal_id, title, description, type,
   status, artifact_upload_id, due_at, completed_at, created_at, updated_at)
VALUES
  ('task-1', 'event-aie-2026', 'template-profile', 'speaker-marco', NULL,
   'Confirm speaker profile', 'Review your title, company, bio, and public headshot.',
   'profile', 'complete', NULL, 1786838340000, 1786174200000, 1785585600000, 1786174200000),
  ('task-2', 'event-aie-2026', 'template-slides', 'speaker-marco', 'proposal-1',
   'Upload final slides', 'PDF or PPTX, maximum 50 MB.',
   'upload', 'in_progress', NULL, 1787615940000, NULL, 1785585600000, 1786174200000),
  ('task-3', 'event-aie-2026', 'template-logistics', 'speaker-priya', 'proposal-3',
   'Workshop logistics', 'Tell production what attendees need to bring and install.',
   'form', 'not_started', NULL, 1787097540000, NULL, 1785585600000, 1786174200000),
  ('task-4', 'event-aie-2026', 'template-profile', 'speaker-leah', NULL,
   'Complete public profile', 'Add a bio and upload a headshot.',
   'profile', 'overdue', NULL, 1786597140000, NULL, 1785585600000, 1786174200000),
  ('task-5', 'event-aie-2026', 'template-calendar', 'speaker-priya', NULL,
   'Accept calendar invitation', 'Confirm the scheduled workshop time.',
   'calendar', 'not_started', NULL, 1787270340000, NULL, 1785585600000, 1786174200000),
  ('task-6', 'event-aie-2026', 'template-slides', 'speaker-jon', 'proposal-4',
   'Upload final slides', 'This session will not use slides.',
   'upload', 'waived', NULL, 1787615940000, 1786174200000, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO task_responses
  (id, task_id, respondent_user_id, responses, status, submitted_at, created_at, updated_at)
VALUES
  ('task-response-logistics', 'task-3', 'user-organizer',
   '{"field-layout":"Classroom","field-installs":"Laptop, current browser, and a GitHub account.","field-network":"Reliable Wi-Fi and power for each pair."}',
   'draft', NULL, 1786174200000, 1786174200000);

INSERT OR REPLACE INTO resource_pages
  (id, event_id, title, slug, summary, sanitized_html, embed_url, status, created_at, updated_at)
VALUES
  ('resource-1', 'event-aie-2026', 'Speaker field guide', 'speaker-field-guide',
   'Travel, arrival, green room, A/V, and day-of contacts.',
   '<h2>Arrival</h2><p>Check in at the green room 30 minutes before your session.</p>',
   NULL, 'published', 1785585600000, 1786087200000),
  ('resource-2', 'event-aie-2026', 'Slide and recording policy', 'slides-recording',
   'File formats, licenses, recording consent, and release timeline.',
   '<h2>Slides</h2><p>Submit an accessible PDF or PPTX before the deadline.</p>',
   NULL, 'published', 1785585600000, 1785979200000),
  ('resource-3', 'event-aie-2026', 'Workshop production checklist', 'workshop-production',
   'Room setup, Wi-Fi, power, helpers, and attendee prerequisites.',
   '<p>Production checklist draft.</p>', NULL, 'draft', 1785585600000, 1786170600000);

INSERT OR REPLACE INTO embeds
  (id, event_id, name, format, enabled, theme, filters, created_at, updated_at)
VALUES
  ('embed-agenda', 'event-aie-2026', 'Public agenda', 'agenda', 1, 'light',
   '{"tracks":["track-build","track-operate","track-evaluate"],"statuses":["published","scheduled"]}',
   1785585600000, 1786173300000),
  ('embed-speakers', 'event-aie-2026', 'Speaker gallery', 'speaker_gallery', 1, 'light',
   '{"published":["true"]}', 1785585600000, 1786173360000),
  ('embed-evaluate-dark', 'event-aie-2026', 'Evaluation track', 'agenda', 0, 'dark',
   '{"tracks":["track-evaluate"]}', 1785585600000, 1786173360000);

INSERT OR REPLACE INTO message_templates
  (id, event_id, kind, name, subject, html, text, created_at, updated_at)
VALUES
  ('message-session-scheduled', 'event-aie-2026', 'calendar', 'Session scheduled',
   'Your {{event.name}} session is scheduled',
   '<p>Hi {{speaker.name}},</p><p>Your session <strong>{{session.title}}</strong> now has a time and room. An updated calendar invitation is attached.</p>',
   'Hi {{speaker.name}}, your session {{session.title}} now has a time and room. An updated calendar invitation is attached.',
   1785585600000, 1786174200000),
  ('message-confirmation', 'event-aie-2026', 'submission_confirmation', 'Submission confirmation',
   'We received your {{event.name}} proposal',
   '<p>Hi {{speaker.name}},</p><p>Your proposal is in the review queue.</p><p><a href="{{speaker.portal_url}}">Open your portal</a></p>',
   'Hi {{speaker.name}}, your proposal is in the review queue. Open your portal: {{speaker.portal_url}}',
   1785585600000, 1786174200000),
  ('message-acceptance', 'event-aie-2026', 'acceptance', 'Acceptance decision',
   'You are speaking at {{event.name}}',
   '<p>Hi {{speaker.name}},</p><p>Your proposal <strong>{{proposal.title}}</strong> has been accepted.</p><p><a href="{{speaker.portal_url}}">Open onboarding</a></p><p>{{decision.feedback}}</p>',
   'Hi {{speaker.name}}, your proposal {{proposal.title}} has been accepted. Open onboarding: {{speaker.portal_url}}. {{decision.feedback}}',
   1785585600000, 1786174200000),
  ('message-rejection', 'event-aie-2026', 'rejection', 'Decline decision',
   'Your {{event.name}} proposal',
   '<p>Hi {{speaker.name}},</p><p>Thank you for submitting <strong>{{proposal.title}}</strong>. We are not able to include it in this program.</p><p>{{decision.feedback}}</p>',
   'Hi {{speaker.name}}, thank you for submitting {{proposal.title}}. We are not able to include it in this program. {{decision.feedback}}',
   1785585600000, 1786174200000),
  ('message-reminder', 'event-aie-2026', 'reminder', 'Speaker task reminder',
   'Speaker tasks due · {{event.name}}',
   '<p>Hi {{speaker.name}},</p><p>You have {{task.count}} outstanding speaker task(s).</p><p><a href="{{speaker.portal_url}}">Open your portal</a></p>',
   'Hi {{speaker.name}}, you have {{task.count}} outstanding speaker task(s). Open your portal: {{speaker.portal_url}}',
   1785585600000, 1786174200000);

INSERT OR REPLACE INTO communication_schedules
  (id, event_id, kind, enabled, offset_days, last_run_at, created_at, updated_at)
VALUES
  ('schedule-cfp-draft', 'event-aie-2026', 'cfp_draft', 1, 2, NULL, 1785585600000, 1786174200000),
  ('schedule-task-overdue', 'event-aie-2026', 'task_overdue', 1, 2, NULL, 1785585600000, 1786174200000);

-- A historical sent item demonstrates outbox visibility without creating an
-- email, calendar, or integration side effect when the demo seed is applied.
INSERT OR REPLACE INTO outbox
  (id, event_id, kind, idempotency_key, payload, status, attempts, available_at,
   last_error, sent_at, created_at, updated_at)
VALUES
  ('outbox-demo-sent', 'event-aie-2026', 'email', 'demo:session-evals:scheduled:v1',
   '{"kind":"communication","recipient":"marco@example.com","subject":"Your session is scheduled"}',
   'sent', 1, 1786170600000, NULL, 1786170660000, 1786170600000, 1786170660000);

INSERT OR REPLACE INTO integration_sync_records
  (id, event_id, provider, entity_type, local_id, remote_id, payload_hash,
   status, last_error, synced_at, created_at, updated_at)
VALUES
  ('sync-session-evals', 'event-aie-2026', 'accelevents', 'session', 'session-evals',
   'ae-session-19021', 'sha256:demo-evals-v1', 'synced', NULL,
   1786170660000, 1785585600000, 1786170660000),
  ('sync-speaker-priya', 'event-aie-2026', 'accelevents', 'speaker', 'speaker-priya',
   NULL, 'sha256:demo-priya-v1', 'manual_action',
   'API access unavailable; export the organizer CSV and record the remote ID after import.',
   NULL, 1785585600000, 1786174200000);

INSERT OR REPLACE INTO audit_logs
  (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id,
   summary, metadata, request_id, created_at)
VALUES
  ('audit-1', 'org-aie', 'event-aie-2026', 'user-organizer', 'proposal.accepted',
   'proposal', 'proposal-1', 'The eval flywheel that caught our agent regressions',
   '{"from":"accept_queue","to":"accepted"}', 'demo-request-1', 1786173900000),
  ('audit-2', 'org-aie', 'event-aie-2026', 'user-applicant', 'proposal.submitted',
   'proposal', 'proposal-2', 'Observability for agents that run all afternoon',
   '{"version":1}', 'demo-request-2', 1786169400000),
  ('audit-3', 'org-aie', 'event-aie-2026', NULL, 'task.overdue',
   'speaker_task', 'task-4', 'Complete public profile · Leah Okafor',
   '{"dueAt":1786597140000}', 'demo-request-3', 1786165200000),
  ('audit-4', 'org-aie', 'event-aie-2026', 'user-organizer', 'form.draft_saved',
   'submission_form', 'form-main-cfp', 'Unpublished CFP version 3 saved',
   '{"currentVersion":3,"publishedVersion":2}', 'demo-request-4', 1786174200000);
