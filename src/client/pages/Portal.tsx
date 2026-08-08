import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  FileUp,
  Home,
  Link2,
  ListChecks,
  Save,
  UserRound,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import type { SpeakerProfile } from "../../shared/domain";
import { Avatar, EmptyState, Field, InlineAlert, NoticeRegion, ProgressBar, SectionHeading, StatusPill } from "../components";
import { PublicHeader } from "../Shell";
import { useWorkspace } from "../workspace";

const portalTabs = [
  { id: "home", label: "Home", icon: Home },
  { id: "submissions", label: "Submissions", icon: FileText },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "profile", label: "Profile", icon: UserRound },
] as const;

function dueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function SpeakerPortrait({ speaker, size = "lg" }: { speaker: SpeakerProfile; size?: "sm" | "md" | "lg" }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!speaker.headshotUrl || failedUrl === speaker.headshotUrl) {
    return <Avatar name={speaker.name} size={size} />;
  }
  return (
    <img
      className={`speaker-portrait speaker-portrait--${size}`}
      src={speaker.headshotUrl}
      alt={`Headshot of ${speaker.name}`}
      onError={() => setFailedUrl(speaker.headshotUrl ?? null)}
    />
  );
}

export function SpeakerPortal() {
  const { workspace, toggleTask, updateProfile, uploadHeadshot, uploadTaskArtifact, submitTaskForm } = useWorkspace();
  const params = useParams();
  const active = portalTabs.some((tab) => tab.id === params.section) ? params.section! : "home";
  const allSpeakers = useMemo(() => {
    const map = new Map<string, SpeakerProfile>();
    workspace.proposals.forEach((proposal) => proposal.speakers.forEach((speaker) => map.set(speaker.id, speaker)));
    return [...map.values()];
  }, [workspace.proposals]);
  const speaker = allSpeakers.find((candidate) => candidate.email === workspace.actor.email) ?? allSpeakers[0];
  const proposals = workspace.proposals.filter((proposal) => proposal.speakers.some((candidate) => candidate.id === speaker?.id));
  const tasks = workspace.tasks.filter((task) => task.speakerId === speaker?.id);
  const completeTasks = tasks.filter((task) => task.status === "complete").length;

  return (
    <div className="public-page portal-page">
      <PublicHeader active="portal" />
      <header className="portal-banner">
        <div><p className="eyebrow">Speaker portal · {workspace.event.shortName}</p><h1>Welcome back, {speaker?.name.split(" ")[0] ?? workspace.actor.name.split(" ")[0]}.</h1><p>Track program decisions, complete production work, and control the profile attendees will see.</p></div>
        {speaker && <div className="portal-identity"><SpeakerPortrait speaker={speaker} /><span><strong>{speaker.name}</strong><small>{speaker.email}</small></span><ChevronDown size={16} /></div>}
      </header>
      <nav className="portal-tabs" aria-label="Speaker portal"><div>{portalTabs.map((tab) => { const Icon = tab.icon; return <NavLink key={tab.id} to={`/portal/${tab.id}`} className={active === tab.id ? "active" : ""}><Icon size={16} />{tab.label}{tab.id === "tasks" && tasks.length > 0 && <span>{tasks.filter((task) => task.status !== "complete").length}</span>}</NavLink>; })}</div></nav>
      <main className="portal-canvas">
        {!speaker ? <EmptyState title="No speaker profile yet" detail="Submit a proposal first, then return here to manage your public details." /> : <>
          {active === "home" && <PortalHome speaker={speaker} proposals={proposals} tasks={tasks} completeTasks={completeTasks} />}
          {active === "submissions" && <PortalSubmissions proposals={proposals} />}
          {active === "tasks" && <PortalTasks tasks={tasks} onToggle={toggleTask} onUpload={uploadTaskArtifact} onSubmitForm={submitTaskForm} />}
          {active === "profile" && <PortalProfile speaker={speaker} onSave={(patch) => updateProfile(speaker.id, patch)} onUpload={(file) => uploadHeadshot(speaker.id, file)} />}
        </>}
      </main>
      <NoticeRegion />
    </div>
  );
}

function PortalHome({ speaker, proposals, tasks, completeTasks }: { speaker: SpeakerProfile; proposals: ReturnType<typeof useWorkspace>["workspace"]["proposals"]; tasks: ReturnType<typeof useWorkspace>["workspace"]["tasks"]; completeTasks: number }) {
  return (
    <>
      <div className="portal-overview-grid">
        <section className="portal-panel portal-panel--submissions"><SectionHeading title={`My submissions (${proposals.length})`} action={<NavLink to="/portal/submissions" className="text-link">View all <ArrowRight size={14} /></NavLink>} />{proposals.map((proposal) => <NavLink to="/portal/submissions" className="portal-proposal" key={proposal.id}><span className="portal-proposal__id">{proposal.id.slice(-6).toUpperCase()}</span><div><strong>{proposal.title}</strong><small>{proposal.format} · {proposal.category}</small></div><StatusPill status={proposal.status} /></NavLink>)}</section>
        <section className="portal-panel portal-panel--profile"><SectionHeading title="My public profile" action={<NavLink to="/portal/profile" className="text-link">Edit <ArrowRight size={14} /></NavLink>} /><div className="profile-summary"><SpeakerPortrait speaker={speaker} /><div><h3>{speaker.name}</h3><p>{speaker.title} · {speaker.company}</p><small>{speaker.email}</small></div></div><p>{speaker.bio || "Add a biography so attendees know the perspective behind your session."}</p><StatusPill status={speaker.profileComplete ? "profile ready" : "profile incomplete"} /></section>
      </div>
      <section className="portal-panel portal-panel--tasks"><SectionHeading title="Production tasks" description="Your speaker team can see these updates immediately." action={<NavLink to="/portal/tasks" className="text-link">Open all <ArrowRight size={14} /></NavLink>} /><ProgressBar label="Onboarding progress" value={completeTasks} max={Math.max(1, tasks.length)} /><div className="portal-task-preview">{tasks.filter((task) => task.status !== "complete").slice(0, 3).map((task) => <NavLink to="/portal/tasks" key={task.id}><span className={`task-dot task-dot--${task.status}`} /><div><strong>{task.title}</strong><small>Due {dueDate(task.dueAt)}</small></div><StatusPill status={task.status} /></NavLink>)}{!tasks.filter((task) => task.status !== "complete").length && <EmptyState title="You’re clear" detail="No open speaker tasks. We will notify you when production adds one." />}</div></section>
    </>
  );
}

function PortalSubmissions({ proposals }: { proposals: ReturnType<typeof useWorkspace>["workspace"]["proposals"] }) {
  return (
    <section className="portal-panel portal-panel--wide"><SectionHeading title="My submissions" description="Current decisions and the exact version sent to reviewers." action={<NavLink to="/submit/ai-engineer-summit-2026" className="button button--quiet">Submit another</NavLink>} />
      <div className="portal-submission-list">{proposals.map((proposal) => <article key={proposal.id}><div className="portal-submission-list__top"><div><p className="eyebrow">{proposal.id.slice(-8).toUpperCase()} · Submitted {dueDate(proposal.submittedAt)}</p><h2>{proposal.title}</h2></div><StatusPill status={proposal.status} /></div><p>{proposal.summary}</p><dl><div><dt>Format</dt><dd>{proposal.format} · {proposal.durationMinutes} min</dd></div><div><dt>Program lane</dt><dd>{proposal.category}</dd></div><div><dt>Review activity</dt><dd>{proposal.reviewCount ? `${proposal.reviewCount} committee reviews` : "Not started"}</dd></div></dl>{["draft", "submitted"].includes(proposal.status) && <button type="button" className="button button--quiet">Revise before deadline</button>}</article>)}</div>
      {!proposals.length && <EmptyState title="No submissions yet" detail="Start with a practical story, concrete evidence, and a clear attendee promise." action={<NavLink to="/submit/ai-engineer-summit-2026" className="button button--primary">Start a proposal</NavLink>} />}
    </section>
  );
}

function PortalTasks({ tasks, onToggle, onUpload, onSubmitForm }: { tasks: ReturnType<typeof useWorkspace>["workspace"]["tasks"]; onToggle: (id: string, complete: boolean) => Promise<void>; onUpload: (id: string, file: File) => Promise<void>; onSubmitForm: (id: string, responses: Record<string, unknown>) => Promise<void> }) {
  const [filter, setFilter] = useState("open");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [formTaskId, setFormTaskId] = useState<string | null>(null);
  const [formResponse, setFormResponse] = useState("");
  const [error, setError] = useState("");
  const visible = tasks.filter((task) => filter === "all" || (filter === "open" ? task.status !== "complete" : task.status === filter));
  return (
    <section className="portal-panel portal-panel--wide"><SectionHeading title="My tasks" description="Profiles, documents, forms, and calendar acknowledgements in one list." action={<label className="select-control"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Open work</option><option value="all">All tasks</option><option value="overdue">Overdue</option><option value="complete">Completed</option></select></label>} />
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="portal-task-list">{visible.map((task) => { const Icon = task.type === "upload" ? FileUp : task.type === "calendar" ? CalendarDays : task.type === "profile" ? UserRound : BriefcaseBusiness; const mode = task.completionMode ?? (task.type === "upload" ? "file_request" : task.type === "form" ? "form" : "manual"); return <article key={task.id} className={task.status === "complete" ? "complete" : ""}>{mode === "manual" ? <button type="button" className="task-check" disabled={workingId === task.id} onClick={async () => { setWorkingId(task.id); setError(""); try { await onToggle(task.id, task.status !== "complete"); } catch (reason) { setError(reason instanceof Error ? reason.message : "The task could not be updated."); } finally { setWorkingId(null); } }} aria-label={`${task.status === "complete" ? "Reopen" : "Complete"} ${task.title}`}>{task.status === "complete" && <Check size={15} />}</button> : <span className="task-check" aria-hidden="true">{task.status === "complete" && <Check size={15} />}</span>}<span className="task-icon"><Icon size={18} /></span><div><strong>{task.title}</strong><p>{task.description}</p><small>Due {dueDate(task.dueAt)}</small>{mode === "file_request" && task.status !== "complete" && <label className="button button--quiet upload-button"><FileUp size={14} /> {workingId === task.id ? "Uploading…" : "Upload required file"}<input type="file" disabled={workingId === task.id} accept=".pdf,.ppt,.pptx,.doc,.docx,.txt" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setWorkingId(task.id); setError(""); try { await onUpload(task.id, file); } catch (reason) { setError(reason instanceof Error ? reason.message : "The file could not be uploaded."); } finally { setWorkingId(null); } }} /></label>}{mode === "form" && task.status !== "complete" && <button type="button" className="button button--quiet" onClick={() => { setFormTaskId(task.id); setFormResponse(""); setError(""); }}><FileText size={14} /> Open required form</button>}{task.type === "profile" && task.status !== "complete" && mode !== "manual" && <NavLink to="/portal/profile" className="button button--quiet"><UserRound size={14} /> Update profile</NavLink>}</div><StatusPill status={task.status} /></article>; })}</div>
      {!visible.length && <EmptyState title={filter === "open" ? "No open tasks" : "Nothing in this view"} detail={filter === "open" ? "Production will notify you when another action is assigned." : "Change the filter to see other speaker tasks."} />}
      {formTaskId && <form className="task-response-panel" onSubmit={async (event) => { event.preventDefault(); setWorkingId(formTaskId); setError(""); try { await onSubmitForm(formTaskId, { acknowledgement: formResponse.trim() }); setFormTaskId(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "The linked form could not be submitted."); } finally { setWorkingId(null); } }}><SectionHeading title={tasks.find((task) => task.id === formTaskId)?.title ?? "Required form"} description="Submit the requested response to complete this task; closing it does not mark work complete." /><Field label="Response / acknowledgement"><textarea required rows={5} value={formResponse} onChange={(event) => setFormResponse(event.target.value)} placeholder="Provide the requested details or confirmation…" /></Field><div className="button-row"><button type="button" className="button button--quiet" onClick={() => setFormTaskId(null)}>Close</button><button type="submit" className="button button--primary" disabled={workingId === formTaskId || formResponse.trim().length < 2}>{workingId === formTaskId ? "Submitting…" : "Submit required form"}</button></div></form>}
    </section>
  );
}

function PortalProfile({
  speaker,
  onSave,
  onUpload,
}: {
  speaker: SpeakerProfile;
  onSave: (patch: Partial<SpeakerProfile>) => Promise<void>;
  onUpload: (file: File) => Promise<Pick<SpeakerProfile, "headshotUrl" | "profileComplete">>;
}) {
  const [draft, setDraft] = useState(speaker);
  const [links, setLinks] = useState({ linkedIn: "", x: "", website: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const uploadHintId = useId();
  const completeness = [
    draft.name.trim(),
    draft.email.trim(),
    draft.title.trim(),
    draft.company.trim(),
    draft.bio.trim(),
    draft.headshotUrl,
  ].filter(Boolean).length;

  return (
    <form
      className="portal-profile"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
          await onSave({
            name: draft.name,
            title: draft.title,
            company: draft.company,
            bio: draft.bio,
            pronouns: draft.pronouns,
            city: draft.city,
          });
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "The profile could not be saved.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="portal-profile__intro">
        <SpeakerPortrait speaker={draft} />
        <div>
          <p className="eyebrow">Profile info</p>
          <h2>{draft.name}</h2>
          <p>This is the source for public speaker pages and organizer exports.</p>
        </div>
        <ProgressBar label="Profile completeness" value={completeness} max={6} />
      </div>
      <section className="portal-panel">
        <SectionHeading title="General" description="Update your own biography and public identity." />
        <Field label="Biography" hint={`${draft.bio.length} / 5,000 characters`}>
          <textarea rows={9} maxLength={5000} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} />
        </Field>
        <div className="field-grid field-grid--2">
          <Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <Field label="Account email" hint="Managed by your verified sign-in account"><input type="email" value={draft.email} disabled /></Field>
          <Field label="Role or title"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
          <Field label="Company / affiliation"><input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></Field>
          <Field label="Pronouns" hint="Optional"><input value={draft.pronouns ?? ""} onChange={(event) => setDraft({ ...draft, pronouns: event.target.value })} placeholder="e.g. she/her" /></Field>
          <Field label="City" hint="Optional"><input value={draft.city ?? ""} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></Field>
        </div>
      </section>
      <div className="portal-profile__side">
        <section className="portal-panel portal-headshot">
          <SectionHeading
            title="Public headshot"
            description="Use a clear, recent portrait that crops well to a square."
            action={<StatusPill status={draft.headshotUrl ? "headshot ready" : "headshot missing"} />}
          />
          <div className="portal-headshot__preview">
            <SpeakerPortrait speaker={draft} />
          </div>
          <label
            className={`button button--quiet button--full headshot-upload${uploading ? " headshot-upload--working" : ""}`}
            aria-disabled={uploading || saving}
          >
            <FileUp size={15} />
            {uploading ? "Uploading and saving…" : draft.headshotUrl ? "Replace headshot" : "Upload headshot"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby={uploadHintId}
              disabled={uploading || saving}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setUploading(true);
                setUploadError("");
                setUploadStatus("");
                try {
                  const saved = await onUpload(file);
                  setDraft((current) => ({ ...current, ...saved }));
                  setUploadStatus(`${file.name} is saved to your public profile.`);
                } catch (reason) {
                  setUploadError(reason instanceof Error ? reason.message : "The headshot could not be uploaded.");
                } finally {
                  input.value = "";
                  setUploading(false);
                }
              }}
            />
          </label>
          <p className="portal-headshot__hint" id={uploadHintId}>JPEG, PNG, or WebP · 10 MB maximum</p>
          <span className="portal-headshot__status" role="status" aria-live="polite">
            {uploading ? "Uploading the image, then saving it to your profile." : uploadStatus}
          </span>
          {uploadError && <InlineAlert tone="danger">{uploadError}</InlineAlert>}
        </section>
        <section className="portal-panel">
          <SectionHeading title="My links" description="Only populated links appear on the public gallery." />
          <div className="form-stack">
            <Field label="LinkedIn URL"><div className="input-with-icon"><Link2 size={15} /><input type="url" value={links.linkedIn} onChange={(event) => setLinks({ ...links, linkedIn: event.target.value })} placeholder="https://linkedin.com/in/…" /></div></Field>
            <Field label="X / Twitter URL"><div className="input-with-icon"><Link2 size={15} /><input type="url" value={links.x} onChange={(event) => setLinks({ ...links, x: event.target.value })} placeholder="https://x.com/…" /></div></Field>
            <Field label="Website"><div className="input-with-icon"><Link2 size={15} /><input type="url" value={links.website} onChange={(event) => setLinks({ ...links, website: event.target.value })} placeholder="https://…" /></div></Field>
          </div>
        </section>
      </div>
      <div className="portal-profile__save">
        <span role={error ? "alert" : undefined}>{error || "Changes remain private until you save."}</span>
        <button type="submit" className="button button--primary button--large" disabled={saving || uploading}>
          <Save size={16} /> {saving ? "Saving…" : "Save public profile"}
        </button>
      </div>
    </form>
  );
}
