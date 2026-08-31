/** Release migration persistence after Foundry's in-memory migrateData pass. */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { actorMigrationPersistencePlan } from "../module/migration/migrate.mjs";
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
});
