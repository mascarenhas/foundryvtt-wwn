/**
 * Unit tests for weapon TL / Ironhide gating.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveWeaponTl,
  targetBlocksWeapon,
  resolveWeaponTlGate,
  traumaDieFormula,
  isUnarmedWeapon,
  isThrownWeapon,
  meleeCombatAeApplies,
  combatModeMods,
  unarmedMeleeShockFromAe,
  PRIMITIVE_IMMUNE_TL,
} from "../module/helpers/weapon-tl.mjs";

describe("effectiveWeaponTl", () => {
  it("defaults missing tl to 0", () => {
    assert.equal(effectiveWeaponTl({}, { system: {} }, "melee"), 0);
  });

  it("bumps melee/thrown to TL4 with meleeCountsAsTl4 (Armsman)", () => {
    const attacker = { system: { combat: { meleeCountsAsTl4: true } } };
    const weapon = { system: { tl: 2 }, name: "Spear" };
    assert.equal(effectiveWeaponTl(attacker, weapon, "melee"), 4);
    assert.equal(effectiveWeaponTl(attacker, weapon, "ranged"), 2);
  });

  it("does not bump Punch / unarmed", () => {
    const attacker = { system: { combat: { meleeCountsAsTl4: true } } };
    const weapon = {
      name: "Fist",
      system: { tl: 0, linkedSkill: { name: "Punch" } },
    };
    assert.equal(effectiveWeaponTl(attacker, weapon, "melee"), 0);
    assert.equal(isUnarmedWeapon(weapon), true);
  });
});

describe("targetBlocksWeapon", () => {
  it("Ironhide blocks unarmed and TL<=3", () => {
    const target = { system: { combat: { immuneToPrimitiveWeapons: true } } };
    assert.equal(targetBlocksWeapon(target, 0, { isUnarmed: true }), true);
    assert.equal(targetBlocksWeapon(target, PRIMITIVE_IMMUNE_TL, { isUnarmed: false }), true);
    assert.equal(targetBlocksWeapon(target, 4, { isUnarmed: false }), false);
  });

  it("power armor derived immuneWeaponTl blocks low TL", () => {
    const target = { system: { derived: { immuneWeaponTl: 3 } } };
    assert.equal(targetBlocksWeapon(target, 3), true);
    assert.equal(targetBlocksWeapon(target, 4), false);
  });

  it("powered body armor item grants immunity", () => {
    const target = {
      items: [{ type: "armor", system: { equipped: true, type: "heavy", powered: true } }],
      system: { combat: {}, derived: {} },
    };
    assert.equal(targetBlocksWeapon(target, 3), true);
    assert.equal(targetBlocksWeapon(target, 4), false);
  });
});

describe("resolveWeaponTlGate", () => {
  it("Armsman TL4 bypasses Ironhide", () => {
    const attacker = { system: { combat: { meleeCountsAsTl4: true } } };
    const target = { system: { combat: { immuneToPrimitiveWeapons: true } } };
    const weapon = { name: "Sword", system: { tl: 2 } };
    const gate = resolveWeaponTlGate(attacker, target, weapon, "melee");
    assert.equal(gate.effectiveTl, 4);
    assert.equal(gate.blocked, false);
  });
});

describe("isThrownWeapon / meleeCombatAeApplies", () => {
  const lightSpear = {
    name: "Spear, Light",
    system: { melee: true, missile: true, tags: ["T"], linkedSkill: { name: "Stab" } },
  };
  const bow = {
    name: "Bow",
    system: { melee: false, missile: true, tags: [], linkedSkill: { name: "Shoot" } },
  };
  const punch = {
    name: "Unarmed Attack",
    system: { melee: true, missile: false, tags: [], linkedSkill: { name: "Punch" } },
  };
  const sword = {
    name: "Sword",
    system: { melee: true, missile: false, tags: [], linkedSkill: { name: "Stab" } },
  };

  it("treats tag T and melee+missile as thrown", () => {
    assert.equal(isThrownWeapon(lightSpear), true);
    assert.equal(isThrownWeapon({ system: { melee: true, missile: true, tags: [] } }), true);
    assert.equal(isThrownWeapon(bow), false);
    assert.equal(isThrownWeapon(sword), false);
  });

  it("applies melee combat AEs to melee weapons and thrown ranged attacks, not unarmed or bows", () => {
    assert.equal(meleeCombatAeApplies(sword, "melee"), true);
    assert.equal(meleeCombatAeApplies(lightSpear, "melee"), true);
    assert.equal(meleeCombatAeApplies(lightSpear, "ranged"), true);
    assert.equal(meleeCombatAeApplies(bow, "ranged"), false);
    assert.equal(meleeCombatAeApplies(punch, "melee"), false);
    assert.equal(meleeCombatAeApplies(punch, "ranged"), false);
  });

  it("routes thrown attacks to melee AE buckets and bows to ranged", () => {
    const combat = { meleeDamage: "@stab", meleeShock: "@stab", meleeAttack: 1, rangeDamage: "@shoot", rangeAttack: 0 };
    const thrown = combatModeMods(combat, lightSpear, "ranged");
    assert.equal(thrown.applyMeleeCombatAe, true);
    assert.equal(thrown.damage, "@stab");
    assert.equal(thrown.shock, "@stab");
    assert.equal(thrown.attack, 1);
    const bowMods = combatModeMods(combat, bow, "ranged");
    assert.equal(bowMods.applyMeleeCombatAe, false);
    assert.equal(bowMods.damage, "@shoot");
    const punchMods = combatModeMods(combat, punch, "melee");
    assert.equal(punchMods.applyMeleeCombatAe, false);
    assert.equal(punchMods.damage, 0);
  });

  it("synthesizes unarmed shock from unarmedShock even with Armsmaster meleeDamage", () => {
    assert.equal(unarmedMeleeShockFromAe(punch, "melee", { unarmedShock: 2 }), true);
    assert.equal(unarmedMeleeShockFromAe(punch, "melee", { unarmedShock: 2, meleeDamage: "@stab", meleeShock: "@stab" }), true);
    assert.equal(unarmedMeleeShockFromAe(punch, "melee", { meleeShock: 2, meleeDamage: "@stab" }), false);
    assert.equal(unarmedMeleeShockFromAe(sword, "melee", { unarmedShock: 2 }), false);
  });
});

describe("traumaDieFormula", () => {
  it("appends Killing Blow dieMod", () => {
    assert.equal(traumaDieFormula("1d6", 0), "1d6");
    assert.equal(traumaDieFormula("1d6", 1), "1d6+1");
    assert.equal(traumaDieFormula("1d8", "2"), "1d8+2");
  });
});
