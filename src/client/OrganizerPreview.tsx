import { ArrowUpRight, ClipboardCheck, Eye, Globe2, Mic2, Send, UserRound, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isOutstandingTaskStatus } from "../shared/task-status";
import { EmptyState, StatusPill } from "./components";
import { useDialogA11y } from "./dialog-a11y";
import { privateEventPath } from "./private-routes";
import { publicAgendaPath, publicSubmissionPath } from "./public-routes";
import { useWorkspace } from "./workspace";

type PreviewRole = "applicant" | "reviewer" | "speaker" | "public";

const previewRoles = [
  { id: "applicant", label: "Applicant", icon: Send },
  { id: "reviewer", label: "Reviewer", icon: ClipboardCheck },
  { id: "speaker", label: "Speaker", icon: Mic2 },
  { id: "public", label: "Public", icon: Globe2 },
] as const;

function PreviewBody({ role }: { role: PreviewRole }) {
  const { workspace, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const form = workspace.forms.find((candidate) => candidate.kind === "cfp") ?? workspace.forms[0];
  const proposal = workspace.proposals.find((candidate) => ["submitted", "under_review"].includes(candidate.status)) ?? workspace.proposals[0];
  const accepted = workspace.proposals.filter((candidate) => ["accepted", "session"].includes(candidate.status));
  const speaker = accepted.flatMap((candidate) => candidate.speakers)[0];
  const speakerTasks = speaker ? workspace.tasks.filter((task) => task.speakerId === speaker.id) : [];
  const nextTask = speakerTasks.find((task) => isOutstandingTaskStatus(task.status));
  const publishedSessions = workspace.sessions.filter((session) => session.status === "published");
  const publishedSpeakers = new Map(accepted.flatMap((candidate) => candidate.speakers).map((candidate) => [candidate.id, candidate])).size;

  if (role === "applicant") return (
    <div className="organizer-preview-card">
      <p className="eyebrow">Applicant sees</p><h3>{form?.publicTitle ?? `Call for Speakers · ${workspace.event.name}`}</h3>
      <p>{form?.welcomeCopy ?? "A focused application with proposal and participant details."}</p>
      <dl><div><dt>Submission state</dt><dd><StatusPill status={form?.status ?? "draft"} /></dd></div><div><dt>Fields</dt><dd>{form?.fields.length ?? 0} configured</dd></div><div><dt>Confirmation</dt><dd>{form?.confirmationEmailEnabled === false ? "On-screen only" : "Email + portal"}</dd></div></dl>
      <Link className="button button--primary" to={publicSubmissionPath(workspace.event.slug)} target="_blank" rel="noreferrer">Open applicant view <ArrowUpRight size={14} /></Link>
    </div>
  );
  if (role === "reviewer") return proposal ? (
    <div className="organizer-preview-card">
      <p className="eyebrow">Reviewer sees · identity rules applied</p><h3>{proposal.title}</h3><p>{proposal.summary}</p>
      <dl><div><dt>Program lane</dt><dd>{proposal.category}</dd></div><div><dt>Evidence</dt><dd>{proposal.reviewCount} submitted reviews</dd></div><div><dt>State</dt><dd><StatusPill status={proposal.status} /></dd></div></dl>
      <Link className="button button--primary" to={privateEventPath("/reviews", eventId, "organizer")}>Inspect review workflow <ArrowUpRight size={14} /></Link>
    </div>
  ) : <EmptyState title="No proposal to preview" detail="The reviewer projection appears after the first test proposal arrives." />;
  if (role === "speaker") return speaker ? (
    <div className="organizer-preview-card organizer-preview-card--speaker">
      <p className="eyebrow">Speaker sees</p><span className="organizer-preview-avatar"><UserRound size={24} /></span><h3>Welcome back, {speaker.name.split(" ")[0]}.</h3>
      <p>{nextTask ? `Your next action is “${nextTask.title}.”` : "Your onboarding runway is clear."}</p>
      <dl><div><dt>Tasks</dt><dd>{speakerTasks.filter((task) => isOutstandingTaskStatus(task.status)).length} open</dd></div><div><dt>Profile</dt><dd>{speaker.profileComplete ? "Ready" : "Needs details"}</dd></div><div><dt>Sessions</dt><dd>{accepted.filter((candidate) => candidate.speakers.some((candidateSpeaker) => candidateSpeaker.id === speaker.id)).length}</dd></div></dl>
      <Link className="button button--primary" to={privateEventPath("/portal/home", eventId, "organizer")}>Open read-only portal preview <ArrowUpRight size={14} /></Link>
    </div>
  ) : <EmptyState title="No accepted speaker yet" detail="Accept a test proposal to preview generated speaker work." />;
  return (
    <div className="organizer-preview-card organizer-preview-card--public" style={{ "--event-accent": workspace.event.accent } as React.CSSProperties}>
      <p className="eyebrow">Attendees see</p><h3>{workspace.event.name}</h3><p>{workspace.event.description}</p>
      <div className="organizer-preview-public-stats"><span><strong>{publishedSessions.length}</strong> sessions</span><span><strong>{publishedSpeakers}</strong> speakers</span><span><strong>{workspace.resources.filter((resource) => resource.status === "published").length}</strong> resources</span></div>
      <Link className="button button--primary" to={publicAgendaPath(workspace.event.slug)} target="_blank" rel="noreferrer">Open public program <ArrowUpRight size={14} /></Link>
    </div>
  );
}

export function OrganizerPreview({ onClose, returnFocusRef }: { onClose: () => void; returnFocusRef?: React.RefObject<HTMLElement | null> }) {
  const [role, setRole] = useState<PreviewRole>("applicant");
  const fallbackReturn = useRef<HTMLElement | null>(null);
  const effectiveReturn = returnFocusRef ?? fallbackReturn;
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose, true, effectiveReturn);
  const currentLabel = useMemo(() => previewRoles.find((candidate) => candidate.id === role)?.label, [role]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={dialogRef} className="organizer-preview" role="dialog" aria-modal="true" aria-labelledby="organizer-preview-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow"><Eye size={14} /> Safe persona preview</p><h2 id="organizer-preview-title">See the event before they do.</h2><p>This projection is read-only. It never changes identity, sends a message, or commits workflow state.</p></div><button type="button" className="icon-button" aria-label="Close persona preview" onClick={onClose}><X size={18} /></button></header>
        <nav aria-label="Preview persona">{previewRoles.map((candidate) => { const Icon = candidate.icon; return <button data-dialog-initial-focus={candidate.id === "applicant" || undefined} key={candidate.id} type="button" aria-pressed={role === candidate.id} className={role === candidate.id ? "active" : ""} onClick={() => setRole(candidate.id)}><Icon size={16} />{candidate.label}</button>; })}</nav>
        <div className="organizer-preview__canvas" aria-label={`${currentLabel} preview`}><PreviewBody role={role} /></div>
        <footer><Eye size={15} /><span>Preview mode · no data changes</span></footer>
      </div>
    </div>
  );
}
