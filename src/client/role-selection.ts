import type { Actor, Role } from "../shared/domain";

export function actorRoleOptionValue(
  actor: Pick<Actor, "id" | "role">,
  actors: Array<Pick<Actor, "id" | "role">> = [actor],
) {
  const duplicateIdentity = actors.some(
    (candidate) => candidate !== actor && candidate.id === actor.id,
  );
  return duplicateIdentity ? `${encodeURIComponent(actor.id)}:${actor.role}` : actor.id;
}

export function actorForRoleOption(actors: Actor[], value: string) {
  return actors.find((actor) => actorRoleOptionValue(actor, actors) === value);
}

export function actorWithRole(actors: Actor[], actorId: string, role?: Role) {
  return actors.find((actor) => actor.id === actorId && (!role || actor.role === role));
}
