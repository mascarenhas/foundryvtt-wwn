import { isNpc } from "./actor-types.mjs";

/**
 * Transfer AEs on weapons/armor apply only while the item is readied.
 * Foci/powers are not gated. NPCs have no ready toggle, so their gear always applies.
 *
 * @param {ActiveEffect|{ transfer?: boolean, parent?: object }} effect
 * @returns {boolean}
 */
export function isPhysicalTransferSuppressed(effect) {
  if (!effect?.transfer) return false;
  const item = effect.parent;
  if (!item) return false;
  if (item.documentName && item.documentName !== "Item") return false;
  if (!["weapon", "armor"].includes(item.type)) return false;
  if (isNpc(item.parent)) return false;
  return !item.system?.equipped;
}
