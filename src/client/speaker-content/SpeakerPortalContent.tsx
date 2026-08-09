import { CalendarDays, ExternalLink, Linkedin, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { SpeakerContentSnapshot, SpeakerSocialLinks } from "../../shared/speaker-content";
import { EmptyState, Field, InlineAlert, StatusPill } from "../components";
import { managedSpeakerPayload, speakerContentApi } from "../speaker-content-api";
import { useWorkspace } from "../workspace";
import "./speaker-content.css";

function usePortalSpeakerContent() {
  const { workspace, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [snapshot, setSnapshot] = useState<SpeakerContentSnapshot | null>(null);
  const [error, setError] = useState("");
  const refresh = async () => {
    setError("");
    try {
      setSnapshot(await speakerContentApi.snapshot(workspace.actor.id, workspace.actor.role, eventId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Session assignments could not be loaded.");
    }
  };
  useEffect(() => {
    let active = true;
    speakerContentApi.snapshot(workspace.actor.id, workspace.actor.role, eventId).then(
      (loaded) => { if (active) setSnapshot(loaded); },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Session assignments could not be loaded."); },
    );
    return () => { active = false; };
  }, [eventId, workspace.actor.id, workspace.actor.role]);
  return { snapshot, error, refresh, workspace, eventId };
}

export function SpeakerPortalAssignments() {
  const { snapshot, error } = usePortalSpeakerContent();
  const speaker = snapshot?.speakers[0];
  if (error) return <InlineAlert tone="warning">{error}</InlineAlert>;
  if (!snapshot) return <section className="portal-panel speaker-portal-assignments" aria-busy="true"><p>Loading session assignments…</p></section>;
  return <section className="portal-panel speaker-portal-assignments"><header><div><p className="eyebrow">Program assignments</p><h2>My sessions</h2><p>These are the exact session links the organizer sees on your speaker record.</p></div><StatusPill status={`${speaker?.sessions.length ?? 0} assigned`} /></header>{speaker?.sessions.length ? <div>{speaker.sessions.map((session) => <article key={session.id}><span><Sparkles size={18} /></span><div><strong>{session.title}</strong><small>{session.startsAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.startsAt)) : "Schedule pending"}{session.room ? ` · ${session.room}` : ""}</small></div><StatusPill status="assigned" /></article>)}</div> : <EmptyState title="No session assigned yet" detail="An accepted session will appear here as soon as the organizer links it to your profile." />}</section>;
}

export function SpeakerPortalSocialEditor() {
  const { snapshot, error, refresh, workspace, eventId } = usePortalSpeakerContent();
  const speaker = snapshot?.speakers[0];
  if (error) return <InlineAlert tone="warning">{error}</InlineAlert>;
  if (!speaker) return null;
  return <SpeakerPortalSocialForm key={`${speaker.id}:${snapshot.generatedAt}`} speaker={speaker} refresh={refresh} workspace={workspace} eventId={eventId} />;
}

function SpeakerPortalSocialForm({ speaker, refresh, workspace, eventId }: {
  speaker: NonNullable<SpeakerContentSnapshot["speakers"][number]>;
  refresh: () => Promise<void>;
  workspace: ReturnType<typeof useWorkspace>["workspace"];
  eventId: string;
}) {
  const [links, setLinks] = useState<SpeakerSocialLinks>(speaker.socialLinks);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  return <form className="portal-panel speaker-portal-social" onSubmit={async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setSaveError("");
    try {
      await speakerContentApi.updateSpeaker(workspace.actor.id, workspace.actor.role, eventId, speaker.id, { ...managedSpeakerPayload(speaker), socialLinks: links });
      setNotice("Public links saved. The organizer record now shows the same values.");
      await refresh();
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Public links could not be saved.");
    } finally {
      setSaving(false);
    }
  }}><header><div><p className="eyebrow">Public profile links</p><h2>Where attendees can find you</h2><p>These links sync to your organizer-managed speaker record.</p></div><Linkedin size={22} /></header><div className="field-grid field-grid--2"><Field label="LinkedIn"><input type="url" placeholder="https://linkedin.com/in/…" value={links.linkedin ?? ""} onChange={(event) => setLinks({ ...links, linkedin: event.target.value })} /></Field><Field label="X / Twitter"><input type="url" placeholder="https://x.com/…" value={links.x ?? ""} onChange={(event) => setLinks({ ...links, x: event.target.value })} /></Field><Field label="Website"><input type="url" placeholder="https://…" value={links.website ?? ""} onChange={(event) => setLinks({ ...links, website: event.target.value })} /></Field></div><footer><span role={saveError ? "alert" : "status"}>{saveError || notice || "Use full HTTPS URLs. Leave a field blank to remove it."}</span><button type="submit" className="button button--primary" disabled={saving}><Save size={15} /> {saving ? "Saving…" : "Save public links"}</button></footer></form>;
}

export function SpeakerPortalDeliverableConstraints() {
  return <span className="portal-file-constraints"><ExternalLink size={12} /> PDF, PowerPoint, Word, or text · 50 MB maximum per file</span>;
}

export function SpeakerPortalSessionBadge() {
  return <span className="portal-session-badge"><CalendarDays size={12} /> Session-linked work</span>;
}
