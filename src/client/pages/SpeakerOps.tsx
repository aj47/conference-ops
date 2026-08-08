import {
  BellRing,
  CalendarClock,
  Check,
  FileUp,
  ListChecks,
  LockKeyhole,
  Mail,
  Plus,
  Search,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { OnboardingTask, SpeakerProfile } from "../../shared/domain";
import { isAcceptedProposalStatus } from "../../shared/proposal-status";
import { isOutstandingTaskStatus, isResolvedTaskStatus } from "../../shared/task-status";
import { conferenceApi } from "../api";
import { Avatar, EmptyState, Field, InlineAlert, PageHeader, ProgressBar, StatusPill } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import { addMinutes, dateTimeLocalToInstant, instantToDateTimeLocal } from "../event-time";
import { FormResponseList } from "../FormResponseList";
import { TaskArtifactEvidence } from "../TaskArtifactEvidence";
import { taskFormResponseItems } from "../task-form-model";
import { resolveSpeakerOpsTarget } from "../speaker-ops-target";
import { useWorkspace } from "../workspace";

function AddTaskDialog({ speaker, onClose }: { speaker: SpeakerProfile; onClose: () => void }) {
  const { workspace, addTask, setNotice } = useWorkspace();
  const dialogRef = useDialogA11y<HTMLFormElement>(onClose);
  const [title, setTitle] = useState("Confirm public speaker profile");
  const [description, setDescription] = useState("Review your name, title, company, biography, and headshot as attendees will see them.");
  const [dueAt, setDueAt] = useState(() => instantToDateTimeLocal(addMinutes(workspace.event.startsAt, -7 * 24 * 60), workspace.event.timezone));
  const [type, setType] = useState<Extract<OnboardingTask["type"], "profile" | "calendar">>("profile");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form ref={dialogRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="task-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); addTask({ speakerId: speaker.id, title, description, dueAt: dateTimeLocalToInstant(dueAt, workspace.event.timezone), type }); setNotice("Local demo task added for this workspace session."); onClose(); }}>
        <div className="drawer__head"><div><p className="eyebrow">Demo workspace · {speaker.name}</p><h2 id="task-title">New local onboarding task</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="drawer__body form-stack">
          <InlineAlert tone="info">Local tasks are for exercising the workflow and are not persisted to the production task service.</InlineAlert>
          <Field label="Task"><input data-dialog-initial-focus required value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Instructions"><textarea required rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <div className="field-grid field-grid--2"><Field label="Due"><input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></Field><Field label="Task type"><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="profile">Profile</option><option value="calendar">Calendar</option></select></Field></div>
        </div>
        <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary"><Plus size={15} /> Add local task</button></div>
      </form>
    </div>
  );
}

export function SpeakerOperations() {
  const { workspace, source, privateWorkspaceEventId, toggleTask, downloadTaskArtifact, setNotice } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const speakers = useMemo(() => {
    const map = new Map<string, SpeakerProfile>();
    workspace.proposals
      .filter((proposal) => proposal.eventId === eventId && isAcceptedProposalStatus(proposal.status))
      .forEach((proposal) => proposal.speakers.forEach((speaker) => map.set(speaker.id, speaker)));
    return [...map.values()];
  }, [eventId, workspace.proposals]);
  const eventTasks = useMemo(
    () => workspace.tasks.filter((task) => task.eventId === eventId),
    [eventId, workspace.tasks],
  );
  const target = resolveSpeakerOpsTarget(searchParams, eventId, speakers, eventTasks);
  const [query, setQuery] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [workingTaskId, setWorkingTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const targetTaskRef = useRef<HTMLElement>(null);
  const filtered = speakers.filter((speaker) => `${speaker.name} ${speaker.email} ${speaker.company}`.toLowerCase().includes(query.toLowerCase()));
  const selected = speakers.find((speaker) => speaker.id === target.speakerId) ?? filtered[0] ?? speakers[0];
  const selectedTasks = eventTasks.filter((task) => task.speakerId === selected?.id);
  const acceptedTasks = eventTasks.filter((task) => speakers.some((speaker) => speaker.id === task.speakerId));
  const completeCount = acceptedTasks.filter((task) => isResolvedTaskStatus(task.status)).length;
  const knownSpeakerIds = new Set(speakers.map((speaker) => speaker.id));
  const overdueSpeakerIds = [...new Set(eventTasks
    .filter((task) => task.status === "overdue" && knownSpeakerIds.has(task.speakerId))
    .map((task) => task.speakerId))];

  useEffect(() => {
    if (!target.taskId || !targetTaskRef.current) return;
    targetTaskRef.current.focus({ preventScroll: true });
    targetTaskRef.current.scrollIntoView({ block: "center" });
  }, [target.taskId]);

  const selectSpeaker = (speakerId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("eventId", eventId);
    next.set("speakerId", speakerId);
    next.delete("taskId");
    setSearchParams(next, { replace: true });
  };

  const downloadArtifact = async (taskId: string) => {
    setWorkingTaskId(taskId);
    setTaskError(null);
    try {
      await downloadTaskArtifact(taskId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "The submitted file could not be downloaded.");
    } finally {
      setWorkingTaskId(null);
    }
  };

  const queueOverdueReminders = async () => {
    if (!overdueSpeakerIds.length) {
      setReminderError("No speakers currently have overdue tasks.");
      return;
    }
    setSendingReminders(true);
    setReminderError(null);
    const operationId = crypto.randomUUID();
    try {
      const recipientBatches = Array.from(
        { length: Math.ceil(overdueSpeakerIds.length / 50) },
        (_, index) => overdueSpeakerIds.slice(index * 50, (index + 1) * 50),
      );
      const results = await Promise.all(recipientBatches.map((recipientIds, index) =>
        conferenceApi.sendCommunication(workspace.actor.id, workspace.event.id, {
          kind: "reminder",
          recipientIds,
          idempotencyKey: `${operationId}:${index + 1}`,
        })));
      const queued = results.reduce((total, result) => total + result.queued, 0);
      setNotice(`${queued} overdue task ${queued === 1 ? "reminder" : "reminders"} queued for delivery.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Overdue reminders could not be queued.";
      setReminderError(message);
      setNotice(message);
    } finally {
      setSendingReminders(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Accepted speaker onboarding" title="Turn acceptance into readiness." description="Profiles, files, forms, and calendar acknowledgement stay visible as one operational queue." actions={<button type="button" className="button button--primary" disabled={sendingReminders || overdueSpeakerIds.length === 0} onClick={() => void queueOverdueReminders()}><BellRing size={16} /> {sendingReminders ? "Queuing reminders…" : `Send overdue reminders (${overdueSpeakerIds.length})`}</button>} />
      {reminderError && <InlineAlert tone="danger">{reminderError}</InlineAlert>}
      <div className="readiness-strip">
        <ProgressBar label="All onboarding tasks" value={completeCount} max={acceptedTasks.length} />
        <div><strong>{speakers.filter((speaker) => speaker.profileComplete).length}/{speakers.length}</strong><span>profiles ready</span></div>
        <div><strong>{acceptedTasks.filter((task) => task.status === "overdue").length}</strong><span>overdue</span></div>
        <div><strong>{acceptedTasks.filter((task) => task.type === "upload" && isOutstandingTaskStatus(task.status)).length}</strong><span>files outstanding</span></div>
      </div>
      <div className="speaker-ops-layout">
        <section className="speaker-roster">
          <div className="speaker-roster__search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a speaker…" /></div>
          {filtered.map((speaker) => {
            const tasks = eventTasks.filter((task) => task.speakerId === speaker.id);
            const open = tasks.filter((task) => isOutstandingTaskStatus(task.status)).length;
            return <button type="button" className={selected?.id === speaker.id ? "speaker-roster__row selected" : "speaker-roster__row"} key={speaker.id} onClick={() => selectSpeaker(speaker.id)}><Avatar name={speaker.name} /><span><strong>{speaker.name}</strong><small>{speaker.title} · {speaker.company}</small></span><span className="roster-status"><b>{open}</b><small>open</small></span></button>;
          })}
          {!filtered.length && <EmptyState title="No speaker found" detail="Try a name, email address, or company." />}
        </section>
        {selected && <section className="speaker-workfile">
          <header className="speaker-workfile__head"><Avatar name={selected.name} size="lg" /><div><p className="eyebrow">Speaker workfile</p><h2>{selected.name}</h2><p>{selected.title} · {selected.company}</p></div><StatusPill status={selected.profileComplete ? "profile ready" : "profile incomplete"} /></header>
          <div className="speaker-contact"><span><Mail size={15} /> {selected.email}</span><span><UserRoundCheck size={15} /> {workspace.proposals.filter((proposal) => proposal.eventId === eventId && proposal.speakers.some((speaker) => speaker.id === selected.id)).map((proposal) => proposal.status).join(", ")}</span></div>
          <div className="speaker-bio"><h3>Public biography</h3><p>{selected.bio || "No biography supplied yet."}</p></div>
          <div className="builder-section__head"><div><h3>Assigned tasks</h3><p>{selectedTasks.length} items connected to this speaker.</p></div>{source === "demo" ? <button type="button" className="button button--quiet" onClick={() => setAddingTask(true)}><Plus size={15} /> Add local task</button> : <span className="muted">Workflow-managed</span>}</div>
          {taskError && <InlineAlert tone="danger">{taskError}</InlineAlert>}
          <div className="task-list">
            {selectedTasks.map((task) => {
              const targeted = task.id === target.taskId;
              const Icon = task.type === "upload" ? FileUp : task.type === "calendar" ? CalendarClock : task.type === "profile" ? Users : ListChecks;
              const linkedCompletion = task.type === "upload" || task.type === "form" || task.completionMode === "file_request" || task.completionMode === "form";
              const canToggle = task.status !== "waived" && !linkedCompletion && (task.type === "profile" || task.type === "calendar" || task.completionMode === "manual");
              const evidenceSource = task.type === "upload" || task.completionMode === "file_request" ? "file upload" : "form response";
              const due = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(task.dueAt));
              const responses = task.form?.responseStatus === "submitted"
                ? taskFormResponseItems(task.form.fields, task.form.response)
                : [];
              return (
                <article
                  key={task.id}
                  ref={targeted ? targetTaskRef : undefined}
                  className={`task-row task-row--${task.status}${targeted ? " task-row--targeted" : ""}`}
                  aria-current={targeted ? "true" : undefined}
                  tabIndex={targeted ? -1 : undefined}
                >
                  {canToggle
                    ? <button type="button" className="task-check" onClick={() => void toggleTask(task.id, task.status !== "complete")} aria-label={`${task.status === "complete" ? "Reopen" : "Complete"} ${task.title}`}>{task.status === "complete" && <Check size={15} />}</button>
                    : <span className="task-check" role="img" aria-label={task.status === "waived" ? `${task.title} was waived` : `${task.title} completion is verified from the linked ${evidenceSource}`} title={task.status === "waived" ? "No action required" : "Completion is verified from the speaker portal"}><LockKeyhole size={12} /></span>}
                  <Icon size={18} />
                  <div>
                    <strong>{task.title}</strong>
                    {task.targetTitle && <small>For “{task.targetTitle}”</small>}
                    <p>{task.description}</p>
                    <small>{task.status === "waived" ? "Waived · no action required" : `Due ${due}${!canToggle ? ` · Verified from ${evidenceSource}` : ""}`}</small>
                    <TaskArtifactEvidence task={task} busy={workingTaskId === task.id} onDownload={() => void downloadArtifact(task.id)} />
                    <FormResponseList responses={responses} title="Submitted form responses" />
                  </div>
                  <StatusPill status={task.status} />
                </article>
              );
            })}
            {!selectedTasks.length && <EmptyState title="No tasks assigned" detail="This speaker is clear, or their onboarding plan has not been created yet." action={source === "demo" ? <button type="button" className="button button--quiet" onClick={() => setAddingTask(true)}>Add first local task</button> : undefined} />}
          </div>
        </section>}
      </div>
      {source === "demo" && addingTask && selected && <AddTaskDialog speaker={selected} onClose={() => setAddingTask(false)} />}
    </>
  );
}
