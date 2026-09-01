/** Weapon -> Art link, migration, sheet, and post-attack flow regressions. */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backfillWeaponArtLinks,
  normalizeWeaponArtFallback,
  resolveLinkedArt,
  useLinkedArtAfterAttack,
  weaponArtFallbackForSelection,
  weaponArtLinksNeedBackfill,
  weaponArtSelectionChanged,
} from "../module/helpers/weapon-art.mjs";
import {
  migrateActorItems,
  migrateItemData,
} from "../module/migration/transforms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const art = {
  _id: "art-1",
  id: "art-1",
  name: "Sorcerous Blast",
  type: "power",
  system: { subType: "art" },
};

describe("weapon Art resolution", () => {
  it("uses a typed id across renames and falls back by exact case-insensitive name", () => {
    assert.equal(
      resolveLinkedArt([art], { artId: "art-1", artFallback: "Old Name" }),
      art
    );
    assert.equal(
      resolveLinkedArt([art], { artId: "stale", artFallback: "  SORCEROUS BLAST " }),
      art
    );
  });

  it("rejects non-Art powers and normalizes the old none sentinel", () => {
    const spell = { ...art, system: { subType: "spell" } };
    assert.equal(resolveLinkedArt([spell], { artId: "art-1" }), null);
    assert.equal(resolveLinkedArt([spell], { artFallback: "Sorcerous Blast" }), null);
    assert.equal(normalizeWeaponArtFallback(" None "), "");
    assert.equal(resolveLinkedArt([art], { artFallback: "none" }), null);
  });

  it("backfills ids after Art migration and is idempotent", () => {
    const weapon = {
      _id: "weapon-1",
      type: "weapon",
      system: { artId: "", artFallback: "sorcerous blast" },
    };
    assert.equal(weaponArtLinksNeedBackfill([weapon, art]), true);
    const once = backfillWeaponArtLinks([weapon, art]);
    assert.equal(once[0].system.artId, "art-1");
    assert.equal(once[0].system.artFallback, "Sorcerous Blast");
    assert.equal(weaponArtLinksNeedBackfill(once), false);
    assert.deepEqual(backfillWeaponArtLinks(once), once);
  });

  it("preserves an unresolved fallback on unrelated submits and clears it explicitly", () => {
    assert.equal(weaponArtFallbackForSelection({
      items: [], artId: "", currentFallback: "Missing Art", selectionChanged: false,
    }), "Missing Art");
    assert.equal(weaponArtFallbackForSelection({
      items: [], artId: "", currentFallback: "Missing Art", selectionChanged: true,
    }), "");
    assert.equal(weaponArtFallbackForSelection({
      items: [art], artId: "art-1", currentFallback: "Old Name", selectionChanged: true,
    }), "Sorcerous Blast");
  });

  it("does not treat a stale unmatched id rendered as blank as an explicit unlink", () => {
    assert.equal(weaponArtSelectionChanged({
      submittedArtId: "",
      storedArtId: "stale-from-other-actor",
      resolvedArtId: "",
      controlChanged: false,
    }), false);
    assert.equal(weaponArtSelectionChanged({
      submittedArtId: "",
      storedArtId: "art-1",
      resolvedArtId: "art-1",
      controlChanged: false,
    }), true);
    assert.equal(weaponArtSelectionChanged({
      submittedArtId: "art-1",
      storedArtId: "stale-from-other-actor",
      resolvedArtId: "art-1",
      controlChanged: false,
    }), false);
  });
});

describe("legacy weapon Art migration", () => {
  it("advances the migration release so in-memory migration is persisted", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const migration = fs.readFileSync(path.join(root, "module/migration/migrate.mjs"), "utf8");
    assert.equal(manifest.version, "2.0.0-alpha2.5");
    assert.equal(pkg.version, manifest.version);
    assert.match(migration, /NEEDS_MIGRATION_BELOW\s*=\s*"2\.0\.0-alpha2\.5"/);
    assert.match(migration, /forceReleasePass/);
  });

  it("converts legacy Arts first, preserves their ids, and links weapons by name", () => {
    const migrated = migrateActorItems([
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
    ]);

    const weapon = migrated.find((item) => item.type === "weapon");
    const power = migrated.find((item) => item.type === "power");
    assert.equal(power._id, "art-1");
    assert.equal(power.system.subType, "art");
    assert.equal(weapon.system.artId, "art-1");
    assert.equal(weapon.system.artFallback, "Sorcerous Blast");
    assert.equal(Object.hasOwn(weapon.system, "art"), false);
    assert.deepEqual(migrateActorItems(migrated), migrated);
  });

  it("normalizes none and repairs modern-shaped weapons before schema validation", () => {
    const migrated = migrateActorItems([
      { _id: "w-none", name: "Spear", type: "weapon", system: { art: "none" } },
    ])[0];
    assert.equal(migrated.system.artId, "");
    assert.equal(migrated.system.artFallback, "");

    const repaired = migrateItemData({
      _id: "w-modern",
      type: "weapon",
      system: {
        skillId: "",
        art: "Natural Weaponry I",
        counter: { value: 1, max: 1 },
        ammoMode: "none",
        ammoFallback: "",
        charges: { value: 0, max: 0 },
        shock: { ac: 15 },
      },
    });
    assert.equal(repaired.system.artId, "");
    assert.equal(repaired.system.artFallback, "Natural Weaponry I");
    assert.equal(repaired.system["-=art"], null);
  });
});

describe("linked Art attack flow", () => {
  it("does not use an Art for a canceled attack", async () => {
    let calls = 0;
    const weapon = { system: { linkedArt: { async usePower() { calls++; } } } };
    assert.equal(await useLinkedArtAfterAttack(weapon, undefined), undefined);
    assert.equal(calls, 0);
  });

  it("uses the Art after a created attack and always returns that message", async () => {
    const calls = [];
    const message = { id: "chat-1" };
    const weapon = {
      system: {
        linkedArt: {
          async usePower(options) {
            calls.push(options);
            return undefined; // e.g. insufficient Effort after the attack
          },
        },
      },
    };
    assert.equal(await useLinkedArtAfterAttack(weapon, message), message);
    assert.deepEqual(calls, [{ skipDialog: true }]);
  });

  it("wires an owned-Art id selector and invokes the helper after rollAttack", () => {
    const template = fs.readFileSync(
      path.join(root, "templates/item/attributes/weapon.hbs"),
      "utf8"
    );
    const sheet = fs.readFileSync(path.join(root, "module/sheets/item/item-sheet.mjs"), "utf8");
    const item = fs.readFileSync(path.join(root, "module/documents/item.mjs"), "utf8");
    assert.match(template, /select name="system\.artId"/);
    assert.match(template, /name="system\.artFallback"/);
    assert.match(sheet, /isArtPower\(gear\)/);
    assert.match(item, /const message = await WwnDice\.rollAttack/);
    assert.match(item, /return useLinkedArtAfterAttack\(this, message\)/);
  });
});
