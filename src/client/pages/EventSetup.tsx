import { ArrowRight, CalendarDays, CheckCircle2, Layers3, MapPin, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { CreateEventPayload } from "../api";
import { Field, InlineAlert } from "../components";
import { dateTimeLocalToInstant, instantToDateTimeLocal } from "../event-time";
import { useWorkspace } from "../workspace";

const DAY = 86_400_000;

function slugFromName(name: string) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function defaultLocalDate(daysFromNow: number, timezone: string) {
  const instant = new Date(Date.now() + daysFromNow * DAY);
  instant.setUTCMinutes(0, 0, 0);
  return instantToDateTimeLocal(instant.toISOString(), timezone);
}

export function EventSetupPage() {
  const { authRequired, createEvent, loading } = useWorkspace();
  const timezone = "America/Los_Angeles";
  const [draft, setDraft] = useState({
    organizationName: "",
    name: "",
    shortName: "",
    slug: "",
    description: "",
    timezone,
    startsAt: defaultLocalDate(60, timezone),
    endsAt: defaultLocalDate(61, timezone),
    cfpClosesAt: defaultLocalDate(30, timezone),
    venue: "",
    websiteUrl: "",
    accent: "#e05b3f",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ready = useMemo(() => Boolean(
    draft.organizationName.trim()
    && draft.name.trim().length >= 3
    && draft.shortName.trim().length >= 2
    && draft.slug
    && draft.startsAt
    && draft.endsAt
    && draft.cfpClosesAt
  ), [draft]);

  if (loading) return <div className="route-loader">Preparing your event workspace…</div>;
  if (authRequired) return <Navigate to="/auth?returnTo=%2Fevents%2Fnew" replace />;

  return (
    <main className="event-setup-page">
      <section className="event-setup-intro" aria-labelledby="event-setup-title">
        <div className="brand-mark" aria-hidden="true">CO</div>
        <p className="eyebrow">Conference Ops · New workspace</p>
        <h1 id="event-setup-title">Start with the program, not a blank database.</h1>
        <p>These details create a private event workspace with a draft CFP, a review round, one room and track, plus practical speaker onboarding tasks.</p>
        <ol>
          <li><CheckCircle2 size={17} /><span><strong>CFP ready to shape</strong><small>Required proposal and participant fields are already connected.</small></span></li>
          <li><Layers3 size={17} /><span><strong>Review structure included</strong><small>A weighted first round and general routing lane are ready.</small></span></li>
          <li><CalendarDays size={17} /><span><strong>Operations connected</strong><small>Room, track, slide request, profile task, and calendar task are initialized.</small></span></li>
        </ol>
      </section>

      <form
        className="event-setup-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          try {
            const payload: CreateEventPayload = {
              ...draft,
              startsAt: dateTimeLocalToInstant(draft.startsAt, draft.timezone),
              endsAt: dateTimeLocalToInstant(draft.endsAt, draft.timezone),
              cfpClosesAt: dateTimeLocalToInstant(draft.cfpClosesAt, draft.timezone),
            };
            await createEvent(payload);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The event workspace could not be created.");
            setSaving(false);
          }
        }}
      >
        <div className="event-setup-card__head"><span><Sparkles size={18} /></span><div><p className="eyebrow">Event record</p><h2>Tell us what you are running</h2></div></div>
        <div className="form-stack">
          <Field label="Organization"><input autoFocus required value={draft.organizationName} onChange={(event) => setDraft({ ...draft, organizationName: event.target.value })} placeholder="AI Engineer Events" /></Field>
          <Field label="Event name"><input required minLength={3} value={draft.name} onChange={(event) => {
            const name = event.target.value;
            setDraft({ ...draft, name, ...(!slugTouched ? { slug: slugFromName(name) } : {}) });
          }} placeholder="AI Engineer Summit 2027" /></Field>
          <div className="field-grid field-grid--2">
            <Field label="Short name"><input required minLength={2} maxLength={40} value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} placeholder="AIE 2027" /></Field>
            <Field label="Public slug"><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.slug} onChange={(event) => { setSlugTouched(true); setDraft({ ...draft, slug: slugFromName(event.target.value) }); }} placeholder="ai-engineer-summit-2027" /></Field>
          </div>
          <Field label="What this event is for" hint={`${draft.description.length} / 1,000 characters`}><textarea rows={3} maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="A working conference for people building and operating AI systems." /></Field>
          <div className="field-grid field-grid--2">
            <Field label="Timezone"><select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}><option>America/Los_Angeles</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Singapore</option></select></Field>
            <Field label="Venue"><span className="input-with-icon"><MapPin size={15} /><input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} placeholder="Venue or city" /></span></Field>
            <Field label="Event starts"><input required type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></Field>
            <Field label="Event ends"><input required type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></Field>
          </div>
          <Field label="CFP closes" hint="Must be before the event starts."><input required type="datetime-local" value={draft.cfpClosesAt} onChange={(event) => setDraft({ ...draft, cfpClosesAt: event.target.value })} /></Field>
          <Field label="Event website"><input type="url" value={draft.websiteUrl} onChange={(event) => setDraft({ ...draft, websiteUrl: event.target.value })} placeholder="https://" /></Field>
          <fieldset className="event-color-field"><legend>Accent color</legend><div className="brand-swatches">{["#e05b3f", "#2d6a6c", "#7564a8", "#bd8b2f"].map((color) => <button key={color} type="button" className={draft.accent === color ? "selected" : ""} style={{ background: color }} onClick={() => setDraft({ ...draft, accent: color })} aria-label={`Use ${color} as event accent`} />)}</div></fieldset>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
        <div className="event-setup-card__foot"><p>Your event remains private until you publish its CFP or agenda.</p><button className="button button--primary" disabled={!ready || saving} type="submit">{saving ? "Building workspace…" : "Create event workspace"}<ArrowRight size={16} /></button></div>
      </form>
    </main>
  );
}
