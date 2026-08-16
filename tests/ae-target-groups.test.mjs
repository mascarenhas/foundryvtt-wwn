/**
 * Actor AE dropdown groups: common sections first, Combat stays lean.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../build/foundry-shim.mjs";
import { getAeTargetGroups } from "../module/config/ae-targets.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("AE target group order", () => {
  before(() => {
    globalThis.game = {
      settings: { get: () => "wwn" },
      i18n: { localize: (k) => k, format: (k) => k },
    };
    globalThis.CONFIG = {
      WWN: {
        saveSets: {
          wwn: {
            saves: {
              physical: { label: "Physical" },
              evasion: { label: "Evasion" },
              mental: { label: "Mental" },
              luck: { label: "Luck" },
            },
          },
        },
      },
      Canvas: { detectionModes: {} },
    };
  });

  it("lists common groups before token and starship sections", () => {
    const ids = Object.keys(getAeTargetGroups());
    assert.deepEqual(ids, [
      "combat",
      "combatTraits",
      "saves",
      "abilities",
      "movement",
      "trackers",
      "starship",
      "tokenSight",
      "tokenLight",
    ]);
  });

  it("keeps starship, skill floor, and special flags out of Combat", () => {
    const combat = Object.keys(getAeTargetGroups().combat.targets);
    assert.ok(combat.includes("system.combat.ac.mod"));
    assert.ok(combat.includes("system.combat.allDamage"));
    assert.ok(combat.includes("system.combat.unarmedShock"));
    assert.ok(combat.includes("system.hitDice.perLevelMod"));
    assert.ok(!combat.some((k) => k.startsWith("system.starship.")));
    assert.ok(!combat.includes("system.skills.floor"));
    assert.ok(!combat.includes("system.combat.immuneToShock"));
  });

  it("preserves registry order in the AE editor instead of alphabetizing", () => {
    const src = fs.readFileSync(path.join(root, "module/applications/ae-config.mjs"), "utf8");
    const builder = src.slice(src.indexOf("#buildOptgroups"), src.indexOf("/** @override */"));
    assert.doesNotMatch(builder, /\.sort\(/);
  });
});
