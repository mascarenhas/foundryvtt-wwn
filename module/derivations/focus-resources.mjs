/**
 * Focus resource grants — custom derivation (deliberately NOT Active Effects).
 * Applies Focus resourceGrant bonuses to derived pool maxes. A Focus may also
 * establish the named pool when no Class/Edge owns it (Wild Psychic Talent).
 */

import { resolvePoolDisplayName } from "../helpers/resource-pool-resolve.mjs";

function focusPoolMembers(actor, targetName) {
  return actor.items.filter((item) => {
    if (item.type !== "power") return false;
    if (!item.system.usesSharedPool || !item.system.effectiveCommitmentOptions?.length) return false;
    return resolvePoolDisplayName(actor, {
      resourceName: item.system.resourceName,
      source: item.system.source,
    }) === targetName;
  });
}

/**
 * @param {Actor} actor
 * @param {Array<object>} pools  Derived pool array (mutated)
 */
export function applyFocusResourceGrants(actor, pools) {
  for (const focus of actor.items.filter((i) => i.type === "focus")) {
    const grant = focus.system.resourceGrant;
    if (!grant?.targetName?.trim() || !(grant.bonusMax > 0)) continue;
    const targetName = grant.targetName.trim();
    let matches = pools.filter((p) => p.name === targetName && p.level == null);
    if (!matches.length) {
      const members = focusPoolMembers(actor, targetName);
      const value = members.reduce(
        (sum, power) => sum + (Number(power.system.poolCommittedSum) || 0),
        0,
      );
      const pool = {
        id: `pool-${targetName}`.slugify(),
        name: targetName,
        level: null,
        value,
        max: 0,
        warning: null,
      };
      pools.push(pool);
      matches = [pool];
    }
    for (const pool of matches) {
      pool.max += grant.bonusMax;
      if (pool.warning === "WWN.Pools.WarnNoClassEdge") pool.warning = null;
    }
  }
}
