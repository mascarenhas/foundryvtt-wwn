/** Foundry v14 ActorDelta-safe migration persistence contracts. */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildActorDeltaItemMigration,
  clearEmbeddedItems,
  migrateUnlinkedToken,
  replaceEmbeddedItemsSafely,
} from "../module/migration/migrate.mjs";
import { migrateActorItems } from "../module/migration/transforms.mjs";

foundry.data ??= {};
foundry.data.operators ??= {};
foundry.data.operators.ForcedReplacement = {
  create: (value) => ({ operator: "replace", value }),
};

describe("Foundry v14 embedded-item migration persistence", () => {
  it("deletes explicit persisted Actor item ids before clearing the local source", async () => {
    const calls = [];
    const actor = {
      isToken: false,
      items: { size: 1, invalidDocumentIds: new Set() },
      // Old imported rows commonly have no creation timestamp despite being
      // real database documents.
      toObject: () => ({ items: [{ _id: "item-1", _stats: { createdTime: null } }] }),
      update: async () => assert.fail("clearEmbeddedItems must not persist Actor.items"),
      updateSource: (changes) => {
        calls.push({ kind: "updateSource", changes });
      },
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        calls.push({ kind: "delete", documentName, ids, options });
      },
    };

    await clearEmbeddedItems(actor);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {
      kind: "delete",
      documentName: "Item",
      ids: ["item-1"],
      options: { wwnMigrating: true },
    });
    assert.deepEqual(calls[1], {
      kind: "updateSource",
      changes: { items: { operator: "replace", value: [] } },
    });
  });

  it("excludes only known pre-ready Items while deleting persisted rows", async () => {
    let liveItems = [
      { _id: "persisted-weapon", type: "weapon", _stats: { createdTime: null } },
      {
        _id: "transient-currency",
        type: "currency",
        flags: { wwn: { migrationGenerated: "legacyCurrency" } },
        _stats: { createdTime: null },
      },
      {
        _id: "transient-wild-focus",
        type: "focus",
        flags: { wwn: { migrationGenerated: "darkSunWildPsychicTalent" } },
        _stats: { createdTime: null },
      },
      {
        _id: "transient-legate-edge",
        type: "classEdge",
        flags: { wwn: { migrationGenerated: "legacyLegateEffort" } },
        _stats: { createdTime: null },
      },
      {
        _id: "persisted-wild-focus",
        type: "focus",
        flags: { wwn: { migrationGenerated: "darkSunWildPsychicTalent" } },
        _stats: { createdTime: 1234 },
      },
      {
        _id: "persisted-legate-edge",
        type: "classEdge",
        flags: {
          wwn: {
            migrationGenerated: "legacyLegateEffort",
            migrationPersisted: true,
          },
        },
        _stats: { createdTime: null },
      },
    ];
    const serverIds = new Set([
      "persisted-weapon",
      "persisted-wild-focus",
      "persisted-legate-edge",
    ]);
    const calls = [];
    const actor = {
      isToken: false,
      get items() {
        liveItems.invalidDocumentIds = new Set();
        return liveItems;
      },
      toObject: () => ({ items: structuredClone(liveItems) }),
      update: async () => assert.fail("a database update would send transient currency IDs"),
      updateSource: (changes) => {
        assert.deepEqual(changes.items, { operator: "replace", value: [] });
        calls.push({ kind: "updateSource" });
        liveItems = [];
      },
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        calls.push({ kind: "delete", documentName, ids: [...ids], options });
        assert.equal(liveItems.length, 6, "explicit deletion runs against the intact collection");
        for (const id of ids) {
          assert.equal(serverIds.delete(id), true, `server must contain persisted id ${id}`);
        }
      },
    };

    await clearEmbeddedItems(actor);

    assert.deepEqual(calls, [
      {
        kind: "delete",
        documentName: "Item",
        ids: ["persisted-weapon", "persisted-wild-focus", "persisted-legate-edge"],
        options: { wwnMigrating: true },
      },
      { kind: "updateSource" },
    ]);
    assert.deepEqual([...serverIds], []);
    assert.equal(liveItems.length, 0);
  });

  it("retains persistence stats while canonicalizing a generated migration Item", () => {
    const stats = { createdTime: 1234, modifiedTime: 5678 };
    const [migrated] = migrateActorItems([
      {
        _id: "persisted-wild-focus",
        name: "Wild Psychic Talent",
        type: "focus",
        flags: { wwn: { migrationGenerated: "darkSunWildPsychicTalent" } },
        _stats: stats,
        effects: [],
        system: { ownedLevel: 1 },
      },
    ]);

    assert.deepEqual(migrated._stats, stats);
  });

  it("rejects attempts to clear an unlinked Token's synthetic Actor", async () => {
    let deleted = false;
    const actor = {
      isToken: true,
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({ items: [{ _id: "delta-item" }] }),
      updateSource: () => assert.fail("synthetic token actor source must remain untouched"),
      deleteEmbeddedDocuments: async () => { deleted = true; },
    };

    await assert.rejects(
      clearEmbeddedItems(actor),
      /synthetic|token/i,
    );
    assert.equal(deleted, false);
  });

  it("still clears locally when there are no persisted item ids", async () => {
    const calls = [];
    const actor = {
      isToken: false,
      items: { size: 0, invalidDocumentIds: new Set() },
      toObject: () => ({ items: [] }),
      update: async () => assert.fail("clearEmbeddedItems must not persist Actor.items"),
      updateSource: (changes) => {
        calls.push({ kind: "updateSource", changes });
      },
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        calls.push({ kind: "delete", documentName, ids, options });
      },
    };

    await clearEmbeddedItems(actor);

    assert.deepEqual(calls, [
      {
        kind: "updateSource",
        changes: { items: { operator: "replace", value: [] } },
      },
    ]);
  });

  it("omits delta-owned Items that the migration intentionally retires", () => {
    const retiredArmor = {
      _id: "retired-armor",
      name: "Cold Flesh",
      type: "armor",
      effects: [],
      system: { aac: 13 },
    };

    assert.deepEqual(
      buildActorDeltaItemMigration([retiredArmor], [retiredArmor]),
      [],
    );
  });

  it("writes only ActorDelta-owned items and preserves tombstones", async () => {
    const inheritedBaseItem = {
      _id: "base-only",
      name: "Inherited Base Item",
      type: "asset",
      system: {},
    };
    const legacyDeltaArt = {
      _id: "delta-art",
      name: "Sorcerous Blast",
      type: "art",
      img: "icons/svg/aura.svg",
      sort: 10,
      flags: { wwn: { campaign: "dark-sun" } },
      effects: [],
      system: {
        description: "A blast of raw sorcery.",
        source: "Elementalist",
        time: "Scene",
        effort: 1,
      },
    };
    const linkedDeltaWeapon = {
      _id: "delta-weapon",
      name: "Sorcerous Blast",
      type: "weapon",
      effects: [],
      system: {
        art: "Sorcerous Blast",
        skill: "Magic",
        damage: "1d6",
      },
    };
    const legacyDeltaAbility = {
      _id: "delta-ability",
      name: "Slime Spray",
      type: "ability",
      effects: [],
      system: {
        description: "Spray corrosive slime.",
        roll: "1d20",
        rollType: "result",
        rollTarget: 12,
      },
    };
    const tombstone = {
      _id: "removed-base-item",
      _tombstone: true,
      _key: "ActorDelta.token-delta.items.removed-base-item",
      flags: { wwn: { reason: "removed" } },
    };
    const effectiveItems = [
      inheritedBaseItem,
      legacyDeltaArt,
      linkedDeltaWeapon,
      legacyDeltaAbility,
    ];
    // Use an Array with the collection properties touched by actor migration.
    effectiveItems.size = effectiveItems.length;
    effectiveItems.invalidDocumentIds = new Set();

    const actorSource = {
      _id: "synthetic-actor",
      name: "Delta Beast",
      type: "monster",
      system: {
        hp: { value: 8, max: 8 },
        hd: "1d8",
        favorites: [],
      },
      items: effectiveItems,
      effects: [],
    };
    const actorUpdates = [];
    const actor = {
      id: actorSource._id,
      name: actorSource.name,
      type: actorSource.type,
      isToken: true,
      img: undefined,
      system: actorSource.system,
      items: effectiveItems,
      effects: { size: 0 },
      toObject: () => structuredClone(actorSource),
      update: async (changes) => actorUpdates.push(changes),
      deleteEmbeddedDocuments: async () => {
        assert.fail("migration must not delete items through token.actor");
      },
      createEmbeddedDocuments: async () => {
        assert.fail("migration must not create items through token.actor");
      },
    };

    const updates = [];
    const token = {
      actor,
      delta: {
        _source: {
          _id: "token-delta",
          name: "Delta Beast Override",
          img: "icons/svg/mystery-man.svg",
          system: { hp: { value: 3 } },
          effects: [{ _id: "delta-effect", disabled: true }],
          flags: { wwn: { preserve: true } },
          items: [
            structuredClone(legacyDeltaArt),
            structuredClone(linkedDeltaWeapon),
            structuredClone(legacyDeltaAbility),
            structuredClone(tombstone),
          ],
        },
      },
      update: async (changes, options) => updates.push({ changes, options }),
    };

    await migrateUnlinkedToken(token);

    assert.equal(updates.length, 1);
    assert.deepEqual(actorUpdates, [{ "system.favorites": ["delta-weapon"] }]);
    assert.deepEqual(Object.keys(updates[0].changes), ["delta"]);
    assert.equal(updates[0].changes.delta.operator, "replace");
    const replacementDelta = updates[0].changes.delta.value;
    assert.deepEqual(
      {
        _id: replacementDelta._id,
        name: replacementDelta.name,
        img: replacementDelta.img,
        system: replacementDelta.system,
        effects: replacementDelta.effects,
        flags: replacementDelta.flags,
      },
      {
        _id: "token-delta",
        name: "Delta Beast Override",
        img: "icons/svg/mystery-man.svg",
        system: { hp: { value: 3 } },
        effects: [{ _id: "delta-effect", disabled: true }],
        flags: { wwn: { preserve: true } },
      },
      "replacing the ActorDelta must preserve all non-item delta fields",
    );
    const persisted = replacementDelta.items;
    assert.deepEqual(
      persisted.map((item) => item._id),
      ["delta-art", "delta-weapon", "delta-ability", "removed-base-item"],
      "inherited base-only items must not be copied into the delta",
    );
    assert.equal(persisted[0].type, "power");
    assert.equal(persisted[0].system.subType, "art");
    assert.equal(persisted[0].system.source, "Elementalist");
    assert.equal(persisted[1].system.artId, "delta-art");
    assert.equal(persisted[1].system.artFallback, "Sorcerous Blast");
    assert.equal(persisted[2].type, "power");
    assert.equal(persisted[2].system.subType, "ability");
    assert.deepEqual(persisted[3], tombstone);
    assert.equal(updates[0].options.diff, false);
    assert.equal(updates[0].options.wwnMigrating, true);
  });

  it("does not rewrite or finalize unchanged delta items during a forced release pass", async () => {
    const effectiveItems = [];
    effectiveItems.size = 0;
    effectiveItems.invalidDocumentIds = new Set();

    let finalizerItemScans = 0;
    effectiveItems.filter = () => {
      finalizerItemScans += 1;
      return [];
    };

    const actorSource = {
      _id: "synthetic-unchanged",
      name: "Unchanged Delta Beast",
      type: "monster",
      system: {
        hp: { value: 8, max: 8 },
        hd: "1d8",
        favorites: [],
      },
      items: [],
      effects: [],
    };
    const actorUpdates = [];
    const actor = {
      id: actorSource._id,
      name: actorSource.name,
      type: actorSource.type,
      isToken: true,
      img: undefined,
      system: actorSource.system,
      items: effectiveItems,
      effects: { size: 0 },
      toObject: () => structuredClone(actorSource),
      update: async (changes, options) => actorUpdates.push({ changes, options }),
    };

    const tokenUpdates = [];
    const token = {
      actor,
      delta: {
        _source: {
          _id: "unchanged-delta",
          flags: { wwn: { preserve: true } },
          items: [],
        },
      },
      update: async (changes, options) => tokenUpdates.push({ changes, options }),
    };

    await migrateUnlinkedToken(token, { forcePersist: true });

    assert.equal(actorUpdates.length, 1, "the forced synthetic actor system pass must still run");
    assert.equal(actorUpdates[0].changes.system.operator, "replace");
    assert.equal(tokenUpdates.length, 0, "unchanged delta items must not rewrite the Token");
    assert.equal(finalizerItemScans, 0, "unchanged delta items must not run post-item hooks");
  });

  it("deletes a partial recreate before restoring the original persisted snapshot", async () => {
    let liveItems = [
      {
        _id: "legacy-art",
        name: "Legacy Art",
        type: "art",
        _stats: { createdTime: null },
        effects: [],
        system: { source: "Elementalist", time: "Scene", effort: 1 },
      },
      {
        _id: "transient-currency",
        name: "Bits",
        type: "currency",
        flags: { wwn: { migrationGenerated: "legacyCurrency" } },
        _stats: { createdTime: null },
        effects: [],
        system: { multiplier: 1, carried: 9, banked: 5 },
      },
    ];
    const backup = structuredClone(liveItems);
    const migrated = [
      {
        _id: "legacy-art",
        name: "Legacy Art",
        type: "power",
        effects: [],
        system: { subType: "art" },
      },
      structuredClone(backup[1]),
    ];
    const persistedMigrated = structuredClone(migrated);
    delete persistedMigrated[1]._stats;
    persistedMigrated[1].flags.wwn.migrationPersisted = true;
    const serverItems = new Map([["legacy-art", structuredClone(liveItems[0])]]);
    const events = [];
    let createAttempt = 0;
    const actor = {
      id: "actor-1",
      name: "Rollback Actor",
      isToken: false,
      get items() {
        liveItems.invalidDocumentIds = new Set();
        return liveItems;
      },
      toObject: () => ({ items: structuredClone(liveItems) }),
      update: async () => assert.fail("rollback clear must not persist Actor.items"),
      updateSource: (changes) => {
        events.push({ kind: "updateSource", changes });
        liveItems = [];
      },
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        events.push({ kind: "delete", documentName, ids: [...ids], options });
        for (const id of ids) {
          assert.equal(serverItems.delete(id), true, `server must contain ${id}`);
        }
      },
      createEmbeddedDocuments: async (documentName, items, options) => {
        createAttempt += 1;
        events.push({ kind: "create", documentName, items: structuredClone(items), options });
        if (createAttempt === 1) {
          // Model a non-atomic server batch: one migrated row was inserted and
          // reflected in the client before a later row failed.
          const partial = {
            ...structuredClone(items[0]),
            _stats: { createdTime: 5678 },
          };
          serverItems.set(partial._id, structuredClone(partial));
          liveItems = [partial];
          throw new Error("simulated create failure");
        }
        for (const source of items) {
          assert.equal(serverItems.has(source._id), false, `restore id ${source._id} must be free`);
          const restored = {
            ...structuredClone(source),
            _stats: { ...(source._stats ?? {}), createdTime: 9012 },
          };
          serverItems.set(restored._id, structuredClone(restored));
          liveItems.push(restored);
        }
        return liveItems;
      },
    };

    await assert.rejects(
      replaceEmbeddedItemsSafely(actor, migrated),
      /simulated create failure/,
    );

    assert.deepEqual(events.map((event) => event.kind), [
      "delete",
      "updateSource",
      "create",
      "delete",
      "updateSource",
      "create",
    ]);
    assert.deepEqual(events[0].ids, ["legacy-art"]);
    assert.deepEqual(events[1].changes.items, { operator: "replace", value: [] });
    assert.deepEqual(events[2].items, persistedMigrated);
    assert.deepEqual(events[3].ids, ["legacy-art"]);
    assert.deepEqual(events[4].changes.items, { operator: "replace", value: [] });
    assert.deepEqual(events[5].items, [backup[0]]);
    assert.equal(events[5].options.keepId, true);
    assert.deepEqual([...serverItems.keys()], ["legacy-art"]);
  });
});
