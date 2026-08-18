/**
 * Weapon tech level vs powered armor / Ironhide immunity, and armor-ignore thresholds.
 */
import { isTruthyAeFlag } from "./combat-ae-flags.mjs";
import { skillSlugOf } from "./skill-set.mjs";

/** Ironhide / powered armor / plating: block weapons with effective TL ≤ this (and unarmed). */
export const PRIMITIVE_IMMUNE_TL = 3;

/** Armor/shield TL at or below this may be ignored by firearms / TL≥4 (unless magical). */
export const IGNORABLE_ARMOR_TL = 2;

/**
 * Whether the weapon skill/name counts as Punch / unarmed.
 * @param {Item|object} weapon
 * @returns {boolean}
 */
export function isUnarmedWeapon(weapon) {
  const skill = weapon?.system?.linkedSkill;
  const skillSlug = skillSlugOf(skill);
  if (skillSlug === "punch") return true;
  return /unarmed|fist|punch/i.test(weapon?.name ?? "");
}

/**
 * Thrown weapons: tag T, or melee weapons that also have a missile profile.
 * @param {Item|object} weapon
 * @returns {boolean}
 */
export function isThrownWeapon(weapon) {
  const tags = weapon?.system?.tags ?? [];
  if (tags.some((t) => String(t).toUpperCase() === "T")) return true;
  return !!(weapon?.system?.melee && weapon?.system?.missile);
}

/**
 * Whether melee combat AEs (meleeDamage / meleeShock / meleeAttack) apply.
 * Unarmed never uses those buckets (Armsmaster is Stab, not Punch).
 * Thrown ranged attacks still use the melee buckets (Armsmaster thrown weapons).
 * @param {Item|object} weapon
 * @param {"melee"|"ranged"} attackKind
 * @returns {boolean}
 */
export function meleeCombatAeApplies(weapon, attackKind) {
  if (isUnarmedWeapon(weapon)) return false;
  if (attackKind === "melee") return true;
  return attackKind === "ranged" && isThrownWeapon(weapon);
}

/**
 * Combat AE buckets for this attack: melee (including thrown) vs ranged-only.
 * @param {object} combat
 * @param {Item|object} weapon
 * @param {"melee"|"ranged"} attackKind
 * @returns {{ applyMeleeCombatAe: boolean, attack: *, damage: *, shock: * }}
 */
export function combatModeMods(combat = {}, weapon, attackKind) {
  const applyMeleeCombatAe = meleeCombatAeApplies(weapon, attackKind);
  const ranged = !applyMeleeCombatAe && attackKind === "ranged";
  return {
    applyMeleeCombatAe,
    attack: applyMeleeCombatAe ? combat.meleeAttack ?? 0 : ranged ? combat.rangeAttack ?? 0 : 0,
    damage: applyMeleeCombatAe ? combat.meleeDamage : ranged ? combat.rangeDamage : 0,
    shock: applyMeleeCombatAe ? combat.meleeShock : ranged ? combat.rangeShock : 0,
  };
}

/**
 * Shocking Assault L2: unarmed weapons have no shock row, but still get unarmedShock
 * (kept separate from Armsmaster meleeShock / meleeDamage).
 * @param {Item|object} weapon
 * @param {"melee"|"ranged"} attackKind
 * @param {object} combat
 * @returns {boolean}
 */
export function unarmedMeleeShockFromAe(weapon, attackKind, combat = {}) {
  return (
    attackKind === "melee" &&
    isUnarmedWeapon(weapon) &&
    !!combat.unarmedShock
  );
}

/**
 * Effective weapon TL after Armsman-style melee TL4 bump.
 * @param {Actor|object} attacker
 * @param {Item|object} weapon
 * @param {"melee"|"ranged"} attackKind
 * @returns {number}
 */
export function effectiveWeaponTl(attacker, weapon, attackKind) {
  let tl = Number(weapon?.system?.tl);
  if (!Number.isFinite(tl)) tl = 0;
  const bump = isTruthyAeFlag(attacker?.system?.combat?.meleeCountsAsTl4);
  if (bump && attackKind === "melee" && !isUnarmedWeapon(weapon)) {
    tl = Math.max(tl, 4);
  }
  return tl;
}

/**
 * Iterate actor items whether Collection or array.
 * @param {Actor|object} actor
 * @returns {object[]}
 */
function actorItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (typeof items.filter === "function" && !Array.isArray(items)) {
    return items.filter(() => true);
  }
  return Array.from(items);
}

/**
 * Highest TL the target is immune to (null = no TL immunity).
 * Powered body armor, Ironhide AE, and power-armor plating all contribute.
 * @param {Actor|object} target
 * @returns {number|null}
 */
export function targetImmuneWeaponTl(target) {
  if (!target) return null;
  let immune = null;
  if (isTruthyAeFlag(target.system?.combat?.immuneToPrimitiveWeapons)) {
    immune = PRIMITIVE_IMMUNE_TL;
  }
  const derived = target.system?.derived?.immuneWeaponTl;
  if (derived != null && Number.isFinite(Number(derived))) {
    immune = Math.max(immune ?? Number.NEGATIVE_INFINITY, Number(derived));
  }
  for (const item of actorItems(target)) {
    if (item.type !== "armor" || !item.system?.equipped || item.system?.type === "shield") continue;
    if (item.system?.powered) {
      immune = Math.max(immune ?? Number.NEGATIVE_INFINITY, PRIMITIVE_IMMUNE_TL);
    }
  }
  return immune == null || !Number.isFinite(immune) ? null : immune;
}

/**
 * Whether the target's armor / Ironhide blocks this weapon.
 * @param {Actor|object} target
 * @param {number} effectiveTl
 * @param {{ isUnarmed?: boolean }} [options]
 * @returns {boolean}
 */
export function targetBlocksWeapon(target, effectiveTl, { isUnarmed = false } = {}) {
  const immuneTl = targetImmuneWeaponTl(target);
  if (immuneTl == null) return false;
  if (isUnarmed) return true;
  return effectiveTl <= immuneTl;
}

/**
 * Full gate used by attack / shock resolution.
 * @param {Actor|object} attacker
 * @param {Actor|object} target
 * @param {Item|object} weapon
 * @param {"melee"|"ranged"} attackKind
 * @returns {{ blocked: boolean, effectiveTl: number, immuneTl: number|null }}
 */
export function resolveWeaponTlGate(attacker, target, weapon, attackKind) {
  const effectiveTl = effectiveWeaponTl(attacker, weapon, attackKind);
  const immuneTl = targetImmuneWeaponTl(target);
  const blocked = targetBlocksWeapon(target, effectiveTl, { isUnarmed: isUnarmedWeapon(weapon) });
  return { blocked, effectiveTl, immuneTl };
}

/**
 * Trauma die formula with optional attacker dieMod (Killing Blow).
 * @param {string} weaponDie
 * @param {number|string} dieMod
 * @returns {string}
 */
export function traumaDieFormula(weaponDie, dieMod) {
  const die = weaponDie || "1d6";
  const mod = Number(dieMod) || 0;
  return mod ? `${die}+${mod}` : die;
}
