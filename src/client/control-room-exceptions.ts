import type { OnboardingTask, SpeakerProfile } from "../shared/domain";
import { privateEventPath } from "./private-routes";
import { speakerOpsTargetPath } from "./speaker-ops-target";

type ExceptionTask = Pick<OnboardingTask, "id" | "speakerId" | "title">;
type ExceptionSpeaker = Pick<SpeakerProfile, "id" | "name">;

export interface ControlRoomException {
  kind: "task" | "profile" | "schedule";
  key: string;
  title: string;
  detail: string;
  to: string;
  action: string;
}

/**
 * Keep the risk ledger and its primary action on the same ordered source of
 * truth so the CTA can never point at an unrelated workflow.
 */
export function controlRoomExceptions(
  eventId: string,
  overdueTasks: readonly ExceptionTask[],
  incompleteProfiles: readonly ExceptionSpeaker[],
  unscheduledCount: number,
): ControlRoomException[] {
  const exceptions: ControlRoomException[] = [
    ...overdueTasks.map((task) => ({
      kind: "task" as const,
      key: `task:${task.id}`,
      title: task.title,
      detail: "Overdue · speaker task",
      to: speakerOpsTargetPath(eventId, { speakerId: task.speakerId, taskId: task.id }),
      action: "Open speaker task",
    })),
    ...incompleteProfiles.slice(0, 2).map((speaker) => ({
      kind: "profile" as const,
      key: `speaker:${speaker.id}`,
      title: speaker.name,
      detail: "Public profile incomplete",
      to: speakerOpsTargetPath(eventId, { speakerId: speaker.id }),
      action: "Open speaker profile",
    })),
  ];

  if (unscheduledCount > 0) {
    exceptions.push({
      kind: "schedule",
      key: "schedule:unscheduled",
      title: `${unscheduledCount} unscheduled ${unscheduledCount === 1 ? "session" : "sessions"}`,
      detail: "Needs room and time",
      to: privateEventPath("/schedule", eventId),
      action: `Place unscheduled ${unscheduledCount === 1 ? "session" : "sessions"}`,
    });
  }

  return exceptions;
}
