const agendaFavoritesPrefix = "conference-ops:agenda-favorites:";

type FavoritesStorage = Pick<Storage, "getItem" | "setItem">;

export function agendaFavoritesStorageKey(eventSlug: string) {
  return `${agendaFavoritesPrefix}${encodeURIComponent(eventSlug)}`;
}

function browserStorage(): FavoritesStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadAgendaFavorites(
  eventSlug: string,
  storage: FavoritesStorage | undefined = browserStorage(),
) {
  if (!storage) return new Set<string>();
  try {
    const value: unknown = JSON.parse(storage.getItem(agendaFavoritesStorageKey(eventSlug)) ?? "[]");
    if (!Array.isArray(value)) return new Set<string>();
    return new Set(value.filter((item): item is string =>
      typeof item === "string" && item.length > 0 && item.length <= 512));
  } catch {
    return new Set<string>();
  }
}

export function saveAgendaFavorites(
  eventSlug: string,
  favorites: ReadonlySet<string>,
  storage: FavoritesStorage | undefined = browserStorage(),
) {
  if (!storage) return false;
  try {
    storage.setItem(agendaFavoritesStorageKey(eventSlug), JSON.stringify([...favorites]));
    return true;
  } catch {
    return false;
  }
}
