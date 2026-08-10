import { CheckCircle2, Eye, ImagePlus, Palette, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { publicAgendaPath, publicSubmissionPath } from "./public-routes";
import { conferenceApi } from "./api";
import { Field, InlineAlert } from "./components";
import { useWorkspace } from "./workspace";

const swatches = ["#e05b3f", "#2d6a6c", "#7564a8", "#bd8b2f", "#1f5f8b", "#9d3d61"];

export function BrandKitPanel() {
  const { workspace, updateEvent, setNotice } = useWorkspace();
  const [accent, setAccent] = useState(workspace.event.accent);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState(workspace.event.logoUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const publicLinks = useMemo(() => [
    { label: "CFP", href: publicSubmissionPath(workspace.event.slug) },
    { label: "Program", href: publicAgendaPath(workspace.event.slug) },
  ], [workspace.event.slug]);

  const save = async (removeLogo = false) => {
    setSaving(true);
    setError("");
    try {
      let logoUploadId: string | null | undefined = removeLogo ? null : undefined;
      if (file) {
        const uploaded = await conferenceApi.upload(workspace.actor.id, workspace.event.id, file, "event_logo");
        logoUploadId = uploaded.id;
      }
      const saved = await conferenceApi.saveEventBrand(workspace.actor.id, workspace.event.id, { accent, ...(logoUploadId !== undefined ? { logoUploadId } : {}) });
      await updateEvent({ accent, logoUrl: saved.logoUrl });
      if (removeLogo) { setFile(null); setPreviewUrl(""); }
      else if (saved.logoUrl) setPreviewUrl(saved.logoUrl);
      setFile(null);
      setNotice("Brand kit saved. Private previews and public event surfaces now share this identity.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The brand kit could not be saved.");
    } finally { setSaving(false); }
  };

  return (
    <section className="program-config-panel brand-kit-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Brand kit</p><h2>Make every event surface feel intentional.</h2><p>One event-safe logo and accent carry through organizer previews, the applicant experience, speaker portal, public program, and embeds.</p></div><span className="brand-kit-sigil"><Palette size={22} /></span></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="brand-kit-layout">
        <div className="brand-kit-controls">
          <fieldset className="event-color-field"><legend>Event accent</legend><div className="brand-swatches">{swatches.map((color) => <button key={color} type="button" className={accent === color ? "selected" : ""} style={{ background: color }} aria-label={`Use ${color} as event accent`} aria-pressed={accent === color} onClick={() => setAccent(color)} />)}</div></fieldset>
          <Field label="Event logo" hint="PNG, JPG, or WebP · up to 5 MB · SVG is intentionally excluded"><label className="brand-logo-drop"><ImagePlus size={22} /><span><strong>{file ? file.name : previewUrl ? "Replace current logo" : "Choose event logo"}</strong><small>A wide or square transparent PNG works best.</small></span><input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => {
            const next = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            if (next && next.size > 5 * 1024 * 1024) { setError("Event logos must be 5 MB or smaller."); return; }
            setError(""); setFile(next);
          }} /></label></Field>
          <div className="brand-kit-actions"><button type="button" className="button button--primary" disabled={saving} onClick={() => void save()}><Upload size={15} />{saving ? "Saving…" : "Save brand kit"}</button>{previewUrl && <button type="button" className="button button--quiet" disabled={saving} onClick={() => void save(true)}><Trash2 size={14} />Remove logo</button>}</div>
        </div>
        <div className="brand-kit-preview" style={{ "--event-accent": accent } as React.CSSProperties}>
          <div className="brand-kit-preview__chrome"><span><Eye size={14} /> Live public preview</span><small>{workspace.event.slug}</small></div>
          <div className="brand-kit-preview__hero">
            {previewUrl ? <img src={previewUrl} alt={`${workspace.event.name} logo preview`} /> : <span className="brand-kit-preview__fallback">{workspace.event.shortName.slice(0, 4)}</span>}
            <p className="eyebrow">Program preview</p><h3>{workspace.event.name}</h3><p>{workspace.event.description || "Add a clear event promise in Event details."}</p>
            <div>{workspace.tracks.slice(0, 3).map((track) => <span key={track.id}><i style={{ background: track.color }} />{track.name}</span>)}</div>
          </div>
          <footer><span><CheckCircle2 size={14} /> Same source across every persona</span>{publicLinks.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer">Open {link.label}</a>)}</footer>
        </div>
      </div>
    </section>
  );
}
