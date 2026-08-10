import { ArrowRight, CalendarDays, CheckCircle2, Database, FileSpreadsheet, Layers3, MapPin, Palette, Sparkles, Upload } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Navigate } from "react-router-dom";
import { launchConfigurationForTemplate, launchTemplates, type LaunchConfiguration } from "../../shared/launch-templates";
import type { CreateEventPayload } from "../api";
import { Field, InlineAlert } from "../components";
import { dateTimeLocalToInstant, instantToDateTimeLocal } from "../event-time";
import { cfpDeadlineValidation } from "../event-setup-validation";
import { launchCsvExample, parseLaunchCsv } from "../launch-import";
import { useWorkspace } from "../workspace";

const DAY = 86_400_000;

function slugFromName(name: string) {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
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
  const [launch, setLaunch] = useState<LaunchConfiguration>(() => launchConfigurationForTemplate("conference"));
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cfpDeadlineError = useMemo(
    () => cfpDeadlineValidation(draft.cfpClosesAt, draft.startsAt, draft.timezone),
    [draft.cfpClosesAt, draft.startsAt, draft.timezone],
  );
  const ready = useMemo(() => Boolean(
    draft.organizationName.trim()
    && draft.name.trim().length >= 3
    && draft.shortName.trim().length >= 2
    && draft.slug
    && draft.startsAt
    && draft.endsAt
    && draft.cfpClosesAt
    && !cfpDeadlineError
    && !csvErrors.length
  ), [cfpDeadlineError, csvErrors.length, draft]);
  const selectedTemplate = launchTemplates.find((template) => template.id === launch.templateId) ?? launchTemplates[0];

  if (loading) return <div className="route-loader">Preparing your event workspace…</div>;
  if (authRequired) return <Navigate to="/auth?returnTo=%2Fevents%2Fnew" replace />;

  return (
    <main className="event-setup-page">
      <section className="event-setup-intro" aria-labelledby="event-setup-title">
        <div className="brand-mark" aria-hidden="true">CO</div>
        <p className="eyebrow">Conference Ops · Guided launch</p>
        <h1 id="event-setup-title">Start with a run of show, not a blank database.</h1>
        <p>Choose a proven starting shape, bring a room-and-track plan, then launch a private workspace with the entire program workflow connected.</p>
        <ol>
          <li><CheckCircle2 size={17} /><span><strong>01 · Pick a starting shape</strong><small>Conference, workshop, internal summit, or multi-track technical.</small></span></li>
          <li><Layers3 size={17} /><span><strong>02 · Bring the run of show</strong><small>Use the template, import a small CSV, or prepare for Airtable authority.</small></span></li>
          <li><CalendarDays size={17} /><span><strong>03 · Launch the workflow</strong><small>CFP, routing, review, tasks, rooms, emails, and public views are connected.</small></span></li>
        </ol>
        <div className="event-setup-proof"><Database size={16} /><span><strong>Airtable-ready.</strong> After launch, the guarded connector can mirror every business record and show proof in Program setup.</span></div>
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
              launch,
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
        <div className="event-setup-card__head"><span><Sparkles size={18} /></span><div><p className="eyebrow">Launch studio</p><h2>Turn a starting shape into your event</h2></div></div>
        <div className="form-stack">
          <fieldset className="launch-source-field">
            <legend>1. Where should the event shape come from?</legend>
            <div className="launch-source-options">
              {([
                { id: "template", label: "Starter template", detail: "Fastest path", icon: Layers3 },
                { id: "csv", label: "Rooms + tracks CSV", detail: "Bring a run sheet", icon: FileSpreadsheet },
                { id: "airtable", label: "Airtable source", detail: "Connect after launch", icon: Database },
              ] as const).map((source) => {
                const Icon = source.icon;
                return <button key={source.id} type="button" aria-pressed={launch.source === source.id} className={launch.source === source.id ? "launch-source-option selected" : "launch-source-option"} onClick={() => { setCsvErrors([]); setLaunch((current) => ({ ...current, source: source.id })); }}><Icon size={18} /><span><strong>{source.label}</strong><small>{source.detail}</small></span></button>;
              })}
            </div>
          </fieldset>

          <fieldset className="launch-template-field">
            <legend>2. Choose a proven workflow</legend>
            <div className="launch-template-grid">
              {launchTemplates.map((template) => (
                <button key={template.id} type="button" aria-pressed={launch.templateId === template.id} className={launch.templateId === template.id ? "launch-template-card selected" : "launch-template-card"} onClick={() => { setCsvErrors([]); setLaunch(launchConfigurationForTemplate(template.id, launch.source)); }}>
                  <span className="eyebrow">{template.eyebrow}</span>
                  <strong>{template.name}</strong>
                  <p>{template.description}</p>
                  <small>{template.tracks.length} {template.tracks.length === 1 ? "track" : "tracks"} · {template.rooms.length} {template.rooms.length === 1 ? "room" : "rooms"}</small>
                </button>
              ))}
            </div>
          </fieldset>

          {launch.source === "csv" && <div className="launch-csv-import">
            <div><Upload size={18} /><span><strong>Import rooms and tracks</strong><small>CSV columns: type, name, capacity, color. This creates configuration only—never people or private submissions.</small></span></div>
            <label className="button button--quiet">Choose CSV<input type="file" accept=".csv,text/csv" onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = "";
              if (!file) return;
              const parsed = parseLaunchCsv(await file.text());
              setCsvErrors(parsed.errors);
              if (!parsed.errors.length) setLaunch((current) => ({ ...current, source: "csv", tracks: parsed.tracks, rooms: parsed.rooms }));
            }} /></label>
            <details><summary>Show a valid example</summary><pre>{launchCsvExample}</pre></details>
            {csvErrors.length > 0 && <InlineAlert tone="danger"><ul>{csvErrors.map((message) => <li key={message}>{message}</li>)}</ul></InlineAlert>}
          </div>}

          {launch.source === "airtable" && <InlineAlert tone="info"><strong>Safe Airtable handoff:</strong> the event launches privately first. Program setup then shows the current authority, last push/pull, and reconciliation health before any cutover. Tokens and raw connector details never enter this form.</InlineAlert>}

          <div className="form-phase-heading"><span>3</span><div><strong>Name the event</strong><small>These are the details organizers and participants will recognize.</small></div></div>
          <Field label="Organization"><input autoFocus required value={draft.organizationName} onChange={(event) => setDraft({ ...draft, organizationName: event.target.value })} placeholder="AI Engineer Events" /></Field>
          <Field label="Event name"><input required minLength={3} value={draft.name} onChange={(event) => { const name = event.target.value; setDraft({ ...draft, name, ...(!slugTouched ? { slug: slugFromName(name) } : {}) }); }} placeholder="AI Engineer Summit 2027" /></Field>
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
          <Field label="CFP closes" hint="Must be before the event starts." error={cfpDeadlineError}><input required type="datetime-local" aria-invalid={Boolean(cfpDeadlineError)} value={draft.cfpClosesAt} onChange={(event) => setDraft({ ...draft, cfpClosesAt: event.target.value })} /></Field>
          <Field label="Event website"><input type="url" value={draft.websiteUrl} onChange={(event) => setDraft({ ...draft, websiteUrl: event.target.value })} placeholder="https://" /></Field>

          <div className="form-phase-heading"><span>4</span><div><strong>Set the public tone</strong><small>Start with an accent now; add the event logo and inspect every persona after launch.</small></div></div>
          <fieldset className="event-color-field"><legend>Accent color</legend><div className="brand-swatches">{["#e05b3f", "#2d6a6c", "#7564a8", "#bd8b2f"].map((color) => <button key={color} type="button" className={draft.accent === color ? "selected" : ""} style={{ background: color }} onClick={() => setDraft({ ...draft, accent: color })} aria-label={`Use ${color} as event accent`} aria-pressed={draft.accent === color} />)}</div></fieldset>
          <section className="launch-review" style={{ "--event-accent": draft.accent } as CSSProperties} aria-label="Workspace launch summary">
            <span className="launch-review__mark"><Palette size={19} /></span>
            <div><p className="eyebrow">Ready to build</p><h3>{draft.name || "Your event"}</h3><p>{launch.tracks.map((track) => track.name).join(" · ")} · {launch.rooms.map((room) => room.name).join(" · ")}</p></div>
            <ul>{selectedTemplate.included.map((item) => <li key={item}><CheckCircle2 size={14} />{item}</li>)}</ul>
          </section>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
        <div className="event-setup-card__foot"><p>Your event stays private. We create {launch.tracks.length} {launch.tracks.length === 1 ? "track" : "tracks"}, {launch.rooms.length} {launch.rooms.length === 1 ? "room" : "rooms"}, the CFP, review, onboarding, emails, and public previews together.</p><button className="button button--primary" disabled={!ready || saving} type="submit">{saving ? "Building workspace…" : "Create event workspace"}<ArrowRight size={16} /></button></div>
      </form>
    </main>
  );
}
