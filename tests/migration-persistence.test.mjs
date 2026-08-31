/** Release migration persistence after Foundry's in-memory migrateData pass. */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actorMigrationPersistencePlan,
  clearEmbeddedItems,
  migrateActorDocument,
  migrateWorldItem,
} from "../module/migration/migrate.mjs";
import { embeddedItemsNeedReplace } from "../module/migration/embedded-items.mjs";
import { migrateActorData } from "../module/migration/transforms.mjs";

function legacyDarkSunActor() {
  return {
    type: "character",
    name: "Mhuamba",
    system: {
      scores: Object.fromEntries(
        ["str", "dex", "con", "int", "wis", "cha"].map((key) => [key, { value: 10 }])
      ),
      hp: { value: 4, max: 4, hd: "1d6" },
      details: { level: 1 },
      thac0: { bba: 0 },
      skills: {},
      saves: {},
      aac: {},
      initiative: {},
      movement: { base: 30 },
      currency: { sp: 9, ep: 2, bank: 5 },
    },
    items: [
      {
        _id: "weapon-1",
        name: "Sorcerous Blast",
        type: "weapon",
        system: { art: "Sorcerous Blast", skill: "Magic", damage: "1d6" },
      },
      {
        _id: "art-1",
        name: "Sorcerous Blast",
        type: "art",
        system: { source: "Elementalist", time: "Scene", effort: 1 },
      },
    ],
    effects: [],
  };
}

describe("forced release migration persistence", () => {
  it("writes already-migrated Dark Sun currency and weapon-Art sources", () => {
    const legacy = legacyDarkSunActor();

    // Foundry calls Actor.migrateData while loading, so the live document is
    // already canonical even though the stored database row is still legacy.
    const loaded = migrateActorData(legacy);
    const liveSource = {
      type: legacy.type,
      name: legacy.name,
      system: loaded.system,
      items: loaded.items,
      effects: loaded.effects,
    };
    const secondPass = migrateActorData(liveSource);

    assert.equal(secondPass.system, null);
    assert.equal(embeddedItemsNeedReplace(liveSource.items, secondPass.items), false);

    const ordinary = actorMigrationPersistencePlan({
      rawSystem: liveSource.system,
      result: secondPass,
      itemsChanged: false,
    });
    assert.deepEqual(ordinary, {
      shouldPersist: false,
      system: null,
      effects: [],
      items: null,
    });

    const forced = actorMigrationPersistencePlan({
      forcePersist: true,
      rawSystem: liveSource.system,
      result: secondPass,
      itemsChanged: false,
    });
    assert.equal(forced.shouldPersist, true);
    assert.equal(forced.system, liveSource.system);
    assert.equal(forced.items, secondPass.items);

    assert.deepEqual(
      forced.items
        .filter((item) => item.type === "currency")
        .map(({ name, system }) => ({ name, ...system })),
      [
        { name: "Bits", multiplier: 1, perSlot: 100, carried: 9, banked: 5 },
        { name: "Ceramic Pieces", multiplier: 10, perSlot: 100, carried: 2, banked: 0 },
      ]
    );
    const weapon = forced.items.find((item) => item._id === "weapon-1");
    const art = forced.items.find((item) => item._id === "art-1");
    assert.equal(art.type, "power");
    assert.equal(art.system.subType, "art");
    assert.equal(weapon.system.artId, "art-1");
    assert.equal(weapon.system.artFallback, "Sorcerous Blast");
  });

  it("uses ForcedReplacement without also requesting a non-recursive actor update", async () => {
    foundry.data ??= {};
    foundry.data.operators ??= {};
    foundry.data.operators.ForcedReplacement = {
      create: (value) => ({ operator: "replace", value }),
    };

    const updates = [];
    const raw = {
      _id: "actor-1",
      name: "Loaded PC",
      type: "character",
      system: { details: { level: 1 }, combat: { abMod: 0 } },
      items: [],
      effects: [],
    };
    const actor = {
      type: raw.type,
      name: raw.name,
      system: raw.system,
      img: undefined,
      items: { size: 0, invalidDocumentIds: new Set() },
      effects: { size: 0 },
      toObject: () => structuredClone(raw),
      update: async (changes, options) => updates.push({ changes, options }),
    };

    await migrateActorDocument(actor, { forcePersist: true });

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].changes.system, {
      operator: "replace",
      value: raw.system,
    });
    assert.equal(Object.hasOwn(updates[0].options, "recursive"), false);
    assert.equal(updates[0].options.wwnMigrating, true);
  });

  it("clears embedded items with one replacement operator", async () => {
    foundry.data ??= {};
    foundry.data.operators ??= {};
    foundry.data.operators.ForcedReplacement = {
      create: (value) => ({ operator: "replace", value }),
    };

    let update;
    const actor = {
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({ items: [{ _id: "item-1" }] }),
      update: async (changes, options) => { update = { changes, options }; },
    };

    await clearEmbeddedItems(actor);

    assert.deepEqual(update.changes.items, { operator: "replace", value: [] });
    assert.equal(Object.hasOwn(update.options, "recursive"), false);
  });

  it("recursively merges partial world-item migration patches", async () => {
    let update;
    const raw = {
      _id: "power-1",
      name: "Legacy Power",
      type: "power",
      system: {
        description: "must survive",
        internalResourceLength: "active",
      },
    };
    const item = {
      id: raw._id,
      name: raw.name,
      type: raw.type,
      getFlag: () => false,
      toObject: () => structuredClone(raw),
      update: async (changes, options) => { update = { changes, options }; },
    };

    await migrateWorldItem(item);

    assert.deepEqual(update.changes, {
      system: { internalResourceLength: "scene" },
    });
    assert.equal(Object.hasOwn(update.changes.system, "description"), false);
    assert.equal(Object.hasOwn(update.options, "recursive"), false);
    assert.equal(update.options.wwnMigrating, true);
  });

  it("keeps exact replacement semantics for full world-item transforms", async () => {
    let update;
    const raw = {
      _id: "focus-1",
      name: "Developed Attribute",
      type: "focus",
      system: { ownedLevel: 1 },
      effects: [
        {
          _id: "str-effect",
          name: "Developed Attribute (Strength)",
          disabled: true,
          system: {
            changes: [
              { key: "system.abilities.str.baseMod", type: "add", value: 1, phase: "initial" },
            ],
          },
        },
        {
          _id: "wis-effect",
          name: "Developed Attribute (Wisdom)",
          disabled: false,
          system: {
            changes: [
              { key: "system.abilities.wis.baseMod", type: "add", value: 1, phase: "initial" },
            ],
          },
        },
      ],
    };
    const item = {
      id: raw._id,
      name: raw.name,
      type: raw.type,
      getFlag: () => false,
      toObject: () => structuredClone(raw),
      update: async (changes, options) => { update = { changes, options }; },
    };

    await migrateWorldItem(item);

    assert.equal(update.options.recursive, false);
    assert.equal(update.changes.name, "Developed Attribute (Wisdom)");
    assert.equal(update.changes.effects.length, 1);
    assert.equal(update.changes.effects[0]._id, "wis-effect");
  });
});
