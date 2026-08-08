import { describe, expect, it } from "vitest";
import type { Actor } from "../../src/shared/domain";
import { actorForRoleOption, actorRoleOptionValue, actorWithRole } from "../../src/client/role-selection";

const actors: Actor[] = [
  { id: "same-user", name: "Arash", email: "organizer@example.com", role: "applicant" },
  { id: "same-user", name: "Arash", email: "organizer@example.com", role: "organizer" },
];

describe("multi-role actor selection", () => {
  it("gives memberships with the same user id distinct option values", () => {
    expect(actors.map((actor) => actorRoleOptionValue(actor, actors))).toEqual([
      "same-user:applicant",
      "same-user:organizer",
    ]);
  });

  it("preserves legacy actor-id option values when identities are unique", () => {
    const uniqueActors = [
      { ...actors[0], id: "applicant-user" },
      { ...actors[1], id: "organizer-user" },
    ];

    expect(uniqueActors.map((actor) => actorRoleOptionValue(actor, uniqueActors))).toEqual([
      "applicant-user",
      "organizer-user",
    ]);
    expect(actorForRoleOption(uniqueActors, "organizer-user")?.role).toBe("organizer");
  });

  it("resolves the exact selected membership instead of the first matching user", () => {
    expect(actorForRoleOption(actors, "same-user:organizer")?.role).toBe("organizer");
    expect(actorWithRole(actors, "same-user", "organizer")?.role).toBe("organizer");
  });
});
