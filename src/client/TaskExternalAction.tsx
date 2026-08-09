import { ExternalLink } from "lucide-react";
import type { OnboardingTask } from "../shared/domain";

function safeExternalTaskUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function TaskExternalAction({ task }: { task: OnboardingTask }) {
  const url = task.completionMode === "manual" ? safeExternalTaskUrl(task.externalUrl) : undefined;
  if (!url) return null;
  return <a className="button button--quiet" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open link</a>;
}
