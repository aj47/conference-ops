import { describe, expect, it } from "vitest";
import type { FormField } from "../../src/shared/domain";
import { requiredUnsupportedFileFields } from "../../src/client/form-builder-validation";

describe("form builder publication safety", () => {
  it("finds only required file questions across proposal and participant sections", () => {
    const proposalFields: FormField[] = [
      { id: "title", label: "Session title", type: "short_text", required: true },
      { id: "slides", label: "Draft slides", type: "file", required: true },
    ];
    const participantFields: FormField[] = [
      { id: "photo", label: "Optional headshot", type: "file", required: false },
      { id: "release", label: "Signed release", type: "file", required: true },
    ];

    expect(requiredUnsupportedFileFields(proposalFields, participantFields).map((field) => field.id))
      .toEqual(["slides", "release"]);
  });
});
