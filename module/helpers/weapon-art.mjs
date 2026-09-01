/**
 * Weapon -> Art links.
 *
 * Links use an owned Item id so renames are safe, plus a name fallback for
 * legacy worlds and documents copied between actors.
 */

/** Normalize the pre-v2 weapon Art field. */
export function normalizeWeaponArtFallback(value) {
  const fallback = String(value ?? "").trim();
  return fallback.toLowerCase() === "none" ? "" : fallback;
}

/** Whether an item is a migrated Art power. */
export function isArtPower(item) {
  return item?.type === "power" && item.system?.subType === "art";
}

/**
 * Resolve an owned Art by id first, then by an exact case-insensitive name.
 * Non-Art powers are deliberately rejected even when their id or name matches.
 */
export function resolveLinkedArt(items, { artId = "", artFallback = "" } = {}) {
  const list = [...(items ?? [])];
  if (artId) {
    const byId = list.find(
      (item) => (item.id === artId || item._id === artId) && isArtPower(item)
    );
    if (byId) return byId;
  }

  const fallback = normalizeWeaponArtFallback(artFallback).toLowerCase();
  if (!fallback) return null;
  return list.find(
    (item) => isArtPower(item) && String(item.name ?? "").trim().toLowerCase() === fallback
  ) ?? null;
}

/**
 * Backfill migrated weapon links after legacy Arts have become power items.
 * Returns a new array and clones only weapon records whose link changes.
 */
export function backfillWeaponArtLinks(items) {
  const list = [...(items ?? [])];
  return list.map((item) => {
    if (item?.type !== "weapon") return item;
    const system = item.system ?? {};
    const linked = resolveLinkedArt(list, system);
    if (!linked) return item;

    const artId = linked.id ?? linked._id ?? "";
    const artFallback = String(linked.name ?? "").trim();
    if (system.artId === artId && system.artFallback === artFallback) return item;
    return {
      ...item,
      system: {
        ...system,
        artId,
        artFallback,
      },
    };
  });
}

/** Whether an actor's weapon links need the post-item migration pass. */
export function weaponArtLinksNeedBackfill(items) {
  const list = [...(items ?? [])];
  return backfillWeaponArtLinks(list).some((item, index) => item !== list[index]);
}

/**
 * Keep the name fallback synchronized with a sheet selection without erasing
 * an unresolved legacy fallback during an unrelated submit-on-change event.
 */
export function weaponArtFallbackForSelection({
  items,
  artId = "",
  currentFallback = "",
  selectionChanged = false,
} = {}) {
  const linked = resolveLinkedArt(items, { artId });
  if (linked) return String(linked.name ?? "").trim();
  if (selectionChanged && !artId) return "";
  return normalizeWeaponArtFallback(currentFallback);
}

/**
 * Decide whether a form submit represents an Art selection change. A stale
 * copied id with no local match renders as a blank select; unrelated submits
 * must not mistake that blank for an explicit unlink.
 */
export function weaponArtSelectionChanged({
  submittedArtId = "",
  storedArtId = "",
  resolvedArtId = "",
  controlChanged = false,
} = {}) {
  if (controlChanged) return true;
  const submitted = String(submittedArtId ?? "");
  const selected = String(resolvedArtId || storedArtId || "");
  return submitted !== selected && (!!submitted || !!resolvedArtId);
}

/**
 * Activate a linked Art only after the attack card was successfully created.
 * Art failures cannot invalidate an attack that is already in chat.
 */
export async function useLinkedArtAfterAttack(weapon, attackMessage) {
  if (!attackMessage) return attackMessage;
  const art = weapon?.system?.linkedArt;
  if (!art?.usePower) return attackMessage;
  try {
    await art.usePower({ skipDialog: true });
  } catch (err) {
    console.warn(`WWN | Linked Art use failed for ${weapon?.name ?? "weapon"}`, err);
  }
  return attackMessage;
}
