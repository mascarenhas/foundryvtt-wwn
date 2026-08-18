/**
 * Unit tests for encumbrance-tier movement derivation.
 */
import "../build/foundry-shim.mjs";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveMovement } from "../module/derivations/movement.mjs";
import { WWN_SETTING_MENUS } from "../module/settings/menu-config.mjs";

const settings = new Map();

beforeEach(() => {
  settings.clear();
  settings.set("showMovement", true);
  settings.set("movementRate", "feet");
  globalThis.game = {
    settings: { get: (_ns, key) => settings.get(key) },
  };
  globalThis.CONFIG.WWN = {
    movementRates: {
      feet: [30, 20, 15],
      meters: [10, 7, 5],
      bx: [40, 30, 20],
      movewwn: [30, 20, 15],
      movebx: [40, 30, 20],
    },
  };
});

afterEach(() => {
  delete globalThis.game;
});

function pc({ readied, stowed, bonus = 0 }) {
  return {
    type: "character",
    system: {
      movement: {
        base: { value: 30 },
        bonus,
        combat: 0,
        exploration: 0,
        daily: 0,
      },
      encumbrance: {
        readied: { value: readied, max: 5 },
        stowed: { value: stowed, max: 10 },
      },
    },
  };
}

function speeds(actor) {
  const m = actor.system.movement;
  return { combat: m.combat, exploration: m.exploration, daily: m.daily };
}

describe("deriveMovement", () => {
  it("uses full speed when within both maxes", () => {
    const actor = pc({ readied: 5, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 30, exploration: 90, daily: null });
  });

  it("drops to mid tier when readied is +1..+2 over max", () => {
    const actor = pc({ readied: 7, stowed: 10 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 20);
  });

  it("drops to mid tier when stowed is +1..+4 over max", () => {
    const actor = pc({ readied: 5, stowed: 14 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 20);
  });

  it("drops to slow tier at heavier overload", () => {
    const actor = pc({ readied: 7, stowed: 14 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 15);
  });

  it("drops to slow tier for +4 readied alone", () => {
    const actor = pc({ readied: 9, stowed: 10 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 15);
  });

  it("drops to slow tier for +8 stowed alone", () => {
    const actor = pc({ readied: 5, stowed: 18 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 15);
  });

  it("zeros movement when overload exceeds all tiers", () => {
    const actor = pc({ readied: 20, stowed: 30 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 0);
  });

  it("zeros movement when +4 readied and +4 stowed", () => {
    const actor = pc({ readied: 9, stowed: 14 });
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 0);
  });

  it("adds movement bonus on top of the encumbrance tier", () => {
    const actor = pc({ readied: 5, stowed: 10, bonus: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 40, exploration: 120, daily: null });
  });

  it("ignores encumbrance for NPCs", () => {
    const actor = {
      type: "monster",
      system: {
        movement: { base: { value: 40 }, bonus: 0, combat: 0, exploration: 0, daily: 0 },
        encumbrance: {
          readied: { value: 99, max: 1 },
          stowed: { value: 99, max: 1 },
        },
      },
    };
    deriveMovement(actor);
    assert.equal(actor.system.movement.combat, 40);
  });
});

describe("deriveMovement meters", () => {
  beforeEach(() => {
    settings.set("movementRate", "meters");
  });

  it("uses 10/30 encounter speed and omits daily travel", () => {
    const actor = pc({ readied: 5, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 10, exploration: 30, daily: null });
  });

  it("uses light-encumbered 7 m", () => {
    const actor = pc({ readied: 7, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 7, exploration: 21, daily: null });
  });

  it("uses heavily-encumbered 5 m", () => {
    const actor = pc({ readied: 7, stowed: 14 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 5, exploration: 15, daily: null });
  });
});

describe("deriveMovement B/X and legacy keys", () => {
  it("uses 40/120/24 for unencumbered B/X (exploration / 5 miles)", () => {
    settings.set("movementRate", "bx");
    const actor = pc({ readied: 5, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 40, exploration: 120, daily: 24 });
  });

  it("uses 30/90/18 for lightly encumbered B/X", () => {
    settings.set("movementRate", "bx");
    const actor = pc({ readied: 7, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 30, exploration: 90, daily: 18 });
  });

  it("uses 20/60/12 for heavily encumbered B/X", () => {
    settings.set("movementRate", "bx");
    const actor = pc({ readied: 7, stowed: 14 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 20, exploration: 60, daily: 12 });
  });

  it("scales B/X daily from exploration after a movement bonus", () => {
    settings.set("movementRate", "bx");
    const actor = pc({ readied: 5, stowed: 10, bonus: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 50, exploration: 150, daily: 30 });
  });

  it("treats stored movewwn as feet", () => {
    settings.set("movementRate", "movewwn");
    const actor = pc({ readied: 5, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 30, exploration: 90, daily: null });
  });

  it("treats stored movebx as bx", () => {
    settings.set("movementRate", "movebx");
    const actor = pc({ readied: 5, stowed: 10 });
    deriveMovement(actor);
    assert.deepEqual(speeds(actor), { combat: 40, exploration: 120, daily: 24 });
  });
});

describe("movementRate setting location", () => {
  function settingKeys(menuId) {
    return WWN_SETTING_MENUS[menuId].sections.flatMap((section) =>
      section.settings.map((entry) => (typeof entry === "string" ? entry : entry.key)),
    );
  }

  it("lives in core rules Movement, not house rules", () => {
    assert.ok(settingKeys("core").includes("movementRate"));
    assert.ok(!settingKeys("houseRules").includes("movementRate"));
  });
});

describe("PC movement display", () => {
  it("only renders daily travel when showDailyMovement is set", () => {
    const src = readFileSync(new URL("../templates/actor/pc/tabs/main.hbs", import.meta.url), "utf8");
    assert.match(src, /{{#if showDailyMovement}}[\s\S]*system\.movement\.daily[\s\S]*{{\/if}}/);
  });
});
