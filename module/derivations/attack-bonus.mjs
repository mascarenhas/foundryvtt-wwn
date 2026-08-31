import { isPc } from "../helpers/actor-types.mjs";
/**
 * Derive PC attack bonus from Class/Edge progressions at character level.
 */

/**
 * Live Actor.migrateData used to treat a pruned `abMod: 0` as "needs residual"
 * and write `0 - floor(level / 2)`. That exact leftover is never a real modifier.
 * @param {number} abMod
 * @param {number} level
 * @returns {boolean}
 */
export function isSpuriousExpertAbResidual(abMod, level) {
  const mod = Number(abMod);
  const lv = Math.max(Number(level) || 1, 1);
  return Number.isFinite(mod) && mod !== 0 && mod === -Math.floor(lv / 2);
}

/**
 * @param {number} abMod
 * @param {number} level
 * @returns {number}
 */
export function effectiveAbMod(abMod, level) {
  if (isSpuriousExpertAbResidual(abMod, level)) return 0;
  return Number(abMod) || 0;
}

/**
 * @param {Actor} actor
 */
export function deriveAttackBonus(actor) {
  if (!isPc(actor)) return;

  const system = actor.system;
  const level = Math.max(system.details?.level ?? 1, 1);
  const progressions = CONFIG.WWN.attackProgressions;

  const modes = actor.items
    .filter((i) => i.type === "classEdge" && i.system.attackProgression !== "none")
    .map((i) => i.system.attackProgression);

  const effectiveModes = modes.length ? modes : ["expert"];

  const base = Math.max(
    ...effectiveModes.map((m) => progressions[m]?.compute(level) ?? 0)
  );
  const mod = effectiveAbMod(system.combat.abMod, level);

  system.combat.abBase = base;
  system.combat.ab = base + mod;
}

/**
 * Residual modifier when migrating persisted combat.ab to abMod.
 * @param {number} oldAb
 * @param {number} level
 * @param {{ warrior?: boolean }} [options]
 */
export function computeAbModResidual(oldAb, level, { warrior = false } = {}) {
  const progressions = CONFIG.WWN?.attackProgressions;
  const key = warrior ? "warrior" : "expert";
  const base = progressions?.[key]?.compute(Math.max(level, 1)) ?? Math.floor(level / 2);
  return (Number(oldAb) || 0) - base;
}
