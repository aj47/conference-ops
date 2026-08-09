import type {
  Actor,
  FormDefinition,
  WorkspaceSnapshot,
} from "./domain";
import { defaultFormVersionSettings } from "./form-settings";

export const defaultReviewRubric = [
  { id: "relevance", label: "Audience relevance", description: "Right problem for this program", weight: 2, maxScore: 5 },
  { id: "evidence", label: "Evidence and specificity", description: "Concrete proof, demo, or field lesson", weight: 3, maxScore: 5 },
  { id: "delivery", label: "Likely delivery quality", description: "The proposal supports a clear attendee outcome", weight: 1, maxScore: 5 },
  { id: "confidence", label: "Decision confidence", description: "How confidently would you advance this proposal?", type: "dropdown" as const, options: ["High", "Medium", "Low"], weight: 1, maxScore: 5, required: false },
  { id: "evidence-note", label: "Evidence to revisit", description: "Optional context for the committee discussion", type: "text" as const, weight: 1, maxScore: 5, required: false },
];

export const demoActors: Actor[] = [
  { id: "user-organizer", name: "Maya Chen", email: "maya@aiengineer.events", role: "organizer" },
  { id: "user-reviewer", name: "Dev Patel", email: "dev@aiengineer.events", role: "reviewer" },
  { id: "user-applicant", name: "Leah Okafor", email: "leah@example.com", role: "applicant" },
  { id: "user-speaker", name: "Marco Ruiz", email: "marco@example.com", role: "speaker" },
];

export const defaultForm: FormDefinition = {
  id: "form-main-cfp",
  eventId: "event-aie-2026",
  name: "AI Engineer Summit 2026 CFP",
  publicTitle: "Call for Speakers · AI Engineer Summit 2026",
  pageHeading: "Apply",
  version: 3,
  publishedVersion: 3,
  status: "published",
  kind: "cfp",
  targetType: "submission",
  submissionType: "abstract",
  collectsParticipants: true,
  welcomeTitle: "Bring the work behind the breakthrough",
  welcomeCopy:
    "We want practical stories from people shipping AI systems. Share the decisions, failures, and evidence your peers can use on Monday.",
  confirmationCopy:
    "Your proposal is in. You can return to revise it until the call closes, and we will email you when review begins.",
  maxSpeakers: 4,
  maxSubmissionsPerUser: 3,
  closesAt: "2026-08-13T05:00:00.000Z",
  redirectToPortal: true,
  confirmationEmailEnabled: true,
  allowMultipleDrafts: true,
  settings: defaultFormVersionSettings,
  submissions: 84,
  updatedAt: "2026-08-08T07:30:00.000Z",
  fields: [
    { id: "field-title", label: "Session title", type: "short_text", required: true, description: "Clear, specific, and under 100 characters." },
    { id: "field-summary", label: "Abstract", type: "long_text", required: true, description: "What will attendees learn, and what evidence will you share?" },
    { id: "field-category", label: "Program category", type: "select", required: true, options: ["Agents in production", "Model infrastructure", "Evaluation & safety", "Developer experience"] },
    { id: "field-format", label: "Preferred format", type: "select", required: true, options: ["Talk", "Workshop", "Panel", "Lightning talk"] },
    { id: "field-repo", label: "Relevant project or repository", type: "url", required: false },
    {
      id: "field-workshop-needs",
      label: "Workshop setup requirements",
      type: "long_text",
      required: true,
      condition: { sourceFieldId: "field-format", operator: "equals", value: "Workshop" },
    },
  ],
};

export function createDemoWorkspace(actorId = "user-organizer"): WorkspaceSnapshot {
  const actor = demoActors.find((candidate) => candidate.id === actorId) ?? demoActors[0];
  const speakers = {
    marco: { id: "speaker-marco", name: "Marco Ruiz", email: "marco@example.com", title: "Staff AI Engineer", company: "Northstar", bio: "Builds reliable agent systems and the evaluation loops that keep them honest.", city: "Austin, TX", profileComplete: true },
    leah: { id: "speaker-leah", name: "Leah Okafor", email: "leah@example.com", title: "Founder", company: "Tracewell", bio: "Works on observability for long-running AI workflows.", city: "London, UK", profileComplete: false },
    priya: { id: "speaker-priya", name: "Priya Nair", email: "priya@example.com", title: "Research Engineer", company: "Cedar Labs", bio: "Researches evaluation methods for tool-using models.", city: "Toronto, CA", profileComplete: true },
    jon: { id: "speaker-jon", name: "Jon Bell", email: "jon@example.com", title: "Developer Advocate", company: "Patchwork", bio: "Teaches teams how to debug and ship AI products.", city: "Seattle, WA", profileComplete: true },
  };

  const workspace: WorkspaceSnapshot = {
    demoMode: true,
    actor,
    actors: demoActors,
    event: {
      id: "event-aie-2026",
      slug: "ai-engineer-summit-2026",
      name: "AI Engineer Summit 2026",
      shortName: "AIE 2026",
      description: "A working conference for people building, evaluating, and operating AI systems.",
      timezone: "America/Los_Angeles",
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-30T01:00:00.000Z",
      venue: "Fort Mason Center, San Francisco",
      websiteUrl: "https://example.com/ai-engineer-summit",
      status: "review",
      cfpClosesAt: "2026-08-13T05:00:00.000Z",
      accent: "#e05b3f",
    },
    forms: [defaultForm, { ...defaultForm, id: "form-lightning", name: "Lightning talk late submissions", version: 1, status: "draft", submissions: 0, fields: defaultForm.fields.slice(0, 4) }],
    proposals: [
      { id: "proposal-1", eventId: "event-aie-2026", title: "The eval flywheel that caught our agent regressions", summary: "A field report on turning traces into targeted evals, release gates, and weekly product decisions.", category: "Evaluation & safety", format: "talk", durationMinutes: 30, level: "intermediate", status: "accepted", speakers: [speakers.marco], submittedAt: "2026-08-04T18:20:00.000Z", score: 4.7, reviewCount: 3, reviewerGroup: "Evaluation committee", tags: ["evals", "production"] },
      { id: "proposal-2", eventId: "event-aie-2026", title: "Observability for agents that run all afternoon", summary: "How we model progress, retries, handoffs, and failure without drowning operators in traces.", category: "Agents in production", format: "talk", durationMinutes: 30, level: "advanced", status: "under_review", speakers: [speakers.leah], submittedAt: "2026-08-06T10:15:00.000Z", score: 4.3, reviewCount: 2, reviewerGroup: "Agent systems committee", tags: ["agents", "observability"] },
      { id: "proposal-3", eventId: "event-aie-2026", title: "Red-team your tool-using model", summary: "A hands-on lab for generating adversarial tool calls and converting incidents into repeatable tests.", category: "Evaluation & safety", format: "workshop", durationMinutes: 60, level: "intermediate", status: "accepted", speakers: [speakers.priya], submittedAt: "2026-08-03T15:40:00.000Z", score: 4.8, reviewCount: 3, reviewerGroup: "Evaluation committee", tags: ["security", "workshop"] },
      { id: "proposal-4", eventId: "event-aie-2026", title: "Designing the first ten minutes of an AI SDK", summary: "What developer interviews taught us about quickstarts, errors, and examples.", category: "Developer experience", format: "talk", durationMinutes: 25, level: "introductory", status: "waitlisted", speakers: [speakers.jon], submittedAt: "2026-08-05T20:00:00.000Z", score: 4.0, reviewCount: 3, reviewerGroup: "DX committee", tags: ["DX", "SDK"] },
      { id: "proposal-5", eventId: "event-aie-2026", title: "Serving small models at the edge", summary: "Latency and cost lessons from routing compact models near users.", category: "Model infrastructure", format: "lightning", durationMinutes: 10, level: "intermediate", status: "submitted", speakers: [speakers.marco], submittedAt: "2026-08-08T04:10:00.000Z", reviewCount: 0, reviewerGroup: "Infrastructure committee", tags: ["edge", "latency"] },
    ],
    reviews: [
      { id: "review-1", proposalId: "proposal-2", reviewerId: "user-reviewer", round: 1, roundName: "Program review", status: "in_progress", rubric: defaultReviewRubric, scores: { relevance: 5, evidence: 4, delivery: 4, confidence: "High", "evidence-note": "Confirm the failure story before final selection." }, score: 4.33, recommendation: "yes", notes: "Strong operational detail; ask for a clearer failure story.", anonymized: true },
      { id: "review-2", proposalId: "proposal-5", reviewerId: "user-reviewer", round: 1, roundName: "Program review", status: "pending", rubric: defaultReviewRubric, scores: {}, anonymized: true },
    ],
    tasks: [
      { id: "task-1", eventId: "event-aie-2026", speakerId: "speaker-marco", title: "Confirm speaker profile", description: "Review your title, company, bio, and public headshot.", dueAt: "2026-08-15T23:59:00.000Z", status: "complete", type: "profile" },
      { id: "task-2", eventId: "event-aie-2026", speakerId: "speaker-marco", proposalId: "proposal-1", targetTitle: "The eval flywheel that caught our agent regressions", title: "Upload final slides", description: "PDF or PPTX, maximum 50 MB.", dueAt: "2026-08-24T23:59:00.000Z", status: "in_progress", type: "upload" },
      { id: "task-3", eventId: "event-aie-2026", speakerId: "speaker-priya", proposalId: "proposal-3", targetTitle: "Red-team your tool-using model", title: "Workshop logistics", description: "Tell production what attendees need to bring and install.", dueAt: "2026-08-18T23:59:00.000Z", status: "not_started", type: "form", formId: "form-logistics" },
      { id: "task-4", eventId: "event-aie-2026", speakerId: "speaker-leah", title: "Complete public profile", description: "Add a bio and upload a headshot.", dueAt: "2026-08-13T23:59:00.000Z", status: "overdue", type: "profile" },
      { id: "task-5", eventId: "event-aie-2026", speakerId: "speaker-priya", title: "Accept calendar invitation", description: "Open the speaker calendar, confirm the scheduled workshop time, then mark this task complete.", dueAt: "2026-08-20T23:59:00.000Z", status: "not_started", type: "calendar", completionMode: "manual", externalUrl: "https://example.com/ai-engineer-summit/speaker-calendar" },
    ],
    tracks: [
      { id: "track-build", name: "Build", color: "#2d6a6c" },
      { id: "track-operate", name: "Operate", color: "#b44932" },
      { id: "track-evaluate", name: "Evaluate", color: "#7564a8" },
    ],
    rooms: [
      { id: "room-cowell", name: "Cowell Theater", capacity: 420 },
      { id: "room-gallery", name: "Gallery 308", capacity: 180 },
      { id: "room-firehouse", name: "Firehouse", capacity: 90 },
    ],
    sessions: [
      { id: "session-opening", eventId: "event-aie-2026", origin: "direct_program", title: "Opening call", description: "What we are here to build together.", speakerIds: ["speaker-jon"], speakerNames: ["Jon Bell"], trackId: "track-build", roomId: "room-cowell", startsAt: "2026-08-28T16:00:00.000Z", endsAt: "2026-08-28T16:20:00.000Z", status: "published" },
      { id: "session-evals", eventId: "event-aie-2026", proposalId: "proposal-1", title: "The eval flywheel that caught our agent regressions", description: "A production case study.", speakerIds: ["speaker-marco"], speakerNames: ["Marco Ruiz"], trackId: "track-evaluate", roomId: "room-cowell", startsAt: "2026-08-28T16:30:00.000Z", endsAt: "2026-08-28T17:00:00.000Z", status: "published" },
      { id: "session-redteam", eventId: "event-aie-2026", proposalId: "proposal-3", title: "Red-team your tool-using model", description: "Hands-on workshop.", speakerIds: ["speaker-priya"], speakerNames: ["Priya Nair"], trackId: "track-evaluate", roomId: "room-gallery", startsAt: "2026-08-28T17:10:00.000Z", endsAt: "2026-08-28T18:10:00.000Z", status: "published" },
      { id: "session-unscheduled", eventId: "event-aie-2026", proposalId: "proposal-4", title: "Designing the first ten minutes of an AI SDK", description: "Developer experience case study.", speakerIds: ["speaker-jon"], speakerNames: ["Jon Bell"], status: "unscheduled" },
    ],
    resources: [
      { id: "resource-1", title: "Speaker field guide", slug: "speaker-field-guide", status: "published", summary: "Travel, arrival, green room, A/V, and day-of contacts.", body: "Arrive at Fort Mason Center 45 minutes before your session. Speaker check-in is inside the Cowell Theater lobby.\n\nThe green room has water, power, and a quiet preparation area. Bring your final deck on a USB drive as a backup; production will have the version uploaded through your task portal.", linkUrl: "https://example.com/ai-engineer-summit", updatedAt: "2026-08-07T18:00:00.000Z" },
      { id: "resource-2", title: "Slide and recording policy", slug: "slides-recording", status: "published", summary: "File formats, licenses, recording consent, and release timeline.", body: "Upload PDF or PowerPoint files through the Slides task in your portal. The recording team will confirm consent on site before your session.\n\nPublished recordings include the session title, speaker profile, and event branding. Contact the program team before the event if any material must be removed from the public recording.", updatedAt: "2026-08-06T12:00:00.000Z" },
      { id: "resource-3", title: "Workshop production checklist", slug: "workshop-production", status: "draft", summary: "Room setup, Wi-Fi, power, helpers, and attendee prerequisites.", body: "Confirm table layout, power requirements, attendee software, helper count, and any downloadable materials before publishing this guide.", updatedAt: "2026-08-08T06:30:00.000Z" },
    ],
    embeds: [
      { id: "embed-agenda", name: "Public agenda", eventId: "event-aie-2026", format: "agenda", enabled: true, theme: "light", updatedAt: "2026-08-08T07:15:00.000Z" },
      { id: "embed-speakers", name: "Speaker gallery", eventId: "event-aie-2026", format: "speaker_gallery", enabled: true, theme: "light", updatedAt: "2026-08-08T07:16:00.000Z" },
    ],
    reviewerGroups: [
      { id: "group-agents", name: "Agents committee", category: "Agents in production", reviewerIds: ["user-reviewer"] },
      { id: "group-infra", name: "Infrastructure committee", category: "Model infrastructure", reviewerIds: ["user-reviewer"] },
      { id: "group-eval", name: "Evaluation committee", category: "Evaluation & safety", reviewerIds: ["user-reviewer"] },
      { id: "group-dx", name: "DX committee", category: "Developer experience", reviewerIds: [] },
    ],
    taskTemplates: [
      { id: "template-profile", title: "Confirm speaker profile", description: "Review your title, company, bio, and public headshot.", type: "profile", targetType: "contact", completionMode: "manual", relativeDueDays: 14 },
      { id: "template-hotel", title: "Hotel stay requirements", description: "Tell the event team whether you need a hotel stay and share arrival details.", type: "form", targetType: "contact", completionMode: "form", relativeDueDays: 21, formId: "form-hotel", formFields: [
        { id: "hotel-needed", label: "Do you need an event-provided hotel stay?", type: "checkbox", required: true, section: "proposal" },
        { id: "hotel-arrival", label: "Expected arrival date", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "hotel-needed", operator: "equals", value: "true" } },
        { id: "hotel-notes", label: "Accessibility or room notes", type: "long_text", required: false, section: "proposal" },
      ] },
      { id: "template-flight", title: "Flight reimbursement", description: "Share the itinerary and reimbursement details the event team needs.", type: "form", targetType: "contact", completionMode: "form", relativeDueDays: 18, formId: "form-flight", formFields: [
        { id: "flight-needed", label: "Will you request flight reimbursement?", type: "checkbox", required: true, section: "proposal" },
        { id: "flight-origin", label: "Departure city or airport", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "flight-needed", operator: "equals", value: "true" } },
        { id: "flight-estimate", label: "Estimated round-trip cost", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "flight-needed", operator: "equals", value: "true" } },
      ] },
      { id: "template-slides", title: "Upload final slides", description: "PDF or PPTX, maximum 50 MB.", type: "upload", targetType: "submission", completionMode: "file_request", relativeDueDays: 7, fileRequestId: "request-slides" },
      { id: "template-calendar", title: "Accept calendar invitation", description: "Open the speaker calendar, confirm the scheduled session time, then mark this task complete.", type: "calendar", targetType: "contact", completionMode: "manual", relativeDueDays: 5, externalUrl: "https://example.com/ai-engineer-summit/speaker-calendar" },
    ],
    messageTemplates: [
      { id: "message-confirmation", kind: "submission_confirmation", name: "Submission confirmation", subject: "We received your {{event.name}} proposal", html: "<p>Hi {{speaker.name}},</p><p>Your proposal <strong>{{proposal.title}}</strong> is in the review queue.</p><p><a href=\"{{speaker.portal_url}}\">Open your portal</a></p>", text: "Hi {{speaker.name}}, your proposal {{proposal.title}} is in the review queue. Open your portal: {{speaker.portal_url}}", updatedAt: "2026-08-08T07:17:00.000Z" },
      { id: "message-acceptance", kind: "acceptance", name: "Acceptance", subject: "You're speaking at {{event.name}}", html: "<p>Hi {{speaker.name}},</p><p>Your proposal <strong>{{proposal.title}}</strong> has been accepted.</p><p><a href=\"{{speaker.portal_url}}\">Open onboarding</a></p><p>{{decision.feedback}}</p>", text: "Hi {{speaker.name}}, your proposal {{proposal.title}} has been accepted. Open onboarding: {{speaker.portal_url}}. {{decision.feedback}}", updatedAt: "2026-08-08T07:17:00.000Z" },
      { id: "message-rejection", kind: "rejection", name: "Decision: not selected", subject: "Your {{event.name}} proposal", html: "<p>Hi {{speaker.name}},</p><p>Thank you for submitting <strong>{{proposal.title}}</strong>. We are not able to include it in this program.</p><p>{{decision.feedback}}</p>", text: "Hi {{speaker.name}}, thank you for submitting {{proposal.title}}. We are not able to include it in this program. {{decision.feedback}}", updatedAt: "2026-08-08T07:17:00.000Z" },
      { id: "message-reminder", kind: "reminder", name: "Onboarding reminder", subject: "Speaker tasks for {{event.name}}", html: "<p>Hi {{speaker.name}},</p><p>You have {{task.count}} outstanding speaker task(s).</p><p><a href=\"{{speaker.portal_url}}\">Open your portal</a></p>", text: "Hi {{speaker.name}}, you have {{task.count}} outstanding speaker task(s). Open your portal: {{speaker.portal_url}}", updatedAt: "2026-08-08T07:17:00.000Z" },
      { id: "message-calendar", kind: "calendar", name: "Calendar invitation", subject: "Your {{event.name}} session is scheduled", html: "<p>Hi {{speaker.name}},</p><p>Your session <strong>{{session.title}}</strong> is scheduled in {{session.room}}. The calendar invitation is attached.</p>", text: "Hi {{speaker.name}}, your session {{session.title}} is scheduled in {{session.room}}. The calendar invitation is attached.", updatedAt: "2026-08-08T07:17:00.000Z" },
    ],
    reminderRules: [
      { id: "schedule-cfp-draft", kind: "cfp_draft", enabled: true, offsetDays: 2, updatedAt: "2026-08-08T07:17:00.000Z" },
      { id: "schedule-task-overdue", kind: "task_overdue", enabled: true, offsetDays: 2, updatedAt: "2026-08-08T07:17:00.000Z" },
    ],
    activity: [
      { id: "activity-1", actor: "Maya Chen", action: "accepted", target: "The eval flywheel that caught our agent regressions", at: "2026-08-08T07:45:00.000Z", tone: "positive" },
      { id: "activity-2", actor: "Leah Okafor", action: "submitted", target: "Observability for agents that run all afternoon", at: "2026-08-08T06:10:00.000Z", tone: "neutral" },
      { id: "activity-3", actor: "Conference Ops", action: "flagged overdue task", target: "Complete public profile · Leah Okafor", at: "2026-08-08T05:00:00.000Z", tone: "warning" },
    ],
  };
  if (actor.role === "reviewer") {
    const reviews = workspace.reviews.filter((review) => review.reviewerId === actor.id);
    const assignedProposalIds = new Set(reviews.map((review) => review.proposalId));
    return {
      ...workspace,
      proposals: workspace.proposals.filter((proposal) => assignedProposalIds.has(proposal.id)),
      reviews,
    };
  }
  return workspace;
}
