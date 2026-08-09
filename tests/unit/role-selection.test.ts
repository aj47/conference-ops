import { describe, expect, it } from "vitest";
import type { Actor } from "../../src/shared/domain";
import { actorForRoleOption, actorRoleOptionValue, actorWithRole, selectablePersonaActors } from "../../src/client/role-selection";

const actors: Actor[] = [
  { id: "same-user", name: "Arash", email: "organizer@example.com", role: "applicant" },
  { id: "same-user", name: "Arash", email: "organizer@example.com", role: "organizer" },
];

describe("multi-role actor selection", () => {
  it("limits production persona switching to the signed-in identity", () => {
    const otherReviewer: Actor = { id: "other-user", name: "Reviewer", email: "reviewer@example.com", role: "reviewer" };
    expect(selectablePersonaActors([...actors, otherReviewer], actors[0], false)).toEqual(actors);
    expect(selectablePersonaActors([...actors, otherReviewer], actors[0], true)).toEqual([...actors, otherReviewer]);
  });

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

  it("keeps a deserialized active actor aligned with its unique persona option", () => {
    const uniqueActors = [
      { ...actors[0], id: "applicant-user" },
      { ...actors[1], id: "organizer-user" },
    ];
    const deserializedActiveActor = { ...uniqueActors[1] };

    expect(actorRoleOptionValue(deserializedActiveActor, uniqueActors)).toBe("organizer-user");
  });

  it("resolves the exact selected membership instead of the first matching user", () => {
    expect(actorForRoleOption(actors, "same-user:organizer")?.role).toBe("organizer");
    expect(actorWithRole(actors, "same-user", "organizer")?.role).toBe("organizer");
  });
});
