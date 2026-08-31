/**
 * Seed NPC attack bonus from the first integer in the HD string.
 * Only used when an update includes system.hd — not a derived value.
 */

/** @param {unknown} hd */
export function parseHdCount(hd) {
  const match = String(hd ?? "").trim().match(/^\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * @param {object} changed Candidate document update.
 * @param {unknown} [currentHd] Current actor HD; seed AB only when HD actually changes.
 * @returns {object} The same `changed` object.
 */
export function applyHdAttackBonus(changed, currentHd) {
  if (!changed || typeof changed !== "object") return changed;
  const system = changed.system;
  if (!system || typeof system !== "object" || !Object.prototype.hasOwnProperty.call(system, "hd")) {
    return changed;
  }
  const count = parseHdCount(system.hd);
  const previous = parseHdCount(currentHd);
  if (count == null || count === previous) return changed;
  if (system.combat && Object.prototype.hasOwnProperty.call(system.combat, "ab")) {
    return changed;
  }
  system.combat ??= {};
  system.combat.ab = count;
  return changed;
}
