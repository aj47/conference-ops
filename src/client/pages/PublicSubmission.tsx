import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Cloud,
  FileCheck2,
  FileText,
  Info,
  LockKeyhole,
  Mail,
  MessageSquareQuote,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import type { FormField, Proposal } from "../../shared/domain";
import { submissionCategoryField } from "../../shared/form-fields";
import { ApiClientError, conferenceApi } from "../api";
import { authClient } from "../auth-client";
import { Field, InlineAlert, NoticeRegion, ProgressBar, StatusPill } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import { timeZoneAbbreviation } from "../event-time";
import {
  configuredCategoryOptions,
  initialConfiguredCategory,
  publishedSubmissionDeadline,
} from "../public-cfp";
import { privateEventPath } from "../private-routes";
import { authPathFor, safeReturnTo } from "../return-to";
import { PublicHeader } from "../Shell";
import { submissionAccountError, submissionAccountState } from "../submission-auth";
import { proposalToApplicantSubmission, submissionForPersistence } from "../submission-proposal";
import {
  loadSubmissionBrowserDraft,
  removeSubmissionBrowserDraft,
  saveSubmissionBrowserDraft,
  submissionDraftStorageKey,
  type SubmissionDraftScope,
} from "../submission-draft-storage";
import {
  blankApplicantSpeaker,
  restoreApplicantSpeakers,
  speakerErrorKey,
  validateApplicantSpeakers,
  withMinimumSpeakers,
} from "../submission-speakers";
import { builderConfigFromForm, type ApplicantSpeaker, type ApplicantSubmission, type BuilderConfig, useWorkspace } from "../workspace";

const wizardSteps = [
  { id: "welcome", label: "Welcome", icon: BookOpen },
  { id: "account", label: "Account", icon: LockKeyhole },
  { id: "submission", label: "Submission", icon: FileText },
  { id: "participant", label: "Participant", icon: UserRound },
  { id: "review", label: "Review", icon: FileCheck2 },
] as const;

function blankSubmission(fields: FormField[], minimumSpeakers = 1): ApplicantSubmission {
  const initialCategory = initialConfiguredCategory(fields);
  return {
    title: "",
    summary: "",
    category: initialCategory,
    categories: initialCategory ? [initialCategory] : [],
    format: "talk",
    level: "intermediate",
    repoUrl: "",
    workshopNeeds: "",
    responses: {},
    speakers: withMinimumSpeakers([], minimumSpeakers),
  };
}

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
    if (field.id === "field-category" || ["category", "program category", "program lane"].includes(label)) {
      return field.type === "multi_select" ? (submission.categories?.length ? submission.categories : submission.category ? [submission.category] : []) : submission.category;
    }
    if (field.id === "field-format" || ["format", "preferred format", "session format"].includes(label)) {
      const label = submission.format === "lightning" ? "Lightning talk" : `${submission.format[0].toUpperCase()}${submission.format.slice(1)}`;
      return field.options?.find((option) => option.toLowerCase() === label.toLowerCase()) ?? label;
    }
    if (field.id === "field-repo") return submission.repoUrl;
    return submission.workshopNeeds;
  }
  const primarySpeaker = submission.speakers[0] ?? blankApplicantSpeaker();
  if (field.id === "speaker-first" || label === "first name") return primarySpeaker.firstName;
  if (field.id === "speaker-last" || label === "last name") return primarySpeaker.lastName;
  if (field.id === "speaker-email" || ["email", "email address", "contact email", "speaker email"].includes(label)) return primarySpeaker.email;
  if (field.id === "speaker-bio" || ["biography", "bio", "speaker bio"].includes(label)) return primarySpeaker.bio;
  if (["company", "company / affiliation", "affiliation", "organization"].includes(label)) return primarySpeaker.company;
  return primarySpeaker.title;
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

function applicantMayWithdraw(status: Proposal["status"]) {
  return ["changes_requested", "revision_open", "submitted", "under_review", "accept_queue", "decline_queue", "waitlisted"].includes(status);
}

function applicantMayEdit(status: Proposal["status"]) {
  return status === "draft" || applicantRevisionOpen(status);
}

function applicantRevisionOpen(status: Proposal["status"]) {
  return status === "changes_requested" || status === "revision_open";
}

function proposalRevisionWindowOpen(proposal: Proposal, eventClosesAt: string) {
  const deadline = proposal.form?.closesAt ?? eventClosesAt;
  return proposal.form?.status !== "closed" && Date.now() < new Date(deadline).getTime();
}

function proposalDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function WithdrawProposalDialog({
  proposal,
  busy,
  error,
  onClose,
  onConfirm,
  returnFocusRef,
}: {
  proposal: Proposal;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose, true, returnFocusRef);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <div ref={dialogRef} className="withdraw-dialog" role="dialog" aria-modal="true" aria-labelledby="withdraw-title" aria-describedby="withdraw-detail" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="icon-button withdraw-dialog__close" aria-label="Close withdrawal confirmation" disabled={busy} onClick={onClose}><X size={18} /></button>
        <p className="eyebrow">Final applicant action</p>
        <h2 id="withdraw-title">Withdraw this proposal?</h2>
        <p id="withdraw-detail"><strong>{proposal.title}</strong> will leave the review queue. The record stays in your account, but reviewers will stop working on it.</p>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <div className="withdraw-dialog__actions">
          <button type="button" className="button button--quiet" data-dialog-initial-focus disabled={busy} onClick={onClose}>Keep proposal</button>
          <button type="button" className="button button--danger" disabled={busy} onClick={onConfirm}>{busy ? "Withdrawing…" : "Yes, withdraw"}</button>
        </div>
      </div>
    </div>
  );
}

function PublicCfpState({ kind, message }: { kind: "loading" | "unavailable" | "error"; message?: string }) {
  if (kind === "loading") return <div className="route-loader" role="status">Opening the call for speakers…</div>;
  return (
    <div className="public-page">
      <main className="public-unavailable" role={kind === "error" ? "alert" : undefined}>
        <p className="eyebrow">Call for speakers · {kind === "error" ? "Load error" : "Not published"}</p>
        <h1>{kind === "error" ? "We couldn’t open this call for speakers." : "Submissions aren’t open yet."}</h1>
        <p>{message ?? "The organizer has not published a submission form for this event. Check back after the call for speakers opens."}</p>
        {kind === "error" && <button type="button" className="button button--primary" onClick={() => window.location.reload()}>Try again</button>}
      </main>
    </div>
  );
}

export function PublicSubmissionWizard() {
  const { workspace, builder: draftBuilder, publicBuilder, publicEventState, privateWorkspaceEventId, loading, authRequired, noEvent } = useWorkspace();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { slug = "" } = useParams<{ slug: string }>();
  const requestedDraftPreview = searchParams.get("preview") === "draft";
  const requestedDraftEventId = searchParams.get("eventId");
  const previewingDraft = requestedDraftPreview
    && privateWorkspaceEventId === workspace.event.id
    && workspace.event.slug === slug;

  if (requestedDraftPreview && requestedDraftEventId) {
    if (loading) return <PublicCfpState kind="loading" />;
    if (authRequired) {
      const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`);
      return <Navigate to={authPathFor(returnTo)} replace />;
    }
    if (noEvent || privateWorkspaceEventId !== requestedDraftEventId || workspace.event.slug !== slug) {
      return <PublicCfpState kind="error" message="This private draft preview is unavailable for your account." />;
    }
  }
  if (previewingDraft) {
    return <PublicSubmissionExperience key={`draft:${draftBuilder.formId}:${draftBuilder.version}`} builder={draftBuilder} previewingDraft />;
  }
  if (publicEventState.status === "idle" || publicEventState.status === "loading" || publicEventState.slug !== slug) return <PublicCfpState kind="loading" />;
  if (publicEventState.status === "error") return <PublicCfpState kind="error" message={publicEventState.message} />;
  if (publicEventState.cfp === "unavailable" || !publicBuilder) return <PublicCfpState kind="unavailable" />;
  return <PublicSubmissionExperience key={`public:${publicBuilder.formId}:${publicBuilder.version}`} builder={publicBuilder} previewingDraft={false} />;
}

function PublicSubmissionExperience({ builder: publishedBuilder, previewingDraft }: { builder: BuilderConfig; previewingDraft: boolean }) {
  const { workspace, publicBuilder, source, saveProposalDraft, submitProposal, withdrawProposal, reopenProposal } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const session = authClient.useSession();
  const sessionUser = session.data?.user;
  const verifiedDraftEmail = sessionUser?.emailVerified ? sessionUser.email : undefined;
  const [accountProposals, setAccountProposals] = useState<Proposal[]>([]);
  const [accountProposalsLoading, setAccountProposalsLoading] = useState(false);
  const [accountProposalsError, setAccountProposalsError] = useState("");
  const requestedEditId = searchParams.get("edit");
  const editingProposal = requestedEditId
    ? accountProposals.find((proposal) => proposal.id === requestedEditId)
    : undefined;
  const builder = useMemo(() => {
    const pinnedForm = editingProposal && applicantMayEdit(editingProposal.status) && editingProposal.form?.eventId === workspace.event.id
      ? editingProposal.form
      : undefined;
    return pinnedForm ? builderConfigFromForm(pinnedForm, workspace.event) : publishedBuilder;
  }, [editingProposal, publishedBuilder, workspace.event]);
  const draftScope = useMemo<SubmissionDraftScope>(() => ({
    eventSlug: workspace.event.slug,
    formId: builder.formId,
    formVersion: builder.version,
    ...(verifiedDraftEmail ? { accountEmail: verifiedDraftEmail } : {}),
  }), [builder.formId, builder.version, verifiedDraftEmail, workspace.event.slug]);
  const draftKey = submissionDraftStorageKey(draftScope);
  const [step, setStep] = useState(0);
  const [accountReady, setAccountReady] = useState(false);
  const [submission, setSubmission] = useState<ApplicantSubmission>(() => blankSubmission(builder.proposalFields, builder.participantMin));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [submittedRevision, setSubmittedRevision] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingAccountDraft, setSavingAccountDraft] = useState(false);
  const [draftSyncMessage, setDraftSyncMessage] = useState("");
  const [withdrawTarget, setWithdrawTarget] = useState<Proposal | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepperRef = useRef<HTMLElement>(null);
  const previousStep = useRef(step);
  const hydratedProposalRef = useRef("");
  const hydratedBrowserDraftRef = useRef("");
  const withdrawReturnFocusRef = useRef<HTMLElement | null>(null);
  const configuredSteps = wizardSteps.map((item) => ({
    ...item,
    label: item.id === "submission"
      ? builder.proposalPageHeading
      : item.id === "participant"
        ? builder.participantPageHeading
        : item.label,
  }));
  const visibleSteps = builder.collectParticipants ? configuredSteps : configuredSteps.filter((item) => item.id !== "participant");
  const currentStep = visibleSteps[step];
  const primarySpeaker = submission.speakers[0] ?? blankApplicantSpeaker();
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
  const combinedCharacters = submission.summary.length
    + submission.workshopNeeds.length
    + submission.speakers.reduce((total, speaker) => total + speaker.bio.length, 0)
    + customLongTextCharacters;
  const customReviewFields = [
    ...proposalCustomFields.map((field) => ({ field, section: "proposal" as const })),
    ...participantCustomFields.map((field) => ({ field, section: "participant" as const })),
  ].filter(({ field }, index, fields) => field.type !== "file"
    && isFieldVisible(field, responses)
    && hasAnswer(responses[field.id])
    && fields.findIndex((candidate) => candidate.field.id === field.id) === index);
  const categoryOptions = configuredCategoryOptions(builder.proposalFields);
  const categoryField = submissionCategoryField(builder.proposalFields);
  const allowsMultipleCategories = categoryField?.type === "multi_select";
  const collectsRepository = builder.proposalFields.some((field) => field.id === "field-repo");
  const collectsWorkshopNeeds = builder.proposalFields.some((field) => field.id === "field-workshop-needs");
  const accountState = submissionAccountState(source, session.isPending, sessionUser, primarySpeaker.email);
  const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  const authPath = authPathFor(returnTo);
  const portalPath = privateEventPath("/portal/home", workspace.event.id, "applicant");
  const formContract = editingProposal?.form ?? workspace.forms.find((form) => form.id === builder.formId);
  const cfpDeadline = publishedSubmissionDeadline(formContract ?? {}, workspace.event);
  const cfpClosed = formContract?.status === "closed" || Date.now() > new Date(cfpDeadline).getTime();

  useEffect(() => {
    if (!submittedId || !builder.autoRedirect) return;
    const interval = window.setInterval(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearInterval(interval);
  }, [builder.autoRedirect, submittedId]);

  useEffect(() => {
    if (countdown <= 0 && submittedId) window.location.assign(portalPath);
  }, [countdown, portalPath, submittedId]);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const stepper = stepperRef.current;
    const activeStep = stepper?.querySelector<HTMLButtonElement>('button[aria-current="step"]');
    if (!stepper || !activeStep || stepper.scrollWidth <= stepper.clientWidth) return;

    const visibleLeft = stepper.scrollLeft;
    const visibleRight = visibleLeft + stepper.clientWidth;
    const stepperRect = stepper.getBoundingClientRect();
    const activeStepRect = activeStep.getBoundingClientRect();
    const stepLeft = activeStepRect.left - stepperRect.left - stepper.clientLeft + visibleLeft;
    const stepRight = stepLeft + activeStepRect.width;
    if (stepLeft >= visibleLeft && stepRight <= visibleRight) return;

    const nextLeft = stepLeft < visibleLeft ? stepLeft : stepRight - stepper.clientWidth;
    stepper.scrollTo({ left: Math.max(0, Math.min(nextLeft, stepper.scrollWidth - stepper.clientWidth)) });
  }, [step, visibleSteps.length]);

  useEffect(() => {
    if (submittedId) stepHeadingRef.current?.focus();
  }, [submittedId]);

  useEffect(() => {
    if (hydratedBrowserDraftRef.current === draftKey) return;
    hydratedBrowserDraftRef.current = draftKey;
    const empty = blankSubmission(builder.proposalFields, builder.participantMin);
    try {
      const stored = loadSubmissionBrowserDraft(window.localStorage, draftScope) as (ApplicantSubmission & { speaker?: ApplicantSpeaker }) | null;
      if (stored) {
        const availableCategories = configuredCategoryOptions(builder.proposalFields);
        const storedCategories = (stored.categories?.length ? stored.categories : stored.category ? [stored.category] : [])
          .filter((category) => availableCategories.includes(category));
        const normalizedCategories = storedCategories.length ? storedCategories : [initialConfiguredCategory(builder.proposalFields)].filter(Boolean);
        setSubmission({
          ...empty,
          ...stored,
          category: normalizedCategories[0] ?? "",
          categories: normalizedCategories,
          responses: stored.responses ?? {},
          speakers: restoreApplicantSpeakers(stored.speakers, stored.speaker, builder.participantMin),
        });
        return;
      }
    } catch {
      // A malformed or unavailable browser store must not block a fresh form.
    }

    const speakers = [...empty.speakers];
    speakers[0] = {
      ...speakers[0],
      firstName: source === "demo" && workspace.actor.role === "applicant" ? "Leah" : "",
      lastName: source === "demo" && workspace.actor.role === "applicant" ? "Okafor" : "",
      email: verifiedDraftEmail ?? (source === "demo" && workspace.actor.role === "applicant" ? workspace.actor.email : ""),
    };
    setSubmission({ ...empty, speakers });
  }, [builder.participantMin, builder.proposalFields, draftKey, draftScope, source, verifiedDraftEmail, workspace.actor.email, workspace.actor.role]);

  useEffect(() => {
    if (source !== "api" || accountState.kind !== "verified") return;
    let active = true;
    setAccountProposalsLoading(true);
    setAccountProposalsError("");
    conferenceApi.bootstrap("", workspace.event.id, "applicant")
      .then((snapshot) => {
        if (!active) return;
        setAccountProposals(snapshot.event.id === workspace.event.id ? snapshot.proposals : []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiClientError && error.code === "NO_EVENT") {
          setAccountProposals([]);
          return;
        }
        setAccountProposalsError(error instanceof Error ? error.message : "Your saved proposals could not be loaded.");
      })
      .finally(() => active && setAccountProposalsLoading(false));
    return () => { active = false; };
  }, [accountState.kind, source, workspace.event.id]);

  useEffect(() => {
    if (accountState.kind !== "mismatch" || accountState.draftEmail || primarySpeaker.email.trim()) return;
    setSubmission((current) => ({
      ...current,
      speakers: current.speakers.map((speaker, index) => index === 0 ? { ...speaker, email: accountState.email } : speaker),
    }));
  }, [accountState, primarySpeaker.email]);

  useEffect(() => {
    if (!editingProposal || !applicantMayEdit(editingProposal.status)) return;
    const hydrationKey = `${editingProposal.id}:${editingProposal.version ?? 1}`;
    if (hydratedProposalRef.current === hydrationKey) return;
    hydratedProposalRef.current = hydrationKey;
    setSubmission(proposalToApplicantSubmission(editingProposal, builder));
    setPermissionConfirmed(false);
    setSubmitError("");
    setErrors({});
    setDraftSyncMessage(applicantRevisionOpen(editingProposal.status)
      ? `Requested revision restored · version ${editingProposal.version ?? 1}`
      : `Account draft restored · version ${editingProposal.version ?? 1}`);
    setStep(Math.max(0, visibleSteps.findIndex((item) => item.id === "submission")));
  }, [builder, editingProposal, visibleSteps]);

  const saveDraft = () => {
    try {
      saveSubmissionBrowserDraft(window.localStorage, draftScope, submission);
      setSavedAt(new Date());
      return true;
    } catch {
      setSubmitError("This browser could not save the draft. Keep this page open and copy your answers before leaving.");
      return false;
    }
  };

  const mergeAccountProposal = (proposal: Proposal) => {
    setAccountProposals((current) => [proposal, ...current.filter((item) => item.id !== proposal.id)]);
  };

  const saveDraftToAccount = async () => {
    saveDraft();
    setSubmitError("");
    setDraftSyncMessage("");
    if (source !== "api" || accountState.kind !== "verified") {
      setSubmitError("Sign in with a verified account to sync this browser draft across devices.");
      return;
    }
    if (requestedEditId && !editingProposal) {
      setSubmitError("This account draft is unavailable. Return to Your conference account and choose a saved draft before syncing.");
      return;
    }
    if (cfpClosed && (!editingProposal || applicantRevisionOpen(editingProposal.status))) {
      setSubmitError("The call for speakers is closed, so a new account draft can no longer be created. Your browser copy remains available on this device.");
      return;
    }
    if (editingProposal && !applicantMayEdit(editingProposal.status)) {
      setSubmitError("This proposal is already in review and can no longer be edited.");
      return;
    }

    const draftErrors: Record<string, string> = {};
    if (submission.title.trim().length < 3) draftErrors.title = "Add a working title with at least 3 characters before syncing.";
    if (submission.summary.trim().length < 20) draftErrors.summary = "Add at least 20 characters of an abstract before syncing.";
    if (builder.collectParticipants) {
      Object.assign(draftErrors, validateApplicantSpeakers(submission.speakers, builder.participantMin, builder.participantMax));
    }
    if (Object.keys(draftErrors).length) {
      setErrors(draftErrors);
      setSubmitError("Your browser copy is safe. Complete the highlighted title, abstract, and speaker identity fields before syncing it to your account.");
      const hasProposalError = Boolean(draftErrors.title || draftErrors.summary);
      setStep(hasProposalError ? Math.max(0, visibleSteps.findIndex((item) => item.id === "submission")) : stepIndex("participant"));
      return;
    }

    setSavingAccountDraft(true);
    try {
      const persistenceSubmission = submissionForPersistence(
        submission,
        builder.collectParticipants,
        verifiedDraftEmail ? { name: sessionUser?.name, email: verifiedDraftEmail } : undefined,
      );
      const saved = await saveProposalDraft(persistenceSubmission, builder, editingProposal);
      mergeAccountProposal(saved);
      const nextSearch = new URLSearchParams(searchParams);
      nextSearch.set("edit", saved.id);
      setSearchParams(nextSearch, { replace: true });
      hydratedProposalRef.current = `${saved.id}:${saved.version ?? 1}`;
      try { removeSubmissionBrowserDraft(window.localStorage, draftScope); } catch { /* The account copy is authoritative. */ }
      const savedTime = new Date();
      setSavedAt(savedTime);
      setDraftSyncMessage(`Saved to your account at ${savedTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        if (saveDraft()) window.location.assign(authPath);
        return;
      }
      setSubmitError(error instanceof Error ? error.message : "The draft could not be synced. Your browser copy is still available.");
    } finally {
      setSavingAccountDraft(false);
    }
  };

  const startNewProposal = () => {
    setSubmittedId(null);
    setSubmittedRevision(false);
    const empty = blankSubmission(builder.proposalFields, builder.participantMin);
    const verifiedEmail = accountState.kind === "verified" ? accountState.email : "";
    setSubmission({
      ...empty,
      speakers: empty.speakers.map((speaker, index) => index === 0 ? { ...speaker, email: verifiedEmail } : speaker),
    });
    setStep(0);
    setErrors({});
    setSubmitError("");
    setDraftSyncMessage("");
    setPermissionConfirmed(false);
    hydratedProposalRef.current = "";
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.delete("edit");
    setSearchParams(nextSearch, { replace: true });
    try { removeSubmissionBrowserDraft(window.localStorage, draftScope); } catch { /* A new in-memory draft can still be started. */ }
  };

  const confirmWithdrawal = async () => {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    setWithdrawError("");
    try {
      await withdrawProposal(withdrawTarget.id);
      setAccountProposals((current) => current.map((proposal) => proposal.id === withdrawTarget.id
        ? { ...proposal, status: "withdrawn", version: (proposal.version ?? 0) + 1 }
        : proposal));
      if (requestedEditId === withdrawTarget.id) startNewProposal();
      setWithdrawTarget(null);
    } catch (error) {
      setWithdrawError(error instanceof Error ? error.message : "The proposal could not be withdrawn.");
    } finally {
      setWithdrawing(false);
    }
  };

  const openSubmittedProposalForEditing = async (proposal: Proposal) => {
    setReopeningId(proposal.id);
    setSubmitError("");
    try {
      const reopened = await reopenProposal(proposal.id);
      const revisionRequest = {
        note: "Applicant reopened this proposal for editing before the CFP deadline.",
        requestedAt: reopened.revisionRequestedAt,
        requestedBy: "applicant" as const,
      };
      setAccountProposals((current) => current.map((item) => item.id === proposal.id ? {
        ...item,
        status: "revision_open",
        version: reopened.version,
        revisionRequest,
      } : item));
      const nextSearch = new URLSearchParams(searchParams);
      nextSearch.set("edit", proposal.id);
      setSearchParams(nextSearch, { replace: false });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The submission could not be opened for editing.");
    } finally {
      setReopeningId(null);
    }
  };

  const validateCurrent = () => {
    const next: Record<string, string> = {};
    if (currentStep.id === "account") {
      if (source === "demo") {
        if (!primarySpeaker.email.includes("@")) next.email = "Enter an email address we can use for your confirmation.";
        if (!accountReady) next.account = "Confirm that you can access this email address.";
      } else {
        const accountError = submissionAccountError(accountState);
        if (accountError) next.account = accountError;
      }
    }
    if (currentStep.id === "submission") {
      if (submission.title.trim().length < 8) next.title = "Use at least 8 characters so the title is identifiable.";
      if (submission.summary.trim().length < 80) next.summary = "Give reviewers at least 80 characters of concrete context.";
      const selectedCategories = (submission.categories?.length ? submission.categories : submission.category ? [submission.category] : [])
        .filter((category) => categoryOptions.includes(category));
      if (!selectedCategories.length) next.category = `Choose at least one published program ${allowsMultipleCategories ? "track" : "category"}.`;
      if (submission.format === "workshop" && submission.workshopNeeds.trim().length < 20) next.workshopNeeds = "Tell us what attendees need to bring or install.";
      if (combinedCharacters > builder.combinedCharacterLimit) next.summary = "The combined long-text limit has been exceeded.";
      Object.assign(next, validateCustomFields(proposalCustomFields, responses));
    }
    if (currentStep.id === "participant") {
      Object.assign(next, validateApplicantSpeakers(
        submission.speakers,
        builder.participantMin,
        builder.participantMax,
      ));
      Object.assign(next, validateCustomFields(participantCustomFields, responses));
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateCurrent()) {
      if (currentStep.id === "account" && source === "api") saveDraft();
      return;
    }
    saveDraft();
    setStep((value) => Math.min(value + 1, visibleSteps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateSpeaker = (index: number, patch: Partial<ApplicantSpeaker>) => {
    setSubmission((current) => ({
      ...current,
      speakers: current.speakers.map((speaker, speakerIndex) => speakerIndex === index ? { ...speaker, ...patch } : speaker),
    }));
    setErrors((current) => {
      const fields = Object.keys(patch);
      if (fields.length === 0 && !current.participantCount) return current;
      const next = { ...current };
      delete next.participantCount;
      for (const field of fields) delete next[speakerErrorKey(index, field as keyof ApplicantSpeaker)];
      if (patch.email !== undefined) {
        for (const key of Object.keys(next)) {
          if (/^speakers\.\d+\.email$/.test(key)) delete next[key];
        }
        if (index === 0) {
          delete next.email;
          delete next.account;
        }
      }
      return next;
    });
  };
  const addSpeaker = () => {
    if (submission.speakers.length >= builder.participantMax) return;
    setSubmission((current) => ({ ...current, speakers: [...current.speakers, blankApplicantSpeaker()] }));
    setErrors((current) => {
      if (!current.participantCount) return current;
      const next = { ...current };
      delete next.participantCount;
      return next;
    });
  };
  const removeSpeaker = (index: number) => {
    if (index === 0 || submission.speakers.length <= builder.participantMin) return;
    setSubmission((current) => ({
      ...current,
      speakers: current.speakers.filter((_, speakerIndex) => speakerIndex !== index),
    }));
    setErrors({});
  };
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

  const submitCurrentProposal = async () => {
    if (requestedEditId && (!editingProposal || !applicantMayEdit(editingProposal.status))) {
      setSubmitError("This saved proposal is no longer editable. Start a new proposal or return to your account list.");
      return;
    }
    if (cfpClosed) {
      setSubmitError("The call for speakers has closed. Your account draft remains saved, but it can no longer enter review.");
      return;
    }
    if (!permissionConfirmed) {
      setSubmitError("Confirm that you have permission to submit all included material.");
      return;
    }
    if (source === "api") {
      const accountError = submissionAccountError(accountState);
      if (accountError) {
        saveDraft();
        setErrors((current) => ({ ...current, account: accountError }));
        setSubmitError("");
        setStep(Math.max(0, visibleSteps.findIndex((item) => item.id === "account")));
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }
    if (builder.collectParticipants) {
      const participantErrors = validateApplicantSpeakers(
        submission.speakers,
        builder.participantMin,
        builder.participantMax,
      );
      if (Object.keys(participantErrors).length > 0) {
        setErrors(participantErrors);
        setSubmitError("");
        setStep(stepIndex("participant"));
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }

    setSubmitting(true);
    try {
      const resubmittingRevision = Boolean(editingProposal && applicantRevisionOpen(editingProposal.status));
      const persistenceSubmission = submissionForPersistence(
        submission,
        builder.collectParticipants,
        verifiedDraftEmail ? { name: sessionUser?.name, email: verifiedDraftEmail } : undefined,
      );
      const proposal = await submitProposal(
        persistenceSubmission,
        builder,
        editingProposal && applicantMayEdit(editingProposal.status) ? editingProposal : undefined,
      );
      mergeAccountProposal(proposal);
      try { removeSubmissionBrowserDraft(window.localStorage, draftScope); } catch { /* The submitted server copy is authoritative. */ }
      setSubmittedId(proposal.id);
      setSubmittedRevision(resubmittingRevision);
    } catch (error) {
      if (source === "api" && error instanceof ApiClientError && error.status === 401) {
        if (saveDraft()) window.location.assign(authPath);
        return;
      }
      setSubmitError(error instanceof Error ? error.message : "The proposal could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  if (cfpClosed && !previewingDraft) {
    return (
      <div className="public-page">
        <PublicHeader active="cfp" />
        <main className="public-unavailable public-cfp-closed" role="status">
          <p className="eyebrow">{workspace.event.name} · Call for speakers closed</p>
          <h1>This submission window has ended.</h1>
          <p>The deadline was <strong>{formatDeadline(cfpDeadline, workspace.event.timezone)}</strong>. New proposals, account drafts, and revisions are now locked so every applicant is evaluated against the same cutoff.</p>
          <p>Already submitted work remains in the review process. Sign in to see its current status, or continue to the published program.</p>
          <div className="public-cfp-closed__actions">
            {source === "api" && accountState.kind === "verified"
              ? <Link className="button button--primary" to={portalPath}>Open your participant portal <ArrowRight size={15} /></Link>
              : <Link className="button button--primary" to={authPath}>Sign in to view saved proposals <ArrowRight size={15} /></Link>}
            <Link className="button button--quiet" to={`/events/${encodeURIComponent(workspace.event.slug)}/agenda`}>View the public agenda</Link>
          </div>
        </main>
        <NoticeRegion />
      </div>
    );
  }

  if (submittedId) {
    return (
      <div className="public-page">
        <PublicHeader active="cfp" />
        <main className="success-page">
          <span className="success-page__mark"><Check size={38} /></span>
          <p className="eyebrow">{submittedRevision ? "Revision" : "Submission"} {submittedId.slice(-8).toUpperCase()} received</p>
          <h1 ref={stepHeadingRef} tabIndex={-1}>{submittedRevision ? "Your revision is back in review." : "You’re in the review queue."}</h1>
          <p>{submittedRevision ? "The requested changes are saved. Open reviewer work was rebuilt from the proposal’s current tracks; earlier final reviews remain in the organizer’s audit record." : builder.successMessage}</p>
          <div className="success-receipt"><span><Mail size={18} /><span><strong>{submittedRevision ? "Program team notified" : "Confirmation queued"}</strong><small>{primarySpeaker.email}</small></span></span><span><ShieldCheck size={18} /><span><strong>Submission locked to V{builder.version}</strong><small>Your speaker profile stays editable. The organizer can open another controlled revision if needed.</small></span></span></div>
          <div className="success-actions"><a className="button button--primary button--large" href={portalPath}>Continue to speaker portal <ArrowRight size={16} /></a><button type="button" className="button button--quiet" onClick={startNewProposal}>Submit another session</button></div>
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
        {previewingDraft && <InlineAlert tone="warning"><strong>Private draft preview.</strong> {publicBuilder ? `Applicants on the public link still see published version ${publicBuilder.publishedVersion}.` : "No public form is published yet."}</InlineAlert>}
        {editingProposal?.status === "draft" && <InlineAlert tone="info"><Cloud size={15} /><span><strong>Editing account draft.</strong> Changes are not synced until you choose Save to account. Draft revision {editingProposal.version ?? 1} uses immutable form version {builder.version}{builder.version !== publishedBuilder.version ? `; new proposals use version ${publishedBuilder.version}` : ""}.</span></InlineAlert>}
        {editingProposal && applicantRevisionOpen(editingProposal.status) && <InlineAlert tone={cfpClosed ? "danger" : "warning"}><MessageSquareQuote size={15} /><span><strong>{cfpClosed ? "Revision window closed." : editingProposal.status === "revision_open" ? "You opened this submission for editing." : "The program team requested changes."}</strong> {editingProposal.status === "changes_requested" ? editingProposal.revisionRequest?.note ?? "Review the organizer’s email, update the pinned form, and resubmit." : "Update the pinned form version, then save progress or resubmit."}{!cfpClosed && <> Save progress to your account or resubmit before <strong>{formatDeadline(cfpDeadline, workspace.event.timezone)}</strong>.</>}</span></InlineAlert>}
        {requestedEditId && !editingProposal && !accountProposalsLoading && accountState.kind === "verified" && <InlineAlert tone="danger">That proposal draft was not found in this verified account. Choose one of your saved proposals below or start a new draft.</InlineAlert>}
        <header className="submission-head">
          <div><p className="eyebrow">{workspace.event.name} · Call for speakers</p><h1>{builder.externalTitle}</h1></div>
          <div className="submission-window"><Clock3 size={17} /><span><strong>Open until {formatDeadline(cfpDeadline, workspace.event.timezone)}</strong><small>Limit: {builder.submissionLimit} submissions per person · drafts count</small></span></div>
        </header>

        <nav ref={stepperRef} className="submission-stepper" aria-label="Submission progress">
          {visibleSteps.map((item, index) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} disabled={index > step} onClick={() => index <= step && setStep(index)} className={index === step ? "active" : index < step ? "complete" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={14} /> : <Icon size={14} />}</span><strong>{item.label}</strong></button>;
          })}
        </nav>

        {submitError && currentStep.id !== "review" && <InlineAlert tone="danger">{submitError}</InlineAlert>}

        <div className="submission-body">
          <div className="submission-body__main">
            {currentStep.id === "welcome" && source === "api" && accountState.kind === "verified" && (
              <section className="account-submissions" aria-labelledby="account-submissions-title" aria-busy={accountProposalsLoading}>
                <div className="account-submissions__head">
                  <div><p className="eyebrow">Your conference account</p><h2 id="account-submissions-title">Pick up where you left off.</h2><p>Account drafts travel across devices. Submitted proposals stay visible here until the program reaches a final decision.</p></div>
                  <button type="button" className="button button--quiet" onClick={startNewProposal} disabled={accountProposalsLoading || cfpClosed}><Plus size={15} /> New proposal</button>
                </div>
                {accountProposalsError && <InlineAlert tone="danger">{accountProposalsError}</InlineAlert>}
                {accountProposalsLoading ? (
                  <p className="account-submissions__loading" role="status">Loading your saved proposals…</p>
                ) : accountProposals.length ? (
                  <div className="account-submissions__list">
                    {accountProposals.map((proposal) => (
                      <article key={proposal.id} className={proposal.id === editingProposal?.id ? "active" : ""}>
                        <div className="account-submissions__identity"><span>{proposal.id.slice(-7).toUpperCase()}</span><div><strong>{proposal.title || "Untitled proposal"}</strong><small>{proposal.status === "draft" ? `Saved ${proposalDate(proposal.submittedAt)} · version ${proposal.version ?? 1}` : applicantRevisionOpen(proposal.status) ? `${proposal.status === "revision_open" ? "Editing since" : "Requested"} ${proposalDate(proposal.revisionRequest?.requestedAt ?? proposal.submittedAt)} · version ${proposal.version ?? 1}` : `${proposal.format} · ${proposal.category}`}</small></div></div>
                        <StatusPill status={proposal.status} />
                        {applicantRevisionOpen(proposal.status) && <p className="account-submissions__revision-note"><MessageSquareQuote size={14} /> <span>{proposal.status === "revision_open" ? "This submission is editable until the pinned CFP deadline." : proposal.revisionRequest?.note ?? "The program team sent revision instructions by email."}</span></p>}
                        <div className="account-submissions__actions">
                          {proposal.status === "draft" && <Link className="button button--quiet" to={`${location.pathname}?edit=${encodeURIComponent(proposal.id)}`}>Resume draft <ArrowRight size={14} /></Link>}
                          {applicantRevisionOpen(proposal.status) && proposalRevisionWindowOpen(proposal, workspace.event.cfpClosesAt) && <Link className="button button--primary" to={`${location.pathname}?edit=${encodeURIComponent(proposal.id)}`}>Revise &amp; resubmit <ArrowRight size={14} /></Link>}
                          {["submitted", "under_review", "accept_queue", "decline_queue", "waitlisted"].includes(proposal.status) && proposalRevisionWindowOpen(proposal, workspace.event.cfpClosesAt) && proposal.speakers[0]?.email.toLowerCase() === accountState.email.toLowerCase() && <button type="button" className="button button--quiet" disabled={Boolean(reopeningId)} onClick={() => void openSubmittedProposalForEditing(proposal)}><FileText size={14} /> {reopeningId === proposal.id ? "Opening…" : "Edit submission"}</button>}
                          {applicantMayWithdraw(proposal.status) && <button type="button" className="text-link text-link--danger" onClick={(event) => { withdrawReturnFocusRef.current = event.currentTarget; setWithdrawError(""); setWithdrawTarget(proposal); }}>Withdraw</button>}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="account-submissions__empty">No account drafts yet. Start below, then save once you have a working title, abstract, and speaker identity.</p>
                )}
              </section>
            )}
            {currentStep.id === "welcome" && <section className="public-copy"><p className="eyebrow">01 / Welcome</p><h2 ref={stepHeadingRef} tabIndex={-1}>{builder.externalTitle}</h2><p className="public-copy__lead">{builder.welcomeMessage}</p><h3>What makes a useful session</h3><ul><li>A real system, decision, or failure your peers can learn from.</li><li>Evidence: traces, measurements, artifacts, or a working demonstration.</li><li>A promise specific enough that attendees know what they will take home.</li></ul><h3>Program lanes</h3>{categoryOptions.length ? <div className="topic-list">{categoryOptions.map((topic, index) => <span key={topic}><b>{String(index + 1).padStart(2, "0")}</b>{topic}</span>)}</div> : <InlineAlert tone="danger">This published form has no program categories. Contact the organizer before drafting a proposal.</InlineAlert>}<h3>What happens next</h3><ul><li>A browser draft keeps your work while you verify the account that will own it.</li><li>Reviewers assess the proposal against the published program lanes.</li><li>If accepted, the organizer will provide final speaker, recording, and day-of requirements before publication.</li></ul></section>}

            {currentStep.id === "account" && (
              <section className="form-page">
                <p className="eyebrow">02 / Account</p>
                <h2 ref={stepHeadingRef} tabIndex={-1}>Give the draft a reliable owner.</h2>
                <p>One verified address owns the proposal, receives decisions, and opens the speaker portal.</p>
                <div className="form-stack">
                  {source === "demo" ? (
                    <>
                      <Field label="Email address" error={errors.email}><input type="email" value={primarySpeaker.email} onChange={(event) => updateSpeaker(0, { email: event.target.value })} placeholder="you@example.com" /></Field>
                      <label className={`check-row${errors.account ? " check-row--error" : ""}`}><input type="checkbox" checked={accountReady} onChange={(event) => setAccountReady(event.target.checked)} /><span><strong>I can access this inbox.</strong><small>The demo keeps this draft in your browser.</small>{errors.account && <b>{errors.account}</b>}</span></label>
                      <InlineAlert tone="info"><LockKeyhole size={15} /> Demo personas can continue locally. <Link to={authPath} className="text-link" onClick={saveDraft}>Open production sign-in</Link>.</InlineAlert>
                    </>
                  ) : accountState.kind === "checking" ? (
                    <InlineAlert tone="info"><LockKeyhole size={15} /> Checking your conference account…</InlineAlert>
                  ) : accountState.kind === "anonymous" ? (
                    <>
                      <Field label="Email to use for your account" error={errors.email}><input type="email" autoComplete="email" value={primarySpeaker.email} onChange={(event) => updateSpeaker(0, { email: event.target.value })} placeholder="you@example.com" /></Field>
                      <InlineAlert tone={errors.account ? "danger" : "info"}><LockKeyhole size={15} /><span>Save this draft in your browser, then <Link to={authPath} className="text-link" onClick={saveDraft}>sign in or create a verified account</Link> to continue.{errors.account && <><br /><strong>{errors.account}</strong></>}</span></InlineAlert>
                    </>
                  ) : accountState.kind === "unverified" ? (
                    <>
                      <Field label="Signed-in account" error={errors.account}><input type="email" value={accountState.email} readOnly aria-readonly="true" /></Field>
                      <InlineAlert tone="warning"><Mail size={15} /><span>Verify <strong>{accountState.email}</strong> from the email we sent, then return here. <Link to={authPath} className="text-link" onClick={saveDraft}>Account options</Link></span></InlineAlert>
                    </>
                  ) : accountState.kind === "mismatch" ? (
                    <>
                      <Field label="Verified account email" error={errors.account}><input type="email" value={accountState.email} readOnly aria-readonly="true" /></Field>
                      <InlineAlert tone="danger"><ShieldCheck size={15} /><span>{submissionAccountError(accountState)} <button type="button" className="text-link" onClick={() => { updateSpeaker(0, { email: accountState.email }); setErrors((current) => ({ ...current, account: "" })); }}>Use {accountState.email}</button></span></InlineAlert>
                    </>
                  ) : accountState.kind === "verified" ? (
                    <>
                      <Field label="Verified account email"><input type="email" value={accountState.email} readOnly aria-readonly="true" /></Field>
                      <InlineAlert tone="info"><ShieldCheck size={15} /><span>Verified as <strong>{accountState.email}</strong>. This account will own the proposal.</span></InlineAlert>
                    </>
                  ) : null}
                </div>
              </section>
            )}

            {currentStep.id === "submission" && (
              <section className="form-page">
                <p className="eyebrow">03 / {builder.proposalPageHeading}</p>
                <h2 ref={stepHeadingRef} tabIndex={-1}>{builder.proposalSectionTitle}</h2>
                <p>{builder.proposalInstructions}</p>
                <div className="form-stack">
                  <Field label="Session title" error={errors.title} hint={`${submission.title.length} / 100`}><input maxLength={100} value={submission.title} onChange={(event) => setSubmission({ ...submission, title: event.target.value })} placeholder="The eval flywheel that caught our agent regressions" /></Field>
                  <Field label="Abstract" error={errors.summary} hint={`${submission.summary.length} characters`}><textarea rows={7} value={submission.summary} onChange={(event) => setSubmission({ ...submission, summary: event.target.value })} placeholder="What did you build, what went wrong, and what can another team reuse?" /></Field>
                  <div className="field-grid field-grid--2">
                    {allowsMultipleCategories ? (
                      <Field label="Program tracks" error={errors.category} hint="Choose every track this talk should be reviewed in.">
                        <fieldset className="category-multi-select">
                          <legend className="sr-only">Program tracks</legend>
                          {categoryOptions.map((category) => {
                            const checked = (submission.categories ?? []).includes(category);
                            return <label key={category}><input type="checkbox" checked={checked} onChange={(event) => { const categories = event.target.checked ? [...(submission.categories ?? []), category] : (submission.categories ?? []).filter((value) => value !== category); setSubmission({ ...submission, category: categories[0] ?? "", categories }); }} /><span>{category}</span></label>;
                          })}
                        </fieldset>
                      </Field>
                    ) : <Field label="Program category" error={errors.category}><select value={submission.category} onChange={(event) => setSubmission({ ...submission, category: event.target.value, categories: event.target.value ? [event.target.value] : [] })}><option value="">Select a category</option>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>}
                    <Field label="Preferred format"><select value={submission.format} onChange={(event) => setSubmission({ ...submission, format: event.target.value as ApplicantSubmission["format"] })}><option value="talk">Talk · 30 min</option><option value="workshop">Workshop · 60 min</option><option value="panel">Panel · 45 min</option><option value="lightning">Lightning · 10 min</option></select></Field>
                    <Field label="Audience level"><select value={submission.level} onChange={(event) => setSubmission({ ...submission, level: event.target.value as ApplicantSubmission["level"] })}><option value="introductory">Introductory</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></Field>
                    {collectsRepository && <Field label="Project or repository" hint="Optional"><input type="url" value={submission.repoUrl} onChange={(event) => setSubmission({ ...submission, repoUrl: event.target.value })} placeholder="https://…" /></Field>}
                  </div>
                  {collectsWorkshopNeeds && submission.format === "workshop" && <Field label="Workshop setup requirements" error={errors.workshopNeeds}><textarea rows={4} value={submission.workshopNeeds} onChange={(event) => setSubmission({ ...submission, workshopNeeds: event.target.value })} placeholder="Attendee prerequisites, software, room layout, helpers…" /></Field>}
                  {visibleProposalCustomFields.map((field) => <CustomField key={field.id} field={field} value={responses[field.id]} error={errors[field.id]} onChange={(value) => updateResponse(field.id, value)} />)}
                  <div className={`combined-counter${combinedCharacters > builder.combinedCharacterLimit ? " combined-counter--over" : ""}`}><span>Combined long-text budget</span><strong>{combinedCharacters.toLocaleString()} / {builder.combinedCharacterLimit.toLocaleString()}</strong></div>
                </div>
              </section>
            )}

            {currentStep.id === "participant" && (
              <section className="form-page">
                <p className="eyebrow">04 / {builder.participantPageHeading}</p>
                <h2 ref={stepHeadingRef} tabIndex={-1}>{builder.participantSectionTitle}</h2>
                <p>{builder.participantInstructions}</p>
                <div className="form-stack">
                  <div className="participant-roster__toolbar">
                    <div><Users size={18} /><span><strong>{submission.speakers.length} of {builder.participantMax} speakers</strong><small>At least {builder.participantMin} {builder.participantMin === 1 ? "speaker is" : "speakers are"} required.</small></span></div>
                    <button type="button" className="button button--quiet" onClick={addSpeaker} disabled={submission.speakers.length >= builder.participantMax}><Plus size={15} /> Add co-speaker</button>
                  </div>
                  {errors.participantCount && <InlineAlert tone="danger">{errors.participantCount}</InlineAlert>}
                  <div className="participant-roster">
                    {submission.speakers.map((speaker, index) => {
                      const speakerLabel = index === 0 ? "Primary speaker" : `Co-speaker ${index + 1}`;
                      return (
                        <fieldset className="participant-card" key={index}>
                          <legend className="sr-only">{speakerLabel}</legend>
                          <header className="participant-card__head">
                            <div><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{speakerLabel}</strong><small>{index === 0 ? "Verified proposal owner" : "Included on this proposal"}</small></div></div>
                            {index === 0 ? <span className="participant-owner"><ShieldCheck size={13} /> Owner</span> : <button type="button" className="participant-remove" onClick={() => removeSpeaker(index)} disabled={submission.speakers.length <= builder.participantMin} aria-label={`Remove ${speakerLabel.toLowerCase()}`}><Trash2 size={14} /> Remove</button>}
                          </header>
                          <div className="field-grid field-grid--2">
                            <Field label="First name" error={errors[speakerErrorKey(index, "firstName")]}><input value={speaker.firstName} onChange={(event) => updateSpeaker(index, { firstName: event.target.value })} /></Field>
                            <Field label="Last name" error={errors[speakerErrorKey(index, "lastName")]}><input value={speaker.lastName} onChange={(event) => updateSpeaker(index, { lastName: event.target.value })} /></Field>
                            <Field label="Email address" error={errors[speakerErrorKey(index, "email")]} hint={index === 0 && source === "api" ? "Locked to the verified account that owns this proposal." : undefined}><input type="email" autoComplete={index === 0 ? "email" : "off"} value={speaker.email} readOnly={index === 0 && source === "api"} aria-readonly={index === 0 && source === "api" ? "true" : undefined} onChange={(event) => updateSpeaker(index, { email: event.target.value })} /></Field>
                            <Field label="Role or title" error={errors[speakerErrorKey(index, "title")]}><input value={speaker.title} onChange={(event) => updateSpeaker(index, { title: event.target.value })} placeholder="Staff AI Engineer" /></Field>
                            <Field label="Company / affiliation" error={errors[speakerErrorKey(index, "company")]}><input value={speaker.company} onChange={(event) => updateSpeaker(index, { company: event.target.value })} placeholder="Independent is okay" /></Field>
                          </div>
                          <Field label="Biography" hint={`${speaker.bio.length} / 5,000${index === 0 ? " · editable later in the portal" : ""}`}><textarea rows={5} maxLength={5000} value={speaker.bio} onChange={(event) => updateSpeaker(index, { bio: event.target.value })} placeholder="What perspective and experience do you bring to this subject?" /></Field>
                        </fieldset>
                      );
                    })}
                  </div>
                  {visibleParticipantCustomFields.length > 0 && <div className="participant-custom-fields"><div><strong>Primary speaker questions</strong><small>These published form questions apply to the verified proposal owner.</small></div>{visibleParticipantCustomFields.map((field) => <CustomField key={field.id} field={field} value={responses[field.id]} error={errors[field.id]} onChange={(value) => updateResponse(field.id, value)} />)}</div>}
                </div>
              </section>
            )}

            {currentStep.id === "review" && (
              <section className="form-page review-submit">
                <p className="eyebrow">05 / Review</p>
                <h2 ref={stepHeadingRef} tabIndex={-1}>One final read before it leaves your desk.</h2>
                <p>{editingProposal && applicantRevisionOpen(editingProposal.status) ? "Resubmitting closes this revision window and rebuilds open reviewer work from the current tracks. Final reviews already submitted remain preserved as historical evidence." : "Submitting locks this proposal for review. You can reopen it from your account until the CFP closes; the organizer can also request a controlled revision."}</p>
                <div className="review-sheet">
                  <div><span>TITLE</span><strong>{submission.title || "Not supplied"}</strong><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  <div><span>FORMAT</span><strong>{submission.format} · {submission.level}</strong><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  <div><span>PROGRAM {allowsMultipleCategories ? "TRACKS" : "LANE"}</span><strong>{submission.categories?.length ? submission.categories.join(", ") : submission.category}</strong><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  {submission.speakers.map((speaker, index) => <div className="review-sheet__speaker" key={`${speaker.email}-${index}`}><span>{index === 0 ? "PRIMARY SPEAKER" : `CO-SPEAKER ${index + 1}`}</span><strong>{speaker.firstName} {speaker.lastName}<small>{speaker.email} · {speaker.title} · {speaker.company}</small></strong><button type="button" onClick={() => setStep(stepIndex(builder.collectParticipants ? "participant" : "submission"))}>Edit</button></div>)}
                  <div className="review-sheet__long"><span>ABSTRACT</span><p>{submission.summary}</p><button type="button" onClick={() => setStep(stepIndex("submission"))}>Edit</button></div>
                  {customReviewFields.map(({ field, section }) => <div key={field.id}><span>{field.label.toUpperCase()}</span><strong>{answerLabel(responses[field.id])}</strong><button type="button" onClick={() => setStep(stepIndex(section === "proposal" ? "submission" : "participant"))}>Edit</button></div>)}
                </div>
                <label className={`check-row${submitError ? " check-row--error" : ""}`}><input type="checkbox" checked={permissionConfirmed} onChange={(event) => { setPermissionConfirmed(event.target.checked); setSubmitError(""); }} /><span><strong>I have permission to submit this material.</strong><small>I own or have permission to share everything included here. Recording consent and final speaker terms are handled separately before publication.</small>{submitError && <b>{submitError}</b>}</span></label>
              </section>
            )}
          </div>

          <aside className="submission-aside">
            <div className="draft-card">
              <div><Save size={17} /><span><strong>{draftSyncMessage ? "Account draft saved" : savedAt ? "Browser draft saved" : "Draft protection"}</strong><small aria-live="polite">{draftSyncMessage || (savedAt ? `Browser copy · ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Keep a browser copy or sync to your account")}</small></span></div>
              <div className="draft-card__actions">
                <button type="button" onClick={saveDraft}>Save browser copy</button>
                {source === "api" && accountState.kind === "verified" && <button type="button" className="draft-card__account" disabled={savingAccountDraft || accountProposalsLoading || (cfpClosed && (!editingProposal || applicantRevisionOpen(editingProposal.status))) || Boolean(editingProposal && !applicantMayEdit(editingProposal.status))} onClick={() => void saveDraftToAccount()}><Cloud size={13} /> {savingAccountDraft ? "Saving…" : editingProposal && applicantRevisionOpen(editingProposal.status) ? "Save revision progress" : editingProposal ? "Update account draft" : "Save to account"}</button>}
                {source === "api" && accountState.kind !== "verified" && <Link className="draft-card__sign-in" to={authPath} onClick={saveDraft}><LockKeyhole size={13} /> Sign in to sync</Link>}
              </div>
            </div>
            <div className="deadline-card"><Info size={17} /><div><strong>Deadline is enforced in {timeZoneAbbreviation(cfpDeadline, workspace.event.timezone)}.</strong><p>{cfpClosed ? "The CFP is closed. Saved account drafts remain available, but they cannot be submitted." : "You can keep syncing an account draft; final submission must happen before the deadline."}</p></div></div>
            <ProgressBar label="Application progress" value={step + 1} max={visibleSteps.length} />
          </aside>
        </div>

        <footer className="submission-footer">
          <button type="button" className="button button--quiet" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={15} /> Back</button>
          <span>Step {step + 1} of {visibleSteps.length}</span>
          {currentStep.id === "review" ? <button type="button" className="button button--primary button--large" disabled={!permissionConfirmed || submitting || cfpClosed} onClick={() => void submitCurrentProposal()}><CheckCircle2 size={16} /> {submitting ? "Submitting…" : cfpClosed ? "CFP closed" : editingProposal && applicantRevisionOpen(editingProposal.status) ? "Resubmit revision" : editingProposal ? "Submit saved draft" : "Submit proposal"}</button> : <button type="button" className="button button--primary" onClick={goNext}>Continue <ArrowRight size={15} /></button>}
        </footer>
      </main>
      <NoticeRegion />
      {withdrawTarget && <WithdrawProposalDialog proposal={withdrawTarget} busy={withdrawing} error={withdrawError} returnFocusRef={withdrawReturnFocusRef} onClose={() => { if (!withdrawing) setWithdrawTarget(null); }} onConfirm={() => void confirmWithdrawal()} />}
    </div>
  );
}
