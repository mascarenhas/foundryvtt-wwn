/**
 * Unlinked NPC random HP: roll HD when the token is created on the canvas.
 * Foundry v14 Roll#evaluateSync cannot roll dice (strict:false yields 0).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../build/foundry-shim.mjs";
import {
  shouldApplyRandomNpcHp,
  npcHdFormula,
  randomNpcHpUpdates,
} from "../module/combat/random-hp.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("shouldApplyRandomNpcHp", () => {
  const npc = { type: "monster" };
  const pc = { type: "character" };

  it("rolls only for unlinked NPCs when the setting is on", () => {
    assert.equal(shouldApplyRandomNpcHp({ enabled: true, actor: npc, actorLink: false }), true);
    assert.equal(shouldApplyRandomNpcHp({ enabled: true, actor: npc, actorLink: true }), false);
    assert.equal(shouldApplyRandomNpcHp({ enabled: false, actor: npc, actorLink: false }), false);
    assert.equal(shouldApplyRandomNpcHp({ enabled: true, actor: pc, actorLink: false }), false);
    assert.equal(shouldApplyRandomNpcHp({ enabled: true, actor: null, actorLink: false }), false);
  });
});

describe("npcHdFormula / randomNpcHpUpdates", () => {
  it("uses system.hd and defaults to 1d8", () => {
    assert.equal(npcHdFormula({ system: { hd: "4d8+2" } }), "4d8+2");
    assert.equal(npcHdFormula({ system: {} }), "1d8");
  });

  it("writes rolled HP onto the token actor", () => {
    assert.deepEqual(randomNpcHpUpdates(11), {
      "system.hp.value": 11,
      "system.hp.max": 11,
    });
  });
});

describe("random HP wiring", () => {
  it("rolls on token create, not combat, and does not use evaluateSync", () => {
    const src = fs.readFileSync(path.join(root, "module/combat/random-hp.mjs"), "utf8");
    assert.match(src, /createToken/);
    assert.doesNotMatch(src, /preCreateToken/);
    assert.doesNotMatch(src, /evaluateSync/);
    assert.match(src, /\.evaluate\(/);
    assert.doesNotMatch(src, /combatant|createCombatant|combat\.create/i);
  });

  it("describes canvas token creation, not adding to combat", () => {
    const lang = JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8"));
    const hint = lang["WWN.Setting.RandomHPHint"];
    assert.match(hint, /token|canvas|scene|unlinked/i);
    assert.doesNotMatch(hint, /combat/i);
  });
});
