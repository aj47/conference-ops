import { Download, FileCheck2, History, RefreshCw } from "lucide-react";
import type { OnboardingTask } from "../shared/domain";

function artifactTypeLabel(contentType?: string) {
  if (!contentType) return "File";
  if (contentType === "application/pdf") return "PDF";
  if (contentType.includes("presentation") || contentType.includes("powerpoint")) return "Presentation";
  if (contentType.includes("wordprocessingml")) return "Word document";
  if (contentType === "text/plain") return "Text document";
  return contentType;
}

function uploadedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Upload date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function TaskArtifactEvidence({
  task,
  busy = false,
  onDownload,
  onReplace,
}: {
  task: OnboardingTask;
  busy?: boolean;
  onDownload: (uploadId?: string) => void;
  onReplace?: (file: File) => void;
}) {
  if (!task.artifactUploadId || task.status === "waived") return null;
  const fileName = task.artifactFileName || "Submitted file";
  const earlierVersions = (task.artifactVersions ?? []).filter((version) => version.uploadId !== task.artifactUploadId);
  return (
    <div className="task-evidence-stack">
      <div className="task-evidence">
        <span className="task-evidence__file"><FileCheck2 size={15} aria-hidden="true" /><span><strong>{fileName}</strong><small>{artifactTypeLabel(task.artifactContentType)} · current private file</small></span></span>
        <span className="task-evidence__actions">
          <button type="button" className="button button--quiet" disabled={busy} onClick={() => onDownload(task.artifactUploadId)} aria-label={`Download ${fileName}`}>
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
      {earlierVersions.length > 0 && <details className="task-evidence-history">
        <summary><History size={14} aria-hidden="true" /> {earlierVersions.length} earlier {earlierVersions.length === 1 ? "version" : "versions"}</summary>
        <ol>
          {earlierVersions.map((version) => (
            <li key={version.uploadId}>
              <span><strong>{version.fileName}</strong><small>{artifactTypeLabel(version.contentType)} · {uploadedDate(version.uploadedAt)}</small></span>
              <button type="button" className="button button--quiet" disabled={busy} onClick={() => onDownload(version.uploadId)} aria-label={`Download earlier version ${version.fileName}`}><Download size={13} /> Download</button>
            </li>
          ))}
        </ol>
      </details>}
    </div>
  );
}
