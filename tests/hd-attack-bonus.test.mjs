/**
 * NPC HD → AB seeding.
 * Run: node --test tests/hd-attack-bonus.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHdCount, applyHdAttackBonus } from "../module/helpers/hd-attack-bonus.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("parseHdCount", () => {
  it("returns the first integer in the HD string", () => {
    assert.equal(parseHdCount("13d8"), 13);
    assert.equal(parseHdCount("1d8+2"), 1);
    assert.equal(parseHdCount("13"), 13);
    assert.equal(parseHdCount("4+2"), 4);
    assert.equal(parseHdCount(" 13d8"), 13);
  });

  it("returns null when there is no integer", () => {
    assert.equal(parseHdCount(""), null);
    assert.equal(parseHdCount("d8"), null);
    assert.equal(parseHdCount(null), null);
  });
});

describe("applyHdAttackBonus", () => {
  it("sets combat.ab when system.hd is in the change", () => {
    const changed = { system: { hd: "13d8" } };
    applyHdAttackBonus(changed);
    assert.equal(changed.system.combat.ab, 13);
  });

  it("preserves other combat keys when writing ab", () => {
    const changed = { system: { hd: "4+2", combat: { damageBonus: 2 } } };
    applyHdAttackBonus(changed);
    assert.equal(changed.system.combat.ab, 4);
    assert.equal(changed.system.combat.damageBonus, 2);
  });

  it("leaves ab alone when hd is not in the change", () => {
    const changed = { system: { combat: { ab: 7 } } };
    applyHdAttackBonus(changed);
    assert.equal(changed.system.combat.ab, 7);
  });

  it("leaves ab alone when hd has no integer", () => {
    const changed = { system: { hd: "d8", combat: { ab: 3 } } };
    applyHdAttackBonus(changed);
    assert.equal(changed.system.combat.ab, 3);
  });

  it("leaves ab alone when hd equals currentHd", () => {
    const changed = { system: { hd: "13d8", combat: { ab: 7 } } };
    applyHdAttackBonus(changed, "13d8");
    assert.equal(changed.system.combat.ab, 7);
  });

  it("leaves ab alone when only the HD die size changes", () => {
    const changed = { system: { hd: "4d10", combat: { damageBonus: 1 } } };
    applyHdAttackBonus(changed, "4d8");
    assert.equal(changed.system.combat.ab, undefined);
  });

  it("does not overwrite ab included in the same update", () => {
    const changed = { system: { hd: "4+2", combat: { ab: 7 } } };
    applyHdAttackBonus(changed, "13d8");
    assert.equal(changed.system.combat.ab, 7);
  });

  it("sets ab when hd count changes and ab is not in the update", () => {
    const changed = { system: { hd: "4+2" } };
    applyHdAttackBonus(changed, "13d8");
    assert.equal(changed.system.combat.ab, 4);
  });
});

describe("WwnNpc._preUpdate", () => {
  it("only calls applyHdAttackBonus", () => {
    const src = fs.readFileSync(path.join(root, "module/data/actor/npc.mjs"), "utf8");
    assert.match(src, /applyHdAttackBonus\(changed,\s*this\.hd\)/);
    assert.match(src, /parseHdCount\(this\.hd\)/);
    assert.match(src, /async _preUpdate\(/);
    assert.doesNotMatch(src, /this\.combat\.ab\s*=/);
  });
});
