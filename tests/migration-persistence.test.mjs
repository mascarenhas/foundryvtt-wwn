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

function legacyCurrencyPersistenceActor() {
  const actor = legacyDarkSunActor();
  actor.items = [
    {
      _id: "asset-1",
      name: "Persisted Asset",
      type: "asset",
      _stats: { createdTime: null },
      effects: [],
      system: {},
    },
  ];
  return actor;
}

/**
 * Model Foundry's already-migrated client source separately from durable Actor
 * system and embedded-Item rows. This makes transaction ordering and rollback
 * assertions meaningful rather than mutating one shared mock array.
 */
function migrationPersistenceHarness({
  storedSystem,
  storedItems,
  failCreateAttempts = new Set(),
  failSystemUpdateAttempts = new Set(),
} = {}) {
  const legacy = legacyCurrencyPersistenceActor();
  let databaseSystem = structuredClone(storedSystem ?? legacy.system);
  let databaseItems = structuredClone(storedItems ?? legacy.items);
  const loaded = migrateActorData({
    ...structuredClone(legacy),
    system: structuredClone(databaseSystem),
    items: structuredClone(databaseItems),
  });
  let transientIndex = 0;
  let liveItems = (loaded.items ?? databaseItems).map((item) => {
    if (item._id) return structuredClone(item);
    transientIndex += 1;
    return {
      ...structuredClone(item),
      _id: `transient-${transientIndex}`,
      _key: `!actors.items!actor-1.transient-${transientIndex}`,
      _stats: { createdTime: null },
    };
  });
  const events = [];
  let createAttempt = 0;
  let systemUpdateAttempt = 0;

  const actor = {
    id: "actor-1",
    name: legacy.name,
    type: legacy.type,
    img: undefined,
    system: structuredClone(loaded.system ?? databaseSystem),
    effects: { size: 0 },
    get items() {
      liveItems.size = liveItems.length;
      liveItems.invalidDocumentIds = new Set();
      return liveItems;
    },
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        system: structuredClone(this.system),
        items: structuredClone(liveItems),
        effects: [],
      };
    },
    updateSource(changes) {
      events.push({ kind: "updateSource", changes: structuredClone(changes) });
      if (changes.items?.operator === "replace") liveItems = [];
    },
    async deleteEmbeddedDocuments(documentName, ids, options) {
      events.push({ kind: "itemDelete", documentName, ids: [...ids], options });
      const databaseIds = new Set(databaseItems.map((item) => item._id));
      for (const id of ids) {
        assert.equal(databaseIds.has(id), true, `database must contain ${id}`);
      }
      databaseItems = databaseItems.filter((item) => !ids.includes(item._id));
      liveItems = liveItems.filter((item) => !ids.includes(item._id));
    },
    async createEmbeddedDocuments(documentName, items, options) {
      assert.equal(documentName, "Item");
      createAttempt += 1;
      events.push({
        kind: "itemCreate",
        ids: items.map((item) => item._id ?? null),
        names: items.map((item) => item.name),
        hasStats: items.map((item) => Object.hasOwn(item, "_stats")),
        hasKeys: items.map((item) => Object.hasOwn(item, "_key")),
        migrationPersisted: items.map(
          (item) => item.flags?.wwn?.migrationPersisted ?? null
        ),
        options,
      });
      if (failCreateAttempts.has(createAttempt)) {
        throw new Error(`item create failed on attempt ${createAttempt}`);
      }
      const existingIds = new Set(databaseItems.map((item) => item._id));
      const created = items.map((source, index) => {
        const id = source._id ?? `created-${createAttempt}-${index}`;
        assert.equal(existingIds.has(id), false, `create id ${id} must be free`);
        existingIds.add(id);
        const created = {
          ...structuredClone(source),
          _id: id,
        };
        // Foundry stamps newly created rows only when migration does not replay
        // an ephemeral pre-ready statistics object.
        if (!Object.hasOwn(source, "_stats")) {
          created._stats = { createdTime: 1000 + createAttempt };
        }
        return created;
      });
      databaseItems.push(...structuredClone(created));
      liveItems.push(...structuredClone(created));
      return created;
    },
    async update(changes, options) {
      systemUpdateAttempt += 1;
      events.push({
        kind: "actorUpdate",
        changes: structuredClone(changes),
        options,
      });
      if (failSystemUpdateAttempts.has(systemUpdateAttempt)) {
        throw new Error(`system update failed on attempt ${systemUpdateAttempt}`);
      }
      const replacement = changes.system?.operator === "replace"
        ? changes.system.value
        : changes.system;
      if (replacement != null) {
        databaseSystem = structuredClone(replacement);
        this.system = structuredClone(replacement);
      }
    },
  };

  return {
    actor,
    events,
    snapshot: () => ({
      databaseSystem: structuredClone(databaseSystem),
      databaseItems: structuredClone(databaseItems),
      liveItems: structuredClone(liveItems),
    }),
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
      update: async () => assert.fail("item clear must not round-trip through Actor.update"),
      updateSource: (changes) => {
        assert.deepEqual(changes.items, { operator: "replace", value: [] });
        liveItems = [];
      },
      deleteEmbeddedDocuments: async (_name, ids, options) => {
        assert.deepEqual(ids, ["weapon-1", "art-1"]);
        assert.deepEqual(options, { wwnMigrating: true });
        assert.equal(liveItems.length, 4, "explicit deletion runs before the local clear");
        databaseItems = databaseItems.filter((item) => !ids.includes(item._id));
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

  it("keeps the legacy system and restores only persisted Items when item creation fails", async () => {
    const harness = migrationPersistenceHarness({
      failCreateAttempts: new Set([1]),
    });

    await assert.rejects(
      migrateActorDocument(harness.actor, { forcePersist: true }),
      /item create failed on attempt 1/,
    );

    const actorUpdates = harness.events.filter((event) => event.kind === "actorUpdate");
    const creates = harness.events.filter((event) => event.kind === "itemCreate");
    const state = harness.snapshot();

    assert.equal(actorUpdates.length, 0, "Actor system persistence must wait for Items");
    assert.equal(creates.length, 2, "the failed replacement must make one bounded restore attempt");
    assert.deepEqual(creates[0].names, ["Persisted Asset", "Bits", "Ceramic Pieces"]);
    assert.deepEqual(creates[0].hasStats, [true, false, false]);
    assert.deepEqual(creates[0].hasKeys, [false, false, false]);
    assert.deepEqual(creates[0].migrationPersisted, [null, true, true]);
    assert.deepEqual(creates[1].names, ["Persisted Asset"]);
    assert.deepEqual(state.databaseItems.map((item) => item._id), ["asset-1"]);
    assert.ok(state.databaseSystem.scores, "the durable Actor system must remain legacy");

    // A reload still has the legacy currency source fields and therefore can
    // synthesize the currency Items again on a clean retry.
    const reloaded = migrateActorData({
      ...legacyCurrencyPersistenceActor(),
      system: state.databaseSystem,
      items: state.databaseItems,
    });
    assert.equal(reloaded.items.filter((item) => item.type === "currency").length, 2);
  });

  it("rolls Items back after an Actor update failure and succeeds on a fresh retry", async () => {
    const first = migrationPersistenceHarness({
      failSystemUpdateAttempts: new Set([1]),
    });

    await assert.rejects(
      migrateActorDocument(first.actor, { forcePersist: true }),
      /system update failed on attempt 1/,
    );

    const firstCreates = first.events.filter((event) => event.kind === "itemCreate");
    const firstDeletes = first.events.filter((event) => event.kind === "itemDelete");
    const firstUpdates = first.events.filter((event) => event.kind === "actorUpdate");
    const recovered = first.snapshot();

    assert.equal(firstUpdates.length, 1);
    assert.equal(firstCreates.length, 2, "system failure must trigger one Item rollback create");
    assert.deepEqual(firstDeletes[0].ids, ["asset-1"]);
    assert.deepEqual(
      firstDeletes[1].ids,
      ["asset-1", "transient-1", "transient-2"],
      "server-stamped generated rows must be classified as persisted during rollback",
    );
    assert.deepEqual(firstCreates[0].hasStats, [true, false, false]);
    assert.deepEqual(firstCreates[0].hasKeys, [false, false, false]);
    assert.deepEqual(firstCreates[0].migrationPersisted, [null, true, true]);
    assert.deepEqual(firstCreates[1].names, ["Persisted Asset"]);
    assert.deepEqual(recovered.databaseItems.map((item) => item._id), ["asset-1"]);
    assert.ok(recovered.databaseSystem.scores, "failed Actor update must leave legacy system data");

    const retry = migrationPersistenceHarness({
      storedSystem: recovered.databaseSystem,
      storedItems: recovered.databaseItems,
    });
    await migrateActorDocument(retry.actor, { forcePersist: true });

    const final = retry.snapshot();
    const retryCreateIndex = retry.events.findIndex((event) => event.kind === "itemCreate");
    const retryUpdateIndex = retry.events.findIndex((event) => event.kind === "actorUpdate");
    assert.ok(retryCreateIndex >= 0 && retryCreateIndex < retryUpdateIndex);
    assert.equal(Object.hasOwn(final.databaseSystem, "scores"), false);
    assert.equal(final.databaseItems.filter((item) => item.type === "currency").length, 2);
  });

  it("keeps the Actor update error primary when the bounded Item rollback also fails", async () => {
    const harness = migrationPersistenceHarness({
      failCreateAttempts: new Set([2, 3]),
      failSystemUpdateAttempts: new Set([1]),
    });

    await assert.rejects(
      migrateActorDocument(harness.actor, { forcePersist: true }),
      /system update failed on attempt 1/,
    );

    assert.equal(
      harness.events.filter((event) => event.kind === "actorUpdate").length,
      1,
    );
    assert.equal(
      harness.events.filter((event) => event.kind === "itemCreate").length,
      3,
      "rollback and its safety restore must each be attempted at most once",
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

  it("clears a known pre-ready generated Item without sending its transient id", async () => {
    const events = [];
    const actor = {
      isToken: false,
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({
        items: [
          {
            _id: "transient-currency",
            type: "currency",
            flags: { wwn: { migrationGenerated: "legacyCurrency" } },
            _stats: { createdTime: null },
          },
        ],
      }),
      update: async () => assert.fail("item clear must not round-trip through Actor.update"),
      updateSource: (changes) => {
        events.push({ kind: "updateSource", changes });
      },
      deleteEmbeddedDocuments: async () => assert.fail("transient id must not reach the database"),
    };

    await clearEmbeddedItems(actor);

    assert.deepEqual(events[0], {
      kind: "updateSource",
      changes: { items: { operator: "replace", value: [] } },
    });
    assert.equal(events.length, 1);
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
