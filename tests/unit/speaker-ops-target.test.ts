import { describe, expect, it } from "vitest";
import {
  resolveSpeakerOpsTarget,
  speakerOpsTargetPath,
} from "../../src/client/speaker-ops-target";

const speakers = [{ id: "speaker-a" }, { id: "speaker-b" }];
const tasks = [
  { id: "task-a", eventId: "event-a", speakerId: "speaker-a" },
  { id: "task-b", eventId: "event-b", speakerId: "speaker-a" },
  { id: "task-other-speaker", eventId: "event-a", speakerId: "speaker-b" },
];

describe("speaker operations deep links", () => {
  it("builds encoded event-scoped speaker and task destinations", () => {
    const path = speakerOpsTargetPath("event a", {
      speakerId: "speaker/a",
      taskId: "task & one",
    });
    const url = new URL(path, "https://conference.test");

    expect(url.pathname).toBe("/speaker-ops");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      eventId: "event a",
      speakerId: "speaker/a",
      taskId: "task & one",
    });
  });

  it("resolves a task only for the loaded event and requested accepted speaker", () => {
    expect(resolveSpeakerOpsTarget(
      "?eventId=event-a&speakerId=speaker-a&taskId=task-a",
      "event-a",
      speakers,
      tasks,
    )).toEqual({ speakerId: "speaker-a", taskId: "task-a" });

    expect(resolveSpeakerOpsTarget(
      "?eventId=event-a&speakerId=speaker-a&taskId=task-other-speaker",
      "event-a",
      speakers,
      tasks,
    )).toEqual({ speakerId: "speaker-a" });
  });

  it("ignores stale event, foreign task, and unknown speaker targets", () => {
    expect(resolveSpeakerOpsTarget(
      "?eventId=event-b&speakerId=speaker-a&taskId=task-a",
      "event-a",
      speakers,
      tasks,
    )).toEqual({});
    expect(resolveSpeakerOpsTarget(
      "?eventId=event-a&speakerId=speaker-a&taskId=task-b",
      "event-a",
      speakers,
      tasks,
    )).toEqual({ speakerId: "speaker-a" });
    expect(resolveSpeakerOpsTarget(
      "?eventId=event-a&speakerId=missing&taskId=task-a",
      "event-a",
      speakers,
      tasks,
    )).toEqual({});
  });
});
