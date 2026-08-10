import { ArrowRight, CheckCircle2, Compass, RotateCcw, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDialogA11y } from "./dialog-a11y";
import { privateEventPath } from "./private-routes";
import { useWorkspace } from "./workspace";

const steps = [
  { title: "Shape the intake", detail: "Publish the CFP and confirm track choices, participant fields, and the confirmation message.", path: "/forms" },
  { title: "Route real review", detail: "Assign accepted reviewers to tracks and inspect the evaluation plan.", path: "/program-settings" },
  { title: "Make a decision", detail: "Review evidence, stage approve/maybe/deny, then confirm the outcome.", path: "/proposals" },
  { title: "Run speaker onboarding", detail: "Use the next-action card, travel forms, files, comments, and reminder controls.", path: "/speaker-ops" },
  { title: "Draft the run of show", detail: "Preview assisted placements, resolve conflicts, and keep a reversible draft.", path: "/schedule" },
  { title: "Preview and publish", detail: "Inspect public sessions, speakers, agenda, widgets, feeds, and delivery evidence.", path: "/publish" },
] as const;

function tourKey(eventId: string) { return `conference-ops-tour:${eventId}`; }

export function PilotTour({ onClose, returnFocusRef }: { onClose: () => void; returnFocusRef?: React.RefObject<HTMLElement | null> }) {
  const { workspace, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const navigate = useNavigate();
  const fallbackReturn = useRef<HTMLElement | null>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose, true, returnFocusRef ?? fallbackReturn);
  const [completed, setCompleted] = useState<number[]>(() => {
    try { return JSON.parse(window.localStorage.getItem(tourKey(eventId)) ?? "[]") as number[]; } catch { return []; }
  });
  const completion = useMemo(() => new Set(completed), [completed]);
  const toggle = (index: number) => {
    const next = completion.has(index) ? completed.filter((value) => value !== index) : [...completed, index];
    setCompleted(next);
    window.localStorage.setItem(tourKey(eventId), JSON.stringify(next));
  };
  const reset = () => { setCompleted([]); window.localStorage.removeItem(tourKey(eventId)); };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={dialogRef} className="pilot-tour" role="dialog" aria-modal="true" aria-labelledby="pilot-tour-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header><span><Compass size={20} /></span><div><p className="eyebrow">Organizer field guide</p><h2 id="pilot-tour-title">One complete event loop, in order.</h2><p>Open each workflow, try the real controls, then mark it checked. Resetting this guide never resets event data.</p></div><button type="button" className="icon-button" aria-label="Close organizer guide" onClick={onClose}><X size={18} /></button></header>
        <ol>{steps.map((step, index) => <li key={step.path} className={completion.has(index) ? "complete" : ""}><button type="button" className="pilot-tour__check" aria-label={`${completion.has(index) ? "Mark incomplete" : "Mark complete"}: ${step.title}`} aria-pressed={completion.has(index)} onClick={() => toggle(index)}>{completion.has(index) ? <CheckCircle2 size={17} /> : String(index + 1).padStart(2, "0")}</button><div><strong>{step.title}</strong><p>{step.detail}</p></div><button type="button" className="button button--quiet" data-dialog-initial-focus={index === 0 || undefined} onClick={() => { navigate(privateEventPath(step.path, eventId)); onClose(); }}>Open <ArrowRight size={14} /></button></li>)}</ol>
        <footer><span>{completed.length} of {steps.length} guide steps checked</span><button type="button" className="button button--quiet" onClick={reset}><RotateCcw size={14} /> Reset guide only</button></footer>
      </div>
    </div>
  );
}
