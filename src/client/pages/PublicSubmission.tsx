import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  Info,
  LockKeyhole,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { FormField } from "../../shared/domain";
import { Field, InlineAlert, NoticeRegion, ProgressBar } from "../components";
import { PublicHeader } from "../Shell";
import { type ApplicantSubmission, useWorkspace } from "../workspace";

const wizardSteps = [
  { id: "welcome", label: "Welcome", icon: BookOpen },
  { id: "account", label: "Account", icon: LockKeyhole },
  { id: "submission", label: "Submission", icon: FileText },
  { id: "participant", label: "Participant", icon: UserRound },
  { id: "review", label: "Review", icon: FileCheck2 },
] as const;

const blankSubmission: ApplicantSubmission = {
  title: "",
  summary: "",
  category: "Agents in production",
  format: "talk",
  level: "intermediate",
  repoUrl: "",
  workshopNeeds: "",
  responses: {},
  speaker: { firstName: "", lastName: "", email: "", title: "", company: "", bio: "" },
};

function formatDeadline(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone, timeZoneName: "short" }).format(new Date(value));
}

type FormSection = "proposal" | "participant";

function isCanonicalField(field: FormField, section: FormSection) {
  const label = field.label.trim().toLowerCase();
  if (section === "proposal") {
    return field.id === "field-title"
      || field.id === "field-summary"
      || field.id === "field-category"
      || field.id === "field-format"
      || field.id === "field-repo"
      || field.id === "field-workshop-needs"
      || [
        "title",
        "session title",
        "proposal title",
        "abstract",
        "proposal summary",
        "session summary",
        "category",
        "program category",
        "program lane",
        "format",
        "preferred format",
        "session format",
        "project or repository",
        "relevant project or repository",
        "project url",
        "repository url",
        "workshop needs",
        "workshop requirements",
        "workshop setup requirements",
      ].includes(label);
  }
  return field.id === "speaker-first"
    || field.id === "speaker-last"
    || field.id === "speaker-email"
    || field.id === "speaker-bio"
    || field.id === "speaker-title"
    || field.id === "speaker-company"
    || [
      "first name",
      "last name",
      "email",
      "email address",
      "contact email",
      "speaker email",
      "biography",
      "bio",
      "speaker bio",
      "company",
      "company / affiliation",
      "affiliation",
      "organization",
      "role",
      "role or title",
      "job title",
      "speaker title",
    ].includes(label);
}

function answerForField(field: FormField, section: FormSection, submission: ApplicantSubmission): unknown {
  if (!isCanonicalField(field, section)) return submission.responses[field.id];
  const label = field.label.trim().toLowerCase();
  if (section === "proposal") {
    if (field.id === "field-title" || ["title", "session title", "proposal title"].includes(label)) return submission.title;
    if (field.id === "field-summary" || ["abstract", "proposal summary", "session summary"].includes(label)) return submission.summary;
    if (field.id === "field-category" || ["category", "program category", "program lane"].includes(label)) return submission.category;
    if (field.id === "field-format" || ["format", "preferred format", "session format"].includes(label)) {
      const label = submission.format === "lightning" ? "Lightning talk" : `${submission.format[0].toUpperCase()}${submission.format.slice(1)}`;
      return field.options?.find((option) => option.toLowerCase() === label.toLowerCase()) ?? label;
    }
    if (field.id === "field-repo" || ["project or repository", "relevant project or repository", "project url", "repository url"].includes(label)) return submission.repoUrl;
    return submission.workshopNeeds;
  }
  if (field.id === "speaker-first" || label === "first name") return submission.speaker.firstName;
  if (field.id === "speaker-last" || label === "last name") return submission.speaker.lastName;
  if (field.id === "speaker-email" || ["email", "email address", "contact email", "speaker email"].includes(label)) return submission.speaker.email;
  if (field.id === "speaker-bio" || ["biography", "bio", "speaker bio"].includes(label)) return submission.speaker.bio;
  if (["company", "company / affiliation", "affiliation", "organization"].includes(label)) return submission.speaker.company;
  return submission.speaker.title;
}

function formResponses(proposalFields: FormField[], participantFields: FormField[], submission: ApplicantSubmission) {
  const responses = { ...submission.responses };
  for (const field of proposalFields) responses[field.id] = answerForField(field, "proposal", submission);
  for (const field of participantFields) responses[field.id] = answerForField(field, "participant", submission);
  return responses;
}

function isFieldVisible(field: FormField, responses: Record<string, unknown>) {
  if (!field.condition) return true;
  const source = responses[field.condition.sourceFieldId];
  if (field.condition.operator === "equals") return String(source ?? "") === field.condition.value;
  if (Array.isArray(source)) return source.some((value) => String(value).includes(field.condition!.value));
  return String(source ?? "").includes(field.condition.value);
}

function hasAnswer(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return value !== undefined && value !== null;
}

function validateCustomFields(fields: FormField[], responses: Record<string, unknown>) {
  const next: Record<string, string> = {};
  for (const field of fields) {
    if (!isFieldVisible(field, responses)) continue;
    const value = responses[field.id];
    if (field.type === "file") {
      if (field.required) next[field.id] = "This required upload is not available here yet. Contact the organizer before continuing.";
      continue;
    }
    if (field.required && !hasAnswer(value)) {
      next[field.id] = `${field.label} is required.`;
      continue;
    }
    if (!hasAnswer(value)) continue;
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) next[field.id] = "Enter a valid email address.";
    if (field.type === "url") {
      try {
        const url = new URL(String(value));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        next[field.id] = "Enter a full http:// or https:// URL.";
      }
    }
    if ((field.type === "select" || field.type === "multi_select") && field.options) {
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      if (values.some((item) => !field.options!.includes(item))) next[field.id] = "Choose one of the available options.";
    }
  }
  return next;
}

function answerLabel(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "Not supplied");
}

function CustomField({ field, value, error, onChange }: { field: FormField; value: unknown; error?: string; onChange: (value: unknown) => void }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const hint = field.description || (field.type === "multi_select" ? "Use Command or Control to select more than one option." : undefined);
  if (field.type === "checkbox") {
    return <label className={`check-row${error ? " check-row--error" : ""}`}><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong>{field.description && <small>{field.description}</small>}{error && <b>{error}</b>}</span></label>;
  }
  if (field.type === "file") {
    const uploadHint = [field.description, "File uploads are not available in this submission form. Contact the organizer if this question is required."].filter(Boolean).join(" ");
    return <Field label={label} hint={uploadHint} error={error}><input type="file" disabled aria-label={`${field.label} unavailable`} /></Field>;
  }
  if (field.type === "long_text") {
    return <Field label={label} hint={hint} error={error}><textarea rows={5} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></Field>;
  }
  if (field.type === "select") {
    return <Field label={label} hint={hint} error={error}><select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}><option value="">Select an option</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>;
  }
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return <Field label={label} hint={hint} error={error}><select multiple size={Math.min(5, Math.max(2, field.options?.length ?? 2))} value={selected} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>;
  }
  return <Field label={label} hint={hint} error={error}><input type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></Field>;
}

export function PublicSubmissionWizard() {
  const { workspace, builder: draftBuilder, publicBuilder, submitProposal } = useWorkspace();
  const [searchParams] = useSearchParams();
  const previewingDraft = searchParams.get("preview") === "draft";
  const builder = previewingDraft ? draftBuilder : publicBuilder;
  const [step, setStep] = useState(0);
  const [accountReady, setAccountReady] = useState(false);
  const [submission, setSubmission] = useState<ApplicantSubmission>(() => {
    try {
      const stored = window.localStorage.getItem("conference-ops-cfp-draft");
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ApplicantSubmission>;
        return {
          ...blankSubmission,
          ...parsed,
          responses: parsed.responses ?? {},
          speaker: { ...blankSubmission.speaker, ...parsed.speaker },
        };
      }
      return { ...blankSubmission, responses: {}, speaker: { ...blankSubmission.speaker, firstName: workspace.actor.role === "applicant" ? "Leah" : "", lastName: workspace.actor.role === "applicant" ? "Okafor" : "", email: workspace.actor.role === "applicant" ? workspace.actor.email : "" } };
    } catch { return blankSubmission; }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const visibleSteps = builder.collectParticipants ? wizardSteps : wizardSteps.filter((item) => item.id !== "participant");
  const currentStep = visibleSteps[step];
  const participantFields = builder.collectParticipants ? builder.participantFields : [];
  const responses = formResponses(builder.proposalFields, participantFields, submission);
  const proposalCustomFields = builder.proposalFields.filter((field) => !isCanonicalField(field, "proposal"));
  const participantCustomFields = participantFields.filter((field) => !isCanonicalField(field, "participant"));
  const visibleProposalCustomFields = proposalCustomFields.filter((field) => isFieldVisible(field, responses));
  const visibleParticipantCustomFields = participantCustomFields.filter((field) => isFieldVisible(field, responses));
  const customLongTextCharacters = [...visibleProposalCustomFields, ...visibleParticipantCustomFields]
    .filter((field) => field.type === "long_text")
    .reduce((total, field) => {
      const value = responses[field.id];
      return total + (typeof value === "string" ? value.length : 0);
    }, 0);
  const combinedCharacters = submission.summary.length + submission.workshopNeeds.length + submission.speaker.bio.length + customLongTextCharacters;
  const customReviewFields = [
    ...proposalCustomFields.map((field) => ({ field, section: "proposal" as const })),
    ...participantCustomFields.map((field) => ({ field, section: "participant" as const })),
  ].filter(({ field }, index, fields) => field.type !== "file"
    && isFieldVisible(field, responses)
    && hasAnswer(responses[field.id])
    && fields.findIndex((candidate) => candidate.field.id === field.id) === index);
  const categoryField = builder.proposalFields.find((field) => /category|program lane/i.test(field.label));
  const categoryOptions = [...new Set([
    submission.category,
    ...(categoryField?.options ?? []),
    ...workspace.proposals.map((proposal) => proposal.category),
  ])].filter(Boolean);

  useEffect(() => {
    if (!submittedId || !builder.autoRedirect) return;
    const interval = window.setInterval(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearInterval(interval);
  }, [builder.autoRedirect, submittedId]);

  useEffect(() => {
    if (countdown <= 0 && submittedId) window.location.assign("/portal/home");
  }, [countdown, submittedId]);

  const saveDraft = () => {
    window.localStorage.setItem("conference-ops-cfp-draft", JSON.stringify(submission));
    setSavedAt(new Date());
  };

  const validateCurrent = () => {
    const next: Record<string, string> = {};
    if (currentStep.id === "account") {
      if (!submission.speaker.email.includes("@")) next.email = "Enter an email address we can use for your confirmation.";
      if (!accountReady) next.account = "Confirm that you can access this email address.";
    }
    if (currentStep.id === "submission") {
      if (submission.title.trim().length < 8) next.title = "Use at least 8 characters so the title is identifiable.";
      if (submission.summary.trim().length < 80) next.summary = "Give reviewers at least 80 characters of concrete context.";
      if (submission.format === "workshop" && submission.workshopNeeds.trim().length < 20) next.workshopNeeds = "Tell us what attendees need to bring or install.";
      if (combinedCharacters > builder.combinedCharacterLimit) next.summary = "The combined long-text limit has been exceeded.";
      Object.assign(next, validateCustomFields(proposalCustomFields, responses));
    }
    if (currentStep.id === "participant") {
      if (!submission.speaker.firstName.trim()) next.firstName = "First name is required.";
      if (!submission.speaker.lastName.trim()) next.lastName = "Last name is required.";
      if (!submission.speaker.title.trim()) next.speakerTitle = "Add a role or title for reviewer context.";
      if (!submission.speaker.company.trim()) next.company = "Add an organization or write Independent.";
      Object.assign(next, validateCustomFields(participantCustomFields, responses));
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateCurrent()) return;
    saveDraft();
    setStep((value) => Math.min(value + 1, visibleSteps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateSpeaker = (patch: Partial<ApplicantSubmission["speaker"]>) => setSubmission((current) => ({ ...current, speaker: { ...current.speaker, ...patch } }));
  const updateResponse = (fieldId: string, value: unknown) => {
    setSubmission((current) => ({ ...current, responses: { ...current.responses, [fieldId]: value } }));
    setErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };
  const stepIndex = (id: "submission" | "participant") => Math.max(0, visibleSteps.findIndex((item) => item.id === id));

  if (submittedId) {
    return (
      <div className="public-page">
        <PublicHeader active="cfp" />
        <main className="success-page">
          <span className="success-page__mark"><Check size={38} /></span>
          <p className="eyebrow">Submission {submittedId.slice(-8).toUpperCase()} received</p>
          <h1>You’re in the review queue.</h1>
          <p>{builder.successMessage}</p>
          <div className="success-receipt"><span><Mail size={18} /><span><strong>Confirmation queued</strong><small>{submission.speaker.email}</small></span></span><span><ShieldCheck size={18} /><span><strong>Draft locked to V{builder.version}</strong><small>Your answers remain editable until the deadline.</small></span></span></div>
          <div className="success-actions"><button type="button" className="button button--primary button--large" onClick={() => window.location.assign("/portal/home")}>Continue to speaker portal <ArrowRight size={16} /></button><button type="button" className="button button--quiet" onClick={() => { setSubmittedId(null); setStep(0); setSubmission({ ...blankSubmission, speaker: { ...submission.speaker } }); }}>Submit another session</button></div>
          {builder.autoRedirect && <p className="countdown">Continuing automatically in <strong>{Math.max(0, countdown)}</strong> seconds.</p>}
        </main>
        <NoticeRegion />
      </div>
    );
  }

  return (
    <div className="public-page">
      <PublicHeader active="cfp" />
      <main className="submission-shell">
        {previewingDraft && <InlineAlert tone="warning"><strong>Private draft preview.</strong> Applicants on the public link still see published version {publicBuilder.publishedVersion}.</InlineAlert>}
        <header className="submission-head">
          <div><p className="eyebrow">{workspace.event.name} · Call for speakers</p><h1>{builder.externalTitle}</h1></div>
          <div className="submission-window"><Clock3 size={17} /><span><strong>Open until {formatDeadline(workspace.event.cfpClosesAt, workspace.event.timezone)}</strong><small>Limit: {builder.submissionLimit} submissions per person · drafts count</small></span></div>
        </header>

        <nav className="submission-stepper" aria-label="Submission progress">
          {visibleSteps.map((item, index) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} disabled={index > step} onClick={() => index <= step && setStep(index)} className={index === step ? "active" : index < step ? "complete" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={14} /> : <Icon size={14} />}</span><strong>{item.label}</strong></button>;
          })}
        </nav>

        <div className="submission-body">
          <div className="submission-body__main">
            {currentStep.id === "welcome" && <section className="public-copy"><p className="eyebrow">01 / Welcome</p><h2>{builder.externalTitle}</h2><p className="public-copy__lead">{builder.welcomeMessage}</p><h3>What makes a useful session</h3><ul><li>A real system, decision, or failure your peers can learn from.</li><li>Evidence: traces, measurements, artifacts, or a working demonstration.</li><li>A promise specific enough that attendees know what they will take home.</li></ul><h3>Program lanes</h3><div className="topic-list">{categoryOptions.map((topic, index) => <span key={topic}><b>{String(index + 1).padStart(2, "0")}</b>{topic}</span>)}</div><h3>Helpful field notes</h3><div className="resource-links"><a href="#terms">Speaker agreement & recording terms <ExternalLink size={13} /></a><a href="#faq">Application process FAQ <ExternalLink size={13} /></a><a href="#guide">Speaker tips and resources <ExternalLink size={13} /></a></div></section>}

            {currentStep.id === "account" && <section className="form-page"><p className="eyebrow">02 / Account</p><h2>Give the draft a reliable owner.</h2><p>We use one verified address for saved drafts, decisions, and speaker portal access.</p><div className="form-stack"><Field label="Email address" error={errors.email}><input type="email" value={submission.speaker.email} onChange={(event) => updateSpeaker({ email: event.target.value })} placeholder="you@example.com" /></Field><label className={`check-row${errors.account ? " check-row--error" : ""}`}><input type="checkbox" checked={accountReady} onChange={(event) => setAccountReady(event.target.checked)} /><span><strong>I can access this inbox.</strong><small>Production accounts verify this address before a draft is stored.</small>{errors.account && <b>{errors.account}</b>}</span></label><InlineAlert tone="info"><LockKeyhole size={15} /> Already have a production account? <Link to={`/auth?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`} className="text-link">Sign in or create one</Link>. Demo personas can continue locally.</InlineAlert></div></section>}

            {currentStep.id === "submission" && (
              <section className="form-page">
                <p className="eyebrow">03 / Submission</p>
                <h2>{builder.proposalSectionTitle}</h2>
                <p>{builder.proposalInstructions}</p>
                <div className="form-stack">
                  <Field label="Session title" error={errors.title} hint={`${submission.title.length} / 100`}><input maxLength={100} value={submission.title} onChange={(event) => setSubmission({ ...submission, title: event.target.value })} placeholder="The eval flywheel that caught our agent regressions" /></Field>
                  <Field label="Abstract" error={errors.summary} hint={`${submission.summary.length} characters`}><textarea rows={7} value={submission.summary} onChange={(event) => setSubmission({ ...submission, summary: event.target.value })} placeholder="What did you build, what went wrong, and what can another team reuse?" /></Field>
                  <div className="field-grid field-grid--2">
                    <Field label="Program category"><select value={submission.category} onChange={(event) => setSubmission({ ...submission, category: event.target.value })}>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
                    <Field label="Preferred format"><select value={submission.format} onChange={(event) => setSubmission({ ...submission, format: event.target.value as ApplicantSubmission["format"] })}><option value="talk">Talk · 30 min</option><option value="workshop">Workshop · 60 min</option><option value="panel">Panel · 45 min</option><option value="lightning">Lightning · 10 min</option></select></Field>
                    <Field label="Audience level"><select value={submission.level} onChange={(event) => setSubmission({ ...submission, level: event.target.value as ApplicantSubmission["level"] })}><option value="introductory">Introductory</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></Field>
                    <Field label="Project or repository" hint="Optional"><input type="url" value={submission.repoUrl} onChange={(event) => setSubmission({ ...submission, repoUrl: event.target.value })} placeholder="https://…" /></Field>
                  </div>
                  {submission.format === "workshop" && <Field label="Workshop setup requirements" error={errors.workshopNeeds}><textarea rows={4} value={submission.workshopNeeds} onChange={(event) => setSubmission({ ...submission, workshopNeeds: event.target.value })} placeholder="Attendee prerequisites, software, room layout, helpers…" /></Field>}
                  {visibleProposalCustomFields.map((field) => <CustomField key={field.id} field={field} value={responses[field.id]} error={errors[field.id]} onChange={(value) => updateResponse(field.id, value)} />)}
                  <div className={`combined-counter${combinedCharacters > builder.combinedCharacterLimit ? " combined-counter--over" : ""}`}><span>Combined long-text budget</span><strong>{combinedCharacters.toLocaleString()} / {builder.combinedCharacterLimit.toLocaleString()}</strong></div>
                </div>
              </section>
            )}

            {currentStep.id === "participant" && (
              <section className="form-page">
                <p className="eyebrow">04 / Participant</p>
                <h2>{builder.participantSectionTitle}</h2>
                <p>{builder.participantInstructions}</p>
                <div className="form-stack">
                  <div className="field-grid field-grid--2">
                    <Field label="First name" error={errors.firstName}><input value={submission.speaker.firstName} onChange={(event) => updateSpeaker({ firstName: event.target.value })} /></Field>
                    <Field label="Last name" error={errors.lastName}><input value={submission.speaker.lastName} onChange={(event) => updateSpeaker({ lastName: event.target.value })} /></Field>
                    <Field label="Role or title" error={errors.speakerTitle}><input value={submission.speaker.title} onChange={(event) => updateSpeaker({ title: event.target.value })} placeholder="Staff AI Engineer" /></Field>
                    <Field label="Company / affiliation" error={errors.company}><input value={submission.speaker.company} onChange={(event) => updateSpeaker({ company: event.target.value })} placeholder="Independent is okay" /></Field>
                  </div>
                  <Field label="Biography" hint={`${submission.speaker.bio.length} / 5,000 · editable later in the portal`}><textarea rows={7} maxLength={5000} value={submission.speaker.bio} onChange={(event) => updateSpeaker({ bio: event.target.value })} placeholder="What perspective and experience do you bring to this subject?" /></Field>
                  {visibleParticipantCustomFields.map((field) => <CustomField key={field.id} field={field} value={responses[field.id]} error={errors[field.id]} onChange={(value) => updateResponse(field.id, value)} />)}
                </div>
              </section>
            )}

            {currentStep.id === "review" && (
              <section className="form-page review-submit">
                <p className="eyebrow">05 / Review</p>
                <h2>One final read before it leaves your desk.</h2>
                <p>Submitting creates an immutable review snapshot. You can still revise the proposal until the call closes.</p>
                <div className="review-sheet">
                  <div><span>TITLE</span><strong>{submission.title || "Not supplied"}</strong><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  <div><span>FORMAT</span><strong>{submission.format} · {submission.level}</strong><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  <div><span>PROGRAM LANE</span><strong>{submission.category}</strong><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  <div><span>SPEAKER</span><strong>{submission.speaker.firstName} {submission.speaker.lastName} · {submission.speaker.company}</strong><button type="button" onClick={() => setStep(stepIndex(builder.collectParticipants ? "participant" : "submission"))}>Edit</button></div>
                  <div className="review-sheet__long"><span>ABSTRACT</span><p>{submission.summary}</p><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  {customReviewFields.map(({ field, section }) => <div key={field.id}><span>{field.label.toUpperCase()}</span><strong>{answerLabel(responses[field.id])}</strong><button type="button" onClick={() => setStep(stepIndex(section === "proposal" ? "submission" : "participant"))}>Edit</button></div>)}
                </div>
                <label className={`check-row${submitError ? " check-row--error" : ""}`}><input type="checkbox" checked={termsAccepted} onChange={(event) => { setTermsAccepted(event.target.checked); setSubmitError(""); }} /><span><strong>I have permission to submit this material.</strong><small>I accept the speaker agreement and recording terms.</small>{submitError && <b>{submitError}</b>}</span></label>
              </section>
            )}
          </div>

          <aside className="submission-aside">
            <div className="draft-card"><div><Save size={17} /><span><strong>{savedAt ? "Draft saved" : "Draft autosave ready"}</strong><small>{savedAt ? savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "After account verification"}</small></span></div><button type="button" onClick={saveDraft}>Save now</button></div>
            <div className="deadline-card"><Info size={17} /><div><strong>Deadline is enforced in {workspace.event.timezone.replace("America/", "")}.</strong><p>Existing drafts and updates close at the same instant.</p></div></div>
            <ProgressBar label="Application progress" value={step + 1} max={visibleSteps.length} />
          </aside>
        </div>

        <footer className="submission-footer">
          <button type="button" className="button button--quiet" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={15} /> Back</button>
          <span>Step {step + 1} of {visibleSteps.length}</span>
          {currentStep.id === "review" ? <button type="button" className="button button--primary button--large" disabled={!termsAccepted || submitting} onClick={async () => { if (!termsAccepted) { setSubmitError("Accept the speaker agreement and recording terms before submitting."); return; } setSubmitting(true); try { const proposal = await submitProposal(submission); window.localStorage.removeItem("conference-ops-cfp-draft"); setSubmittedId(proposal.id); } catch (error) { setSubmitError(error instanceof Error ? error.message : "The proposal could not be submitted."); } finally { setSubmitting(false); } }}><CheckCircle2 size={16} /> {submitting ? "Submitting…" : "Submit proposal"}</button> : <button type="button" className="button button--primary" onClick={goNext}>Continue <ArrowRight size={15} /></button>}
        </footer>
      </main>
      <NoticeRegion />
    </div>
  );
}
