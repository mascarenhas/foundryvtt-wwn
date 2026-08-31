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

describe("Foundry v14 embedded-item migration persistence", () => {
  it("clears a real Actor through deleteAll rather than an Actor update", async () => {
    const calls = [];
    const actor = {
      isToken: false,
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({ items: [{ _id: "item-1" }] }),
      update: async () => assert.fail("clearEmbeddedItems must not update Actor.items"),
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        calls.push({ documentName, ids, options });
      },
    };

    await clearEmbeddedItems(actor);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].documentName, "Item");
    assert.deepEqual(calls[0].ids, []);
    assert.equal(calls[0].options.deleteAll, true);
    assert.equal(calls[0].options.wwnMigrating, true);
  });

  it("rejects attempts to clear an unlinked Token's synthetic Actor", async () => {
    let deleted = false;
    const actor = {
      isToken: true,
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({ items: [{ _id: "delta-item" }] }),
      deleteEmbeddedDocuments: async () => { deleted = true; },
    };

    await assert.rejects(
      clearEmbeddedItems(actor),
      /synthetic|token/i,
    );
    assert.equal(deleted, false);
  });

  it("still issues deleteAll when the local Actor collection appears empty", async () => {
    const calls = [];
    const actor = {
      isToken: false,
      items: { size: 0, invalidDocumentIds: new Set() },
      toObject: () => ({ items: [] }),
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        calls.push({ documentName, ids, options });
      },
    };

    await clearEmbeddedItems(actor);

    assert.deepEqual(calls, [{
      documentName: "Item",
      ids: [],
      options: { deleteAll: true, wwnMigrating: true },
    }]);
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
    const tombstone = {
      _id: "removed-base-item",
      _tombstone: true,
      _key: "ActorDelta.token-delta.items.removed-base-item",
      flags: { wwn: { reason: "removed" } },
    };
    const effectiveItems = [inheritedBaseItem, legacyDeltaArt, linkedDeltaWeapon];
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
          items: [
            structuredClone(legacyDeltaArt),
            structuredClone(linkedDeltaWeapon),
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
    const persisted = updates[0].changes.delta.items;
    assert.deepEqual(
      persisted.map((item) => item._id),
      ["delta-art", "delta-weapon", "removed-base-item"],
      "inherited base-only items must not be copied into the delta",
    );
    assert.equal(persisted[0].type, "power");
    assert.equal(persisted[0].system.subType, "art");
    assert.equal(persisted[0].system.source, "Elementalist");
    assert.equal(persisted[1].system.artId, "delta-art");
    assert.equal(persisted[1].system.artFallback, "Sorcerous Blast");
    assert.deepEqual(persisted[2], tombstone);
    assert.equal(updates[0].options.diff, false);
    assert.equal(updates[0].options.wwnMigrating, true);
  });

  it("clears again before restoring the original items after recreate fails", async () => {
    const backup = [
      {
        _id: "legacy-art",
        name: "Legacy Art",
        type: "art",
        effects: [],
        system: { source: "Elementalist", time: "Scene", effort: 1 },
      },
    ];
    const migrated = [
      {
        _id: "legacy-art",
        name: "Legacy Art",
        type: "power",
        effects: [],
        system: { subType: "art" },
      },
    ];
    const events = [];
    let createAttempt = 0;
    const actor = {
      id: "actor-1",
      name: "Rollback Actor",
      isToken: false,
      items: { size: 1, invalidDocumentIds: new Set() },
      toObject: () => ({ items: structuredClone(backup) }),
      deleteEmbeddedDocuments: async (documentName, ids, options) => {
        events.push({ kind: "delete", documentName, ids, options });
      },
      createEmbeddedDocuments: async (documentName, items, options) => {
        createAttempt += 1;
        events.push({ kind: "create", documentName, items: structuredClone(items), options });
        if (createAttempt === 1) throw new Error("simulated create failure");
        return items;
      },
    };

    await assert.rejects(
      replaceEmbeddedItemsSafely(actor, migrated),
      /simulated create failure/,
    );

    assert.deepEqual(events.map((event) => event.kind), [
      "delete",
      "create",
      "delete",
      "create",
    ]);
    assert.equal(events[0].options.deleteAll, true);
    assert.deepEqual(events[1].items, migrated);
    assert.equal(events[2].options.deleteAll, true);
    assert.deepEqual(events[3].items, backup);
    assert.equal(events[3].options.keepId, true);
  });
});
