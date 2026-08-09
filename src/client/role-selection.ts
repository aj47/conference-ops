import type { Actor, Role } from "../shared/domain";

export function selectablePersonaActors(
  actors: Actor[],
  activeActor: Pick<Actor, "id">,
  demoMode = false,
) {
  return demoMode ? actors : actors.filter((actor) => actor.id === activeActor.id);
}

export function actorRoleOptionValue(
  actor: Pick<Actor, "id" | "role">,
  actors: Array<Pick<Actor, "id" | "role">> = [actor],
) {
  const duplicateIdentity = actors.filter((candidate) => candidate.id === actor.id).length > 1;
  return duplicateIdentity ? `${encodeURIComponent(actor.id)}:${actor.role}` : actor.id;
}

export function actorForRoleOption(actors: Actor[], value: string) {
  return actors.find((actor) => actorRoleOptionValue(actor, actors) === value);
}

export function actorWithRole(actors: Actor[], actorId: string, role?: Role) {
  return actors.find((actor) => actor.id === actorId && (!role || actor.role === role));
}
