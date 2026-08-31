/** Release migration persistence after Foundry's in-memory migrateData pass. */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actorMigrationPersistencePlan,
  clearEmbeddedItems,
  migrateActorDocument,
  migrateWorldItem,
  replaceEmbeddedItemsSafely,
} from "../module/migration/migrate.mjs";
import { embeddedItemsNeedReplace } from "../module/migration/embedded-items.mjs";
import { migrateActorData } from "../module/migration/transforms.mjs";

foundry.data ??= {};
foundry.data.operators ??= {};
foundry.data.operators.ForcedReplacement = {
  create: (value) => ({ operator: "replace", value }),
};

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

  it("persists currency Items synthesized during the pre-ready migration", async () => {
    const legacy = legacyDarkSunActor();
    const loaded = migrateActorData(legacy);
    const transientIds = ["transient-bits", "transient-ceramics"];
    let transientIndex = 0;
    let liveItems = loaded.items.map((item) => {
      if (item._id) return structuredClone(item);
      return {
        ...structuredClone(item),
        _id: transientIds[transientIndex++],
        _stats: { createdTime: null },
      };
    });
    // Only the v13 inventory is actually stored. The currency Documents above
    // exist solely in the v14 client's pre-ready collection.
    let databaseItems = structuredClone(legacy.items);
    const actor = {
      id: "actor-1",
      name: "Loaded PC",
      isToken: false,
      get items() {
        return {
          size: liveItems.length,
          invalidDocumentIds: new Set(),
        };
      },
      toObject: () => ({ items: structuredClone(liveItems) }),
      update: async (changes) => {
        assert.deepEqual(changes.items, { operator: "replace", value: [] });
        liveItems = [];
      },
      deleteEmbeddedDocuments: async (_name, _ids, options) => {
        assert.equal(options.deleteAll, true);
        assert.equal(liveItems.length, 0, "deleteAll must not inspect transient IDs");
        databaseItems = [];
      },
      createEmbeddedDocuments: async (_name, items, options) => {
        assert.equal(options.keepId, true);
        databaseItems = structuredClone(items);
        liveItems = structuredClone(items);
        return items;
      },
    };

    await replaceEmbeddedItemsSafely(actor, liveItems);

    assert.deepEqual(
      databaseItems
        .filter((item) => item.type === "currency")
        .map((item) => ({ id: item._id, name: item.name, ...item.system })),
      [
        {
          id: "transient-bits",
          name: "Bits",
          multiplier: 1,
          perSlot: 100,
          carried: 9,
          banked: 5,
        },
        {
          id: "transient-ceramics",
          name: "Ceramic Pieces",
          multiplier: 10,
          perSlot: 100,
          carried: 2,
          banked: 0,
        },
      ]
    );
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

  it("creates a pre-ready legacy Tweaks effect instead of updating its transient id", async () => {
    foundry.data ??= {};
    foundry.data.operators ??= {};
    foundry.data.operators.ForcedReplacement = {
      create: (value) => ({ operator: "replace", value }),
    };

    const transientEffect = {
      _id: "transient-effect",
      _key: "!actors.effects!actor-1.transient-effect",
      _stats: { createdTime: null },
      name: "Migrated: WWN Tweaks",
      img: "icons/svg/upgrade.svg",
      flags: { wwn: { migrationGenerated: "legacyTweaks" } },
      system: {
        changes: [
          {
            key: "system.abilities.dex.baseMod",
            type: "add",
            value: 1,
            phase: "initial",
            priority: null,
          },
        ],
      },
    };
    const raw = {
      _id: "actor-1",
      name: "Loaded PC",
      type: "character",
      system: { details: { level: 1 }, combat: { abMod: 0 } },
      items: [],
      effects: [transientEffect],
    };
    const created = [];
    const updated = [];
    const actor = {
      type: raw.type,
      name: raw.name,
      system: raw.system,
      img: undefined,
      _source: { effects: structuredClone(raw.effects) },
      items: { size: 0, invalidDocumentIds: new Set() },
      effects: { size: 1 },
      toObject: () => structuredClone(raw),
      update: async () => {},
      updateEmbeddedDocuments: async (...args) => updated.push(args),
      createEmbeddedDocuments: async (...args) => created.push(args),
    };

    await migrateActorDocument(actor, { forcePersist: true, persistItems: false });

    assert.equal(updated.length, 0);
    assert.equal(created.length, 1);
    assert.equal(created[0][0], "ActiveEffect");
    assert.equal(created[0][1].length, 1);
    assert.equal(Object.hasOwn(created[0][1][0], "_id"), false);
    assert.equal(Object.hasOwn(created[0][1][0], "_key"), false);
    assert.equal(Object.hasOwn(created[0][1][0], "_stats"), false);
    assert.equal(created[0][2].wwnMigrating, true);
  });

  it("keeps the legacy system intact when creating its Tweaks effect fails", async () => {
    foundry.data ??= {};
    foundry.data.operators ??= {};
    foundry.data.operators.ForcedReplacement = {
      create: (value) => ({ operator: "replace", value }),
    };

    const transientEffect = {
      _id: "transient-effect",
      _key: "!actors.effects!actor-1.transient-effect",
      _stats: { createdTime: null },
      name: "Migrated: WWN Tweaks",
      img: "icons/svg/upgrade.svg",
      flags: { wwn: { migrationGenerated: "legacyTweaks" } },
      system: {
        changes: [
          {
            key: "system.abilities.dex.baseMod",
            type: "add",
            value: 1,
            phase: "initial",
            priority: null,
          },
        ],
      },
    };
    const raw = {
      _id: "actor-1",
      name: "Loaded PC",
      type: "character",
      system: { details: { level: 1 }, combat: { abMod: 0 } },
      items: [],
      effects: [transientEffect],
    };
    let systemUpdates = 0;
    const actor = {
      type: raw.type,
      name: raw.name,
      system: raw.system,
      img: undefined,
      _source: { effects: structuredClone(raw.effects) },
      items: { size: 0, invalidDocumentIds: new Set() },
      effects: { size: 1 },
      toObject: () => structuredClone(raw),
      update: async () => { systemUpdates++; },
      updateEmbeddedDocuments: async () => {},
      createEmbeddedDocuments: async () => {
        throw new Error("effect create failed");
      },
    };

    await assert.rejects(
      migrateActorDocument(actor, { forcePersist: true, persistItems: false }),
      /effect create failed/
    );
    assert.equal(systemUpdates, 0);
  });

  it("does not recreate or update a persisted generated Tweaks effect on retry", async () => {
    foundry.data ??= {};
    foundry.data.operators ??= {};
    foundry.data.operators.ForcedReplacement = {
      create: (value) => ({ operator: "replace", value }),
    };

    const persistedEffect = {
      _id: "persisted-effect",
      _key: "!actors.effects!actor-1.persisted-effect",
      _stats: { createdTime: 1788200000000 },
      name: "Migrated: WWN Tweaks",
      img: "icons/svg/upgrade.svg",
      flags: { wwn: { migrationGenerated: "legacyTweaks" } },
      system: {
        changes: [
          {
            key: "system.abilities.dex.baseMod",
            type: "add",
            value: 1,
            phase: "initial",
            priority: null,
          },
        ],
      },
    };
    const raw = {
      _id: "actor-1",
      name: "Loaded PC",
      type: "character",
      system: { details: { level: 1 }, combat: { abMod: 0 } },
      items: [],
      effects: [persistedEffect],
    };
    const created = [];
    const updated = [];
    const actor = {
      type: raw.type,
      name: raw.name,
      system: raw.system,
      img: undefined,
      _source: { effects: structuredClone(raw.effects) },
      items: { size: 0, invalidDocumentIds: new Set() },
      effects: { size: 1 },
      toObject: () => structuredClone(raw),
      update: async () => {},
      updateEmbeddedDocuments: async (...args) => updated.push(args),
      createEmbeddedDocuments: async (...args) => created.push(args),
    };

    await migrateActorDocument(actor, { forcePersist: true, persistItems: false });

    assert.equal(updated.length, 0);
    assert.equal(created.length, 0);
  });

  it("clears transient live items before the database delete-all operation", async () => {
    const events = [];
    const actor = {
      isToken: false,
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({
        items: [
          {
            _id: "transient-currency",
            type: "currency",
            _stats: { createdTime: null },
          },
        ],
      }),
      update: async (changes, options) => {
        events.push({ kind: "update", changes, options });
      },
      deleteEmbeddedDocuments: async (name, ids, options) => {
        events.push({ kind: "delete", name, ids, options });
      },
    };

    await clearEmbeddedItems(actor);

    assert.deepEqual(events[0], {
      kind: "update",
      changes: { items: { operator: "replace", value: [] } },
      options: { enforceTypes: false, diff: false, wwnMigrating: true },
    });
    assert.deepEqual(events[1], {
      kind: "delete",
      name: "Item",
      ids: [],
      options: { deleteAll: true, wwnMigrating: true },
    });
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
