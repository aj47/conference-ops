import type { OnboardingTask, SpeakerProfile } from "../shared/domain";
import { privateEventPath } from "./private-routes";

export interface SpeakerOpsTarget {
  speakerId?: string;
  taskId?: string;
}

type SpeakerIdentifier = Pick<SpeakerProfile, "id">;
type TaskIdentifier = Pick<OnboardingTask, "id" | "eventId" | "speakerId">;

export function speakerOpsTargetPath(
  eventId: string | null | undefined,
  target: SpeakerOpsTarget = {},
) {
  const search = new URLSearchParams();
  if (target.speakerId) search.set("speakerId", target.speakerId);
  if (target.taskId) search.set("taskId", target.taskId);
  const path = `/speaker-ops${search.size ? `?${search.toString()}` : ""}`;
  return privateEventPath(path, eventId);
}

/**
 * Accept a deep-link target only when it belongs to the loaded event and the
 * task belongs to the requested accepted speaker. Invalid or stale values are
 * ignored instead of selecting a similarly named record from another event.
 */
export function resolveSpeakerOpsTarget(
  search: string | URLSearchParams,
  eventId: string,
  speakers: readonly SpeakerIdentifier[],
  tasks: readonly TaskIdentifier[],
): SpeakerOpsTarget {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  if (params.get("eventId") !== eventId) return {};

  const speakerId = params.get("speakerId") ?? "";
  if (!speakers.some((speaker) => speaker.id === speakerId)) return {};

  const taskId = params.get("taskId") ?? "";
  if (!taskId) return { speakerId };

  const task = tasks.find((candidate) =>
    candidate.id === taskId
    && candidate.eventId === eventId
    && candidate.speakerId === speakerId);
  return task ? { speakerId, taskId } : { speakerId };
}
