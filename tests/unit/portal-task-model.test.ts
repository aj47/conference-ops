import { describe, expect, it } from "vitest";
import { portalSpeakerForActor } from "../../src/client/portal-model";
import { taskFormResponseItems, validateTaskFormResponses } from "../../src/client/task-form-model";
import type { FormField, SpeakerProfile } from "../../src/shared/domain";

describe("portal identity and task fields", () => {
  it("matches only the actor email and never falls back to the first speaker", () => {
    const speakers: SpeakerProfile[] = [
      { id: "first", name: "First", email: "first@example.com", title: "", company: "", bio: "", profileComplete: true },
      { id: "owned", name: "Owned", email: "Owned@Example.com", title: "", company: "", bio: "", profileComplete: true },
    ];
    expect(portalSpeakerForActor(speakers, "owned@example.com")?.id).toBe("owned");
    expect(portalSpeakerForActor(speakers, "organizer@example.com")).toBeUndefined();
  });

  it("validates actual visible fields and ignores hidden conditional fields", () => {
    const fields: FormField[] = [
      { id: "layout", label: "Layout", type: "select", required: true, options: ["Classroom", "Pods"] },
      { id: "power", label: "Power needs", type: "long_text", required: true, condition: { sourceFieldId: "layout", operator: "equals", value: "Pods" } },
    ];
    expect(validateTaskFormResponses(fields, { layout: "Classroom" })).toEqual({});
    expect(validateTaskFormResponses(fields, { layout: "Pods" })).toEqual({ power: "Power needs is required." });
  });

  it("projects persisted task answers with their form labels and safe scalar values", () => {
    const fields: FormField[] = [
      { id: "layout", label: "Room layout", type: "select", required: true, options: ["Classroom", "Pods"] },
      { id: "power", label: "Power needs", type: "checkbox", required: false },
      { id: "internal", label: "Unsupported", type: "long_text", required: false },
    ];
    expect(taskFormResponseItems(fields, {
      layout: "Pods",
      power: true,
      internal: { secret: "not a display value" },
    })).toEqual([
      expect.objectContaining({ fieldId: "layout", label: "Room layout", value: "Pods" }),
      expect.objectContaining({ fieldId: "power", label: "Power needs", value: true }),
    ]);
  });
});
