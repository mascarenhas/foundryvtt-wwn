/**
 * Weapon/armor transfer AEs apply only while readied; foci always apply.
 * The sheet must not list suppressed effects as passive.
 * Run: node --test tests/active-effect-suppress.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { isPhysicalTransferSuppressed } from "../module/helpers/effect-suppress.mjs";
import { prepareActiveEffectCategories } from "../module/helpers/effects.mjs";

function weaponEffect({ equipped = false, transfer = true, actorType = "character" } = {}) {
  return {
    transfer,
    parent: {
      documentName: "Item",
      type: "weapon",
      system: { equipped },
      parent: { type: actorType },
    },
  };
}

describe("isPhysicalTransferSuppressed", () => {
  it("suppresses a transfer AE on an unreadied weapon", () => {
    assert.equal(isPhysicalTransferSuppressed(weaponEffect({ equipped: false })), true);
  });

  it("applies a transfer AE on a readied weapon", () => {
    assert.equal(isPhysicalTransferSuppressed(weaponEffect({ equipped: true })), false);
  });

  it("does not suppress a focus transfer AE", () => {
    const effect = {
      transfer: true,
      parent: {
        documentName: "Item",
        type: "focus",
        system: {},
        parent: { type: "character" },
      },
    };
    assert.equal(isPhysicalTransferSuppressed(effect), false);
  });

  it("does not suppress NPC weapon transfer AEs (no ready toggle on the NPC sheet)", () => {
    assert.equal(isPhysicalTransferSuppressed(weaponEffect({ equipped: false, actorType: "monster" })), false);
  });
});

describe("prepareActiveEffectCategories", () => {
  const originalGame = globalThis.game;

  before(() => {
    globalThis.game = { i18n: { localize: (k) => k } };
  });

  after(() => {
    globalThis.game = originalGame;
  });

  it("lists suppressed transfer effects as inactive, not passive", () => {
    const cats = prepareActiveEffectCategories([
      { id: "1", disabled: false, isTemporary: false, isSuppressed: true, name: "Sword AC" },
    ]);
    assert.equal(cats.passive.effects.length, 0);
    assert.equal(cats.inactive.effects.length, 1);
    assert.equal(cats.inactive.effects[0].name, "Sword AC");
  });
});
