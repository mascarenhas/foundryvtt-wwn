/** Legacy v13 Effort and spell-slot state migration regressions. */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyLegacyUnleveledSpellSpend,
  migrateActorData,
  migrateActorItems,
  migrateArtToPower,
  migrateSpellToPower,
} from "../module/migration/transforms.mjs";
import { deriveResourcePools } from "../module/derivations/resource-pools.mjs";

function legacyArt(name, { source, time, effort }) {
  return {
    _id: name.replaceAll(/[^A-Za-z0-9]/g, "").padEnd(16, "0").slice(0, 16),
    name,
    type: "art",
    system: { source, time, effort },
  };
}

function legacySpell(id, { prepared = true, cast = 0, memorized = 0, level = 1 } = {}) {
  return {
    _id: id,
    name: id,
    type: "spell",
    system: {
      class: "High Mage",
      lvl: level,
      prepared,
      cast,
      memorized,
    },
  };
}

function legacyPc({
  items = [],
  perDay = { value: 0, max: 0 },
  className = "Sorcerer (High Mage)",
  classes = {},
} = {}) {
  return {
    type: "character",
    name: "Legacy PC",
    system: {
      scores: Object.fromEntries(
        ["str", "dex", "con", "int", "wis", "cha"].map((key) => [key, { value: 10 }]),
      ),
      hp: { value: 10, max: 10, hd: "1d6" },
      details: { class: className, level: 10 },
      classes,
      spells: {
        leveledSlots: false,
        perDay,
        prepared: { value: 0, max: 12 },
      },
      thac0: { bba: 2 },
      skills: {},
      saves: {},
      aac: {},
      initiative: {},
      movement: { base: 30 },
      currency: {},
    },
    items,
    effects: [],
  };
}

function runtimePower(source) {
  const effectiveCommitmentOptions = (source.system.commitmentOptions ?? []).filter(
    (option) => option.cost > 0,
  );
  const poolCommittedSum = Object.values(source.system.poolCommitted ?? {}).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
  return {
    ...source,
    id: source._id,
    system: {
      ...source.system,
      usesSharedPool: effectiveCommitmentOptions.length > 0,
      effectiveCommitmentOptions,
      poolCommittedSum,
    },
  };
}

function runtimeActor(items) {
  return {
    type: "character",
    items: {
      filter: (fn) => items.filter(fn),
      some: (fn) => items.some(fn),
      [Symbol.iterator]: () => items[Symbol.iterator](),
    },
    getRollData: () => ({ level: 10 }),
    system: {},
  };
}

const highMageEdge = {
  id: "high-mage",
  type: "classEdge",
  name: "Full High Mage",
  system: {
    poolGrant: {
      name: "High Mage Effort",
      formula: "",
      progression: Array(10).fill(4),
    },
    slotGrant: {
      enabled: false,
      progression: [1, 1, 2, 2, 3, 3, 4, 4, 5, 6],
      leveledProgression: [],
    },
    preparedGrant: { progression: [] },
  },
};

describe("legacy committed Effort migration", () => {
  it("moves the counter into the matching shared-pool duration bucket", () => {
    const scene = migrateArtToPower(
      legacyArt("Scene Art", { source: "Psychic", time: "Scene", effort: 2 }),
    );
    assert.deepEqual(scene.system.poolCommitted, {
      none: 0,
      active: 0,
      scene: 2,
      day: 0,
    });
    assert.deepEqual(scene.system.internalResource, { value: 0, max: 0 });

    const committed = migrateArtToPower(
      legacyArt("Maintained Art", { source: "Psychic", time: "Committed", effort: 1 }),
    );
    assert.equal(committed.system.commitmentOptions[0].length, "active");
    assert.equal(committed.system.poolCommitted.active, 1);
  });

  it("keeps a non-zero blank-time counter as active commitment", () => {
    const migrated = migrateArtToPower(
      legacyArt("Tongue of the Beasts", { source: "Beastmaster", time: "", effort: 1 }),
    );
    assert.deepEqual(migrated.system.commitmentOptions, [
      { cost: 1, length: "active", note: "" },
    ]);
    assert.equal(migrated.system.poolCommitted.active, 1);

    const passive = migrateArtToPower(
      legacyArt("Passive Art", { source: "Beastmaster", time: "", effort: 0 }),
    );
    assert.deepEqual(passive.system.commitmentOptions, [
      { cost: 0, length: "none", note: "" },
    ]);
  });

  it("maps Psychic, Wild Talent, and Legate Arts to their native shared pools", () => {
    assert.equal(
      migrateArtToPower(legacyArt("Psychic", { source: "Psychic", time: "Scene", effort: 0 }))
        .system.resourceName,
      "Psychic Effort",
    );
    assert.equal(
      migrateArtToPower(legacyArt("Wild", { source: "Wild Talent", time: "Scene", effort: 0 }))
        .system.resourceName,
      "Psychic Effort",
    );
    assert.equal(
      migrateArtToPower(legacyArt("Legate", { source: "Legate", time: "Scene", effort: 0 }))
        .system.resourceName,
      "Legate Effort",
    );
  });

  it("preserves all 13 committed points present on the pristine Dark Sun PCs", () => {
    const actors = [
      [
        "Adnaan (Copy)",
        [
          ["Savage Senses", "Beastmaster", "Scene", 1],
          ["Mind Call", "Beastmaster", "Scene", 1],
          ["Eyes of the Beast", "Beastmaster", "Scene", 1],
          ["Tongue of the Beasts", "Beastmaster", "", 1],
        ],
        { active: 1, scene: 3, day: 0 },
      ],
      [
        "Wener",
        [
          ["Accelerated Succor", "Psychic", "Day", 2],
          ["Tissue Integrity Field", "Psychic", "Day", 1],
        ],
        { active: 0, scene: 0, day: 3 },
      ],
      [
        "M'uamba Khara",
        [
          ["Ward Allies", "High Mage", "Day", 1],
          ["Legate's Wrath", "Legate", "Scene", 2],
        ],
        { active: 0, scene: 2, day: 1 },
      ],
      [
        "Vax Devitto",
        [["Telekinetic Manipulation", "Psychic", "Scene", 1]],
        { active: 0, scene: 1, day: 0 },
      ],
      [
        "Tao´ka",
        [
          ["Spatial Awareness", "Psychic", "Committed", 1],
          ["Stutterjump", "Psychic", "Day", 1],
        ],
        { active: 1, scene: 0, day: 1 },
      ],
    ];

    let total = 0;
    for (const [actorName, arts, expected] of actors) {
      const buckets = { active: 0, scene: 0, day: 0 };
      for (const [name, source, time, effort] of arts) {
        const migrated = migrateArtToPower(legacyArt(name, { source, time, effort }));
        for (const key of Object.keys(buckets)) {
          buckets[key] += migrated.system.poolCommitted[key];
        }
      }
      assert.deepEqual(buckets, expected, actorName);
      total += Object.values(buckets).reduce((sum, value) => sum + value, 0);
    }
    assert.equal(total, 13);
  });
});

describe("legacy Dark Sun side-resource grants", () => {
  it("restores Wild Psychic Talent and Legate as native grant Items", () => {
    const migrated = migrateActorData(legacyPc({
      className: "Sorcerer (High Mage)",
      classes: { Psychic: { max: 1 }, Legate: { max: 2 } },
      items: [
        legacyArt("Sense the Need", { source: "Psychic", time: "Day", effort: 0 }),
        legacyArt("Legate's Wrath", { source: "Legate", time: "Scene", effort: 2 }),
        legacyArt("Ward Allies", { source: "High Mage", time: "Day", effort: 1 }),
      ],
    }));

    const focus = migrated.items.find((item) => item.type === "focus" && item.name === "Wild Psychic Talent");
    assert.ok(focus);
    assert.equal(focus.system.ownedLevel, 1);
    assert.deepEqual(focus.system.resourceGrant, {
      targetName: "Psychic Effort",
      targetSource: "",
      bonusMax: 1,
    });
    assert.deepEqual(focus.system.internalResource, { value: 0, max: 0 });

    const legate = migrated.items.find((item) => item.type === "classEdge" && item.name === "Legate");
    assert.ok(legate);
    assert.equal(legate.system.edgeType, "edge");
    assert.equal(legate.system.poolGrant.name, "Legate Effort");
    assert.equal(legate.system.poolGrant.formula, "2");
    assert.deepEqual(legate.system.poolGrant.progression, []);

    const runtimeItems = migrated.items.map((item) => item.type === "power" ? runtimePower(item) : item);
    const runtime = runtimeActor(runtimeItems);
    deriveResourcePools(runtime);
    const psychic = runtime.system.resourcePools.find((pool) => pool.name === "Psychic Effort");
    const legatePool = runtime.system.resourcePools.find((pool) => pool.name === "Legate Effort");
    assert.deepEqual({ value: psychic?.value, max: psychic?.max }, { value: 0, max: 1 });
    assert.deepEqual({ value: legatePool?.value, max: legatePool?.max }, { value: 2, max: 2 });

    const second = migrateActorData({
      type: "character",
      system: migrated.system,
      items: migrated.items,
      effects: migrated.effects,
    });
    assert.equal(second.items.filter((item) => item.name === "Wild Psychic Talent").length, 1);
    assert.equal(second.items.filter((item) => item.name === "Legate").length, 1);

    const editedLegate = second.items.find((item) => item.name === "Legate");
    editedLegate.system.poolGrant.formula = "3";
    const third = migrateActorData({
      type: "character",
      system: migrated.system,
      items: second.items,
      effects: migrated.effects,
    });
    assert.equal(
      third.items.find((item) => item.name === "Legate").system.poolGrant.formula,
      "3",
      "a retry must preserve an edited native Edge maximum",
    );
  });

  it("reconstructs grants when a failed v13 pass already persisted the canonical Actor system", () => {
    const canonical = migrateActorData(legacyPc({ className: "Sorcerer (High Mage)" })).system;
    assert.equal(canonical.scores, undefined);
    assert.equal(canonical.classes, undefined);

    const retried = migrateActorData({
      type: "character",
      system: canonical,
      items: [
        legacyArt("Sense the Need", { source: "Psychic", time: "Day", effort: 0 }),
        legacyArt("Legate's Wrath", { source: "Legate", time: "Scene", effort: 2 }),
      ],
      effects: [],
    });
    assert.equal(retried.items.filter((item) => item.name === "Wild Psychic Talent").length, 1);
    assert.equal(retried.items.filter((item) => item.name === "Legate").length, 1);
    assert.equal(
      retried.items.find((item) => item.name === "Legate").system.poolGrant.formula,
      "2",
    );
  });

  it("repairs already-converted side Powers if a retry starts from alpha2.5-shaped Items", () => {
    const canonical = migrateActorData(legacyPc({ className: "Sorcerer (High Mage)" })).system;
    const psychic = migrateArtToPower(
      legacyArt("Sense the Need", { source: "Psychic", time: "Day", effort: 0 }),
    );
    const legate = migrateArtToPower(
      legacyArt("Legate's Wrath", { source: "Legate", time: "Scene", effort: 2 }),
    );
    psychic.system.resourceName = "Effort";
    legate.system.resourceName = "Effort";

    const retried = migrateActorData({
      type: "character",
      system: canonical,
      items: [psychic, legate],
      effects: [],
    });
    assert.equal(
      retried.items.find((item) => item.name === "Sense the Need").system.resourceName,
      "Psychic Effort",
    );
    assert.equal(
      retried.items.find((item) => item.name === "Legate's Wrath").system.resourceName,
      "Legate Effort",
    );
    assert.equal(retried.items.filter((item) => item.name === "Wild Psychic Talent").length, 1);
    assert.equal(retried.items.filter((item) => item.name === "Legate").length, 1);
  });

  it("coalesces Davi's Psychic and Wild Talent aliases into one Focus pool", () => {
    const migrated = migrateActorData(legacyPc({
      className: "Gladiator",
      classes: { Psychic: { max: 1 }, "Wild Talent": { max: 1 } },
      items: [legacyArt("Personal Apportation", {
        source: "Wild Talent",
        time: "Scene",
        effort: 0,
      })],
    }));
    assert.equal(migrated.items.filter((item) => item.name === "Wild Psychic Talent").length, 1);
    assert.equal(
      migrated.items.find((item) => item.type === "power").system.resourceName,
      "Psychic Effort",
    );
  });

  it("grants the house-rule Focus to every mapped non-Psychic Dark Sun class", () => {
    const classNames = [
      "Ranger (Warrior/Beastmaster)",
      "Gladiator",
      "Fighter (Warrior)",
      "Sorcerer (High Mage)",
      "Elemental Cleric",
      "Elemental Monk",
      "Thief",
    ];
    for (const className of classNames) {
      const migrated = migrateActorData(legacyPc({ className }));
      assert.equal(
        migrated.items.filter((item) => item.name === "Wild Psychic Talent").length,
        1,
        className,
      );
    }
  });

  it("does not give Wild Psychic Talent to primary Psychic classes", () => {
    for (const className of ["Psychic Warrior", "Psionicist (Psychic)"]) {
      const migrated = migrateActorData(legacyPc({
        className,
        classes: { Psychic: { max: 7 } },
        items: [legacyArt("Spatial Awareness", {
          source: "Psychic",
          time: "Committed",
          effort: 1,
        })],
      }));
      assert.equal(
        migrated.items.some((item) => item.name === "Wild Psychic Talent"),
        false,
        className,
      );
    }
  });
});

describe("legacy spell-slot migration", () => {
  it("converts leveled remaining casts into spent day commitments", () => {
    const migrated = migrateSpellToPower(
      legacySpell("Prepared Spell", { memorized: 3, cast: 1, level: 2 }),
    );
    assert.equal(migrated.system.poolCommitted.day, 2);
    assert.deepEqual(migrated.system.internalResource, { value: 0, max: 0 });
  });

  it("preserves M'uamba's two actor-level used slots across prepared spells", () => {
    const migrated = migrateActorData(
      legacyPc({
        perDay: { value: 2, max: 6 },
        items: [
          legacySpell("unprepared", { prepared: false }),
          legacySpell("prepared-a"),
          legacySpell("prepared-b"),
        ],
      }),
    );
    const spells = migrated.items.filter((item) => item.system?.subType === "spell");
    assert.deepEqual(
      Object.fromEntries(spells.map((spell) => [spell._id, spell.system.poolCommitted.day])),
      { unprepared: 0, "prepared-a": 1, "prepared-b": 1 },
    );
    assert.equal(
      spells.reduce((sum, spell) => sum + spell.system.poolCommitted.day, 0),
      2,
    );

    const secondPass = migrateActorData({
      type: "character",
      system: migrated.system,
      items: migrated.items,
      effects: migrated.effects,
    });
    assert.equal(
      secondPass.items
        .filter((item) => item.system?.subType === "spell")
        .reduce((sum, spell) => sum + spell.system.poolCommitted.day, 0),
      2,
    );
  });

  it("retains actor-level spend after Actor.migrateData's preliminary item pass", () => {
    const source = legacyPc({
      perDay: { value: 2, max: 6 },
      items: [legacySpell("prepared-a"), legacySpell("prepared-b")],
    });
    source.items = migrateActorItems(source.items);

    const migrated = migrateActorData(source);
    assert.equal(
      migrated.items
        .filter((item) => item.system?.subType === "spell")
        .reduce((sum, spell) => sum + spell.system.poolCommitted.day, 0),
      2,
    );
  });

  it("does not overwrite already-modern powers in a mixed actor inventory", () => {
    const modern = {
      _id: "modern",
      type: "power",
      system: {
        subType: "spell",
        prepared: true,
        poolCommitted: { none: 0, active: 0, scene: 0, day: 3 },
      },
    };
    const legacy = migrateSpellToPower(legacySpell("legacy"));
    const migrated = applyLegacyUnleveledSpellSpend(
      [modern, legacy],
      { leveledSlots: false, perDay: { value: 1 } },
      new Set(["legacy"]),
    );
    assert.equal(migrated[0], modern);
    assert.equal(migrated[0].system.poolCommitted.day, 3);
    assert.equal(migrated[1].system.poolCommitted.day, 1);
  });

  it("surfaces persisted Effort and slots after delayed classEdge assignment", () => {
    const migrated = migrateActorData(
      legacyPc({
        perDay: { value: 2, max: 6 },
        items: [
          legacyArt("Ward Allies", { source: "High Mage", time: "Day", effort: 1 }),
          legacySpell("spell-a"),
          legacySpell("spell-b"),
        ],
      }),
    );
    const powers = migrated.items
      .filter((item) => item.type === "power")
      .map(runtimePower);

    const beforeAssignment = runtimeActor(powers);
    deriveResourcePools(beforeAssignment);
    assert.deepEqual(beforeAssignment.system.resourcePools, []);

    const afterAssignment = runtimeActor([...powers, highMageEdge]);
    deriveResourcePools(afterAssignment);
    const effort = afterAssignment.system.resourcePools.find(
      (pool) => pool.name === "High Mage Effort",
    );
    const slots = afterAssignment.system.resourcePools.find(
      (pool) => pool.name === "Spell Slots" && pool.level == null,
    );
    assert.deepEqual(
      { value: effort?.value, max: effort?.max },
      { value: 1, max: 4 },
    );
    assert.deepEqual(
      { value: slots?.value, max: slots?.max },
      { value: 2, max: 6 },
    );
  });
});
