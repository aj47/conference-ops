import { CalendarRange, Check, Clipboard, Code2, Eye, GalleryHorizontalEnd, LayoutList, ListTree, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultPublicWidgetConfig,
  publicWidgetEmbedPath,
  publicWidgetFields,
  publicWidgetFormats,
  publicWidgetKinds,
  publicWidgetOutput,
  type PublicWidgetConfig,
  type PublicWidgetField,
  type PublicWidgetFormat,
  type PublicWidgetKind,
} from "./public-widget-model";
import { Field, InlineAlert } from "./components";
import { useWorkspace } from "./workspace";

const kindLabels: Record<PublicWidgetKind, { label: string; detail: string; icon: typeof LayoutList }> = {
  sessions: { label: "Sessions list", detail: "Searchable cards and facets", icon: LayoutList },
  speakers: { label: "Speakers list", detail: "Alphabetical directory", icon: ListTree },
  agenda: { label: "Agenda", detail: "Room × time grid", icon: CalendarRange },
  itinerary: { label: "Schedule itinerary", detail: "Personal planning and export", icon: Check },
  gallery: { label: "Speaker gallery", detail: "Visual photo directory", icon: GalleryHorizontalEnd },
};

const formatLabels: Record<PublicWidgetFormat, string> = {
  styled_html: "Styled HTML · iframe",
  basic_html: "Basic HTML · unbranded iframe",
  json: "JSON · live endpoint",
  xml: "XML · live endpoint",
  ical: "iCal · calendar feed",
};

const fieldLabels: Record<PublicWidgetField, string> = {
  description: "Descriptions",
  time: "Dates & times",
  room: "Rooms",
  speakers: "Speaker details",
  track: "Track labels",
  format: "Format labels",
};

export function EmbedStudioPanel() {
  const { workspace, setNotice } = useWorkspace();
  const [config, setConfig] = useState<PublicWidgetConfig>(() => ({ ...defaultPublicWidgetConfig, accent: workspace.event.accent }));
  const [generated, setGenerated] = useState(false);
  const origin = typeof window === "undefined" ? "https://events.example.com" : window.location.origin;
  const output = useMemo(() => publicWidgetOutput(origin, workspace.event.slug, workspace.event.name, config), [config, origin, workspace.event.name, workspace.event.slug]);
  const htmlPreview = ["styled_html", "basic_html"].includes(config.format);
  const previewConfig = useMemo(() => ({ ...config, plain: config.format === "basic_html" }), [config]);
  const previewUrl = `${origin}${publicWidgetEmbedPath(workspace.event.slug, previewConfig)}`;

  const update = (patch: Partial<PublicWidgetConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setGenerated(false);
  };
  const toggleField = (field: PublicWidgetField, checked: boolean) => update({
    fields: checked ? [...new Set([...config.fields, field])] : config.fields.filter((candidate) => candidate !== field),
  });
  const copy = async (value = output, label = formatLabels[config.format]) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied for the ${kindLabels[config.kind].label}.`);
    } catch {
      setNotice("Copy was blocked by the browser. Select the generated output and copy it manually.");
    }
  };

  return (
    <section className="program-config-panel embed-studio" aria-labelledby="embed-studio-title">
      <div className="program-config-panel__head"><div><p className="eyebrow">Public distribution</p><h2 id="embed-studio-title">Generate a live widget for any website.</h2><p>Each output reads the same published program as the hosted attendee pages. Filters, fields, and branding travel in the URL, so future organizer edits appear without rebuilding the embed.</p></div><div className="program-config-score"><strong>5/5</strong><span>widget types live</span></div></div>

      <div className="embed-studio__kinds" role="radiogroup" aria-label="Widget type">
        {publicWidgetKinds.map((kind) => { const Icon = kindLabels[kind].icon; return <button type="button" role="radio" aria-checked={config.kind === kind} className={config.kind === kind ? "active" : ""} key={kind} onClick={() => update({ kind })}><Icon size={19} /><span><strong>{kindLabels[kind].label}</strong><small>{kindLabels[kind].detail}</small></span>{config.kind === kind && <Check size={16} />}</button>; })}
      </div>

      <div className="embed-studio__workspace">
        <div className="embed-studio__builder form-stack">
          <div className="field-grid field-grid--2">
            <Field label="Output format"><select value={config.format} onChange={(event) => update({ format: event.target.value as PublicWidgetFormat })}>{publicWidgetFormats.map((format) => <option value={format} key={format}>{formatLabels[format]}</option>)}</select></Field>
            <Field label="Theme"><select value={config.theme} onChange={(event) => update({ theme: event.target.value as PublicWidgetConfig["theme"] })}><option value="light">Light</option><option value="dark">Dark</option></select></Field>
          </div>
          <Field label="Brand accent" hint="Applied to headings, selected controls, and schedule rails."><div className="embed-studio__color"><input type="color" value={config.accent} onChange={(event) => update({ accent: event.target.value })} aria-label="Widget brand accent color" /><input value={config.accent} pattern="#[0-9a-fA-F]{6}" onChange={(event) => /^#[0-9a-f]{6}$/i.test(event.target.value) && update({ accent: event.target.value })} aria-label="Widget brand accent hex value" /></div></Field>

          <fieldset className="embed-studio__filters"><legend>Content filters</legend><div className="field-grid field-grid--3">
            <Field label="Track"><select value={config.trackId} onChange={(event) => update({ trackId: event.target.value })}><option value="all">All published tracks</option>{workspace.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}</select></Field>
            <Field label="Format"><select value={config.sessionFormat} onChange={(event) => update({ sessionFormat: event.target.value })}><option value="all">All formats</option><option value="keynote">Keynote</option><option value="talk">Talk</option><option value="workshop">Workshop</option><option value="panel">Panel</option><option value="lightning">Lightning talk</option><option value="break">Break</option><option value="networking">Networking</option></select></Field>
            <Field label="Location"><select value={config.roomId} onChange={(event) => update({ roomId: event.target.value })}><option value="all">All rooms</option>{workspace.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}</select></Field>
          </div></fieldset>

          <fieldset className="embed-studio__fields"><legend>Visible fields</legend><div>{publicWidgetFields.map((field) => <label key={field}><input type="checkbox" checked={config.fields.includes(field)} onChange={(event) => toggleField(field, event.target.checked)} /><span>{fieldLabels[field]}</span></label>)}</div></fieldset>

          {config.fields.length === 0 && <InlineAlert tone="warning">Select at least one display field. Session and speaker names remain visible so the widget is still meaningful.</InlineAlert>}
          <button type="button" className="button button--primary button--large" onClick={() => setGenerated(true)}><Code2 size={17} /> Generate {formatLabels[config.format]}</button>
          {generated && <div className="embed-studio__output"><div><span><Check size={15} /> Generated from live published data</span><button type="button" className="button button--quiet" onClick={() => void copy()}><Clipboard size={15} /> Copy output</button></div><textarea readOnly aria-label="Generated embed output" rows={config.format.includes("html") ? 6 : 3} value={output} onFocus={(event) => event.currentTarget.select()} /><label><span>Shareable widget URL</span><span className="embed-studio__share"><input readOnly value={previewUrl} aria-label="Shareable widget URL" onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button--quiet" onClick={() => void copy(previewUrl, "Share URL")}><Clipboard size={15} /> Copy URL</button></span></label><small>No republish step is required. Reloading this URL always reads the current approved program.</small></div>}
        </div>

        <aside className="embed-studio__preview" aria-label="Live widget preview">
          <header><div><Eye size={16} /><span>Live preview</span></div><a href={previewUrl} target="_blank" rel="noreferrer">Open public view</a></header>
          {htmlPreview ? <iframe title={`${kindLabels[config.kind].label} preview`} src={previewUrl} loading="lazy" /> : <div className="embed-studio__feed-preview"><RefreshCw size={24} /><strong>{formatLabels[config.format]}</strong><p>This feed is generated on request from the canonical published program.</p><a className="button button--quiet" href={output} target="_blank" rel="noreferrer">Open live feed</a></div>}
        </aside>
      </div>
    </section>
  );
}
