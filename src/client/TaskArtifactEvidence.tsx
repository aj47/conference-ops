import { Download, FileCheck2, RefreshCw } from "lucide-react";
import type { OnboardingTask } from "../shared/domain";

function artifactTypeLabel(contentType?: string) {
  if (!contentType) return "File";
  if (contentType === "application/pdf") return "PDF";
  if (contentType.includes("presentation") || contentType.includes("powerpoint")) return "Presentation";
  if (contentType.includes("wordprocessingml")) return "Word document";
  if (contentType === "text/plain") return "Text document";
  return contentType;
}

export function TaskArtifactEvidence({
  task,
  busy = false,
  onDownload,
  onReplace,
}: {
  task: OnboardingTask;
  busy?: boolean;
  onDownload: () => void;
  onReplace?: (file: File) => void;
}) {
  if (!task.artifactUploadId || task.status === "waived") return null;
  const fileName = task.artifactFileName || "Submitted file";
  return (
    <div className="task-evidence">
      <span className="task-evidence__file"><FileCheck2 size={15} aria-hidden="true" /><span><strong>{fileName}</strong><small>{artifactTypeLabel(task.artifactContentType)} · private task file</small></span></span>
      <span className="task-evidence__actions">
        <button type="button" className="button button--quiet" disabled={busy} onClick={onDownload} aria-label={`Download ${fileName}`}>
          <Download size={14} /> {busy ? "Working…" : "Download"}
        </button>
        {onReplace && <label className={`button button--quiet upload-button${busy ? " upload-button--disabled" : ""}`}>
          <RefreshCw size={14} /> Replace
          <input
            type="file"
            disabled={busy}
            accept=".pdf,.ppt,.pptx,.doc,.docx,.txt"
            aria-label={`Replace ${fileName}`}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = "";
              if (file) onReplace(file);
            }}
          />
        </label>}
      </span>
    </div>
  );
}
