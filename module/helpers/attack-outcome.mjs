/**
 * Pure attack-outcome helpers: nat 1/20, shock floor, apply rows, notice keys.
 */

/**
 * First active face from an evaluated Foundry roll, preferring a d20 term.
 * @param {Roll|object} attackRoll
 * @returns {number|null}
 */
export function naturalAttackDie(attackRoll) {
  const terms = attackRoll?.terms;
  if (!Array.isArray(terms)) return null;

  const readActive = (term) => {
    const results = term?.results;
    if (!Array.isArray(results)) return null;
    for (const result of results) {
      if (result?.active === false) continue;
      const n = Number(result.result ?? result);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  for (const term of terms) {
    if (Number(term?.faces) === 20) {
      const n = readActive(term);
      if (n != null) return n;
    }
  }
  for (const term of terms) {
    const n = readActive(term);
    if (n != null) return n;
  }
  return null;
}

/**
 * CB tag: treat unskilled (−2 / negative) as skill 0 for the attack roll.
 * @param {number} skillLevel
 * @param {string[]|unknown} tags
 * @returns {number}
 */
export function skillLevelWithCb(skillLevel, tags) {
  const level = Number(skillLevel);
  const base = Number.isFinite(level) ? level : -2;
  const hasCb = Array.isArray(tags) && tags.includes("CB");
  if (hasCb && base < 0) return 0;
  return base;
}

/**
 * Traumatic damage from floored (post-Godbound) hit damage × rating.
 * @param {number} flooredDamage
 * @param {number} rating
 * @returns {number}
 */
export function traumaticDamage(flooredDamage, rating) {
  return Number(flooredDamage) * Number(rating);
}

/**
 * @param {{
 *   attackTotal: number,
 *   naturalDie: number|null,
 *   targetAc: number|null,
 *   blockedByTl: boolean,
 * }} input
 * @returns {{ hit: boolean, reason: "tl"|"nat1"|"nat20"|"hit"|"miss"|"noTarget" }}
 */
export function resolveAttackHit({ attackTotal, naturalDie, targetAc, blockedByTl }) {
  if (blockedByTl) return { hit: false, reason: "tl" };
  if (naturalDie === 1) return { hit: false, reason: "nat1" };
  if (naturalDie === 20) return { hit: true, reason: "nat20" };
  if (targetAc == null || !Number.isFinite(targetAc)) return { hit: true, reason: "noTarget" };
  const hit = attackTotal >= targetAc;
  return { hit, reason: hit ? "hit" : "miss" };
}

/**
 * Hit damage after Shock floor (book: damage never below Shock on a hit).
 * @param {number} damage
 * @param {number|null} shock
 * @returns {{ value: number, floored: boolean }}
 */
export function applyShockFloor(damage, shock) {
  if (shock == null || !Number.isFinite(shock)) return { value: damage, floored: false };
  if (shock > damage) return { value: shock, floored: true };
  return { value: damage, floored: false };
}

/**
 * AC used when comparing a target to a weapon's Shock threshold.
 * Shocking Assault / Close Combatant / Armsmaster treat every target as AC 10.
 * @param {object} attacker
 * @param {object} targetActor
 * @param {number|null} [resolvedAc]
 * @returns {number}
 */
export function effectiveShockCompareAc(attacker, targetActor, resolvedAc = null) {
  if (attacker?.system?.combat?.treatAllMeleeAsAcTen) return 10;
  if (Number.isFinite(resolvedAc)) return Number(resolvedAc);
  const melee = Number(targetActor?.system?.combat?.ac?.melee?.value);
  return Number.isFinite(melee) ? melee : 10;
}

/**
 * Chat cards only resolve vs a single targeted token.
 * Zero or two-plus actor tokens are treated as untargeted.
 * @param {Iterable} [targets]
 * @returns {{ target: object|null, untargeted: boolean }}
 */
export function resolveChatAttackTarget(targets) {
  const list = [];
  for (const token of targets ?? []) {
    if (token?.actor) list.push(token);
  }
  if (list.length === 1) return { target: list[0], untargeted: false };
  return { target: null, untargeted: true };
}

/**
 * Whether a weapon's stored Shock damage is a real base (not 0 / blank).
 * Pack ranged weapons typically persist `shock.damage` as `"0"`.
 * @param {unknown} damage
 * @returns {boolean}
 */
export function hasBaseShockDamage(damage) {
  if (damage == null) return false;
  const raw = String(damage).trim();
  if (!raw || raw === "0") return false;
  return true;
}

/**
 * Whether the Shock roll row should appear. Untargeted attacks always show it.
 * Omit only when every resolved target's compare AC exceeds the threshold.
 * @param {number} threshold
 * @param {number[]} compareAcs
 * @returns {boolean}
 */
export function shouldShowShockRow(threshold, compareAcs = []) {
  if (!Array.isArray(compareAcs) || !compareAcs.length) return true;
  const acLimit = Number(threshold);
  if (!Number.isFinite(acLimit)) return true;
  return compareAcs.some((ac) => Number(ac) <= acLimit);
}

/**
 * Struck-through "0 Shock" is miss-only. Hits still use Shock as a damage floor.
 * @param {{ hit?: boolean, showShockRow?: boolean, canUseShock?: boolean, hasCompareAcs?: boolean }} args
 */
export function shouldEmitNoShockPlaceholder({
  hit = false,
  showShockRow = false,
  canUseShock = false,
  hasCompareAcs = false,
} = {}) {
  return !hit && !showShockRow && !!canUseShock && !!hasCompareAcs;
}

/**
 * Build localized notice strings from resolution context.
 * @param {object} ctx
 * @param {(key: string, data?: object) => string} localize
 * @returns {string[]}
 */
export function buildAttackNotices(ctx, localize) {
  const notices = [];
  const L = (key, data) => (data ? localize(key, data) : localize(key));

  if (ctx.blockedByTl) {
    notices.push(L("WWN.Roll.NoticeTlBlocked"));
  }
  if (ctx.hitReason === "nat1") notices.push(L("WWN.Roll.NoticeNat1"));
  if (ctx.hitReason === "nat20") notices.push(L("WWN.Roll.NoticeNat20"));

  // Armor-ignore / target-AC notices are irrelevant when the attack never resolved vs AC.
  if (!ctx.blockedByTl) {
    for (const piece of ctx.ignored ?? []) {
      const reasonKey =
        piece.reason === "ap" ? "WWN.Roll.NoticeIgnoreAp"
          : piece.reason === "firearm" ? "WWN.Roll.NoticeIgnoreFirearm"
            : "WWN.Roll.NoticeIgnoreHighTl";
      notices.push(L(reasonKey, {
        name: piece.name,
        kind: piece.isShield ? L("WWN.Armor.shield") : L("WWN.Roll.NoticeArmor"),
      }));
    }
  }

  if (ctx.shockSuppressedReason === "tl") {
    notices.push(L("WWN.Roll.NoticeNoShockTl"));
  } else if (ctx.shockSuppressedReason === "immune") {
    notices.push(L("WWN.Roll.NoticeNoShockImmune"));
  }

  if (ctx.shockFloored) {
    notices.push(L("WWN.Roll.NoticeShockFloor"));
  }

  return notices;
}

/**
 * Assemble chat apply rows for a personal attack.
 * On hit: damageValue is already Shock-floored; damageFloored labels the row.
 * On miss: optional shock row.
 *
 * @param {object} input
 * @returns {object[]}
 */
export function buildAttackApplyRows({
  hit,
  untargeted = false,
  blockedByTl,
  damageValue,
  damageFloored = false,
  straightValue,
  shockTotal,
  shockAppliesOnMiss,
  shockLabelAc,
  trauma,
  missDamageValue,
  labels,
}) {
  const applyRows = [];
  // Traumatic hit replaces normal damage — avoid offering both apply buttons.
  if (hit && trauma?.traumatic) {
    applyRows.push({
      id: "trauma",
      label: labels.trauma(trauma.rating),
      value: trauma.multiplied,
    });
    return applyRows;
  }

  if (hit) {
    applyRows.push({
      id: "damage",
      label: damageFloored ? labels.damageFloored : labels.damage,
      value: damageValue,
      altValue: straightValue,
      altLabel: straightValue != null ? labels.straight?.(straightValue) : null,
      shockFloored: !!damageFloored,
    });
  } else if (!blockedByTl && missDamageValue != null) {
    applyRows.push({
      id: "miss-damage",
      label: labels.missDamage,
      value: missDamageValue,
    });
  }

  if (!blockedByTl && shockTotal != null && ((!hit && shockAppliesOnMiss) || untargeted)) {
    const threshold = Number(shockLabelAc);
    applyRows.push({
      id: "shock",
      label: labels.shock,
      value: shockTotal,
      suffix: Number.isFinite(threshold) ? labels.shockSuffix?.(threshold) : "",
    });
  }

  return applyRows;
}
