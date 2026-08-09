import { MessageSquareText, Send } from "lucide-react";
import { useState } from "react";
import type { OnboardingTask } from "../shared/domain";
import { InlineAlert } from "./components";

function commentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function TaskDiscussion({
  task,
  onAdd,
}: {
  task: OnboardingTask;
  onAdd: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const comments = task.comments ?? [];

  return (
    <details className="task-discussion">
      <summary><MessageSquareText size={14} aria-hidden="true" /> Conversation <span>{comments.length}</span></summary>
      <div className="task-discussion__body">
        {comments.length > 0 ? <ol aria-label={`Comments for ${task.title}`}>
          {comments.map((comment) => (
            <li key={comment.id}>
              <header><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{commentDate(comment.createdAt)}</time></header>
              <p>{comment.body}</p>
            </li>
          ))}
        </ol> : <p className="task-discussion__empty">No comments yet. Add context or ask the event team a question.</p>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <form onSubmit={async (event) => {
          event.preventDefault();
          const body = draft.trim();
          if (!body) {
            setError("Write a comment before posting.");
            return;
          }
          setSaving(true);
          setError("");
          try {
            await onAdd(body);
            setDraft("");
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The comment could not be posted.");
          } finally {
            setSaving(false);
          }
        }}>
          <label><span className="sr-only">Add a comment to {task.title}</span><textarea rows={2} maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a note or question…" /></label>
          <button type="submit" className="button button--quiet" disabled={saving || !draft.trim()}><Send size={13} /> {saving ? "Posting…" : "Post"}</button>
        </form>
      </div>
    </details>
  );
}
