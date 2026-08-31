/**
 * Dark Sun currency defaults and legacy criticals-branch currency migration.
 */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WWN } from "../module/config/index.mjs";
import { migrateActorData, WWN_CURRENCIES } from "../module/migration/transforms.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function legacyCharacter(currency) {
  return {
    type: "character",
    name: "Athasian Hero",
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
      currency,
    },
    items: [],
    effects: [],
  };
}

describe("Dark Sun currency defaults", () => {
  it("seeds new PCs with the Athasian denominations and relative values", () => {
    assert.deepEqual(WWN.currencySets.darkSun, [
      { name: "WWN.Currency.Bits", multiplier: 1, perSlot: 100 },
      { name: "WWN.Currency.CeramicPieces", multiplier: 10, perSlot: 100 },
      { name: "WWN.Currency.SilverPieces", multiplier: 100, perSlot: 100 },
      { name: "WWN.Currency.GoldPieces", multiplier: 1000, perSlot: 100 },
    ]);
  });

  it("registers the Dark Sun set as the world default", () => {
    const source = fs.readFileSync(path.join(root, "module/settings.mjs"), "utf8");
    const registration = source.match(/registerWwnSetting\("defaultCurrencySet",\s*\{([\s\S]*?)\n\s*\}\);/);
    assert.ok(registration, "defaultCurrencySet registration should exist");
    assert.match(registration[1], /default:\s*"darkSun"/);
    assert.match(registration[1], /darkSun:\s*"WWN\.Setting\.CurrencyDarkSun"/);
  });

  it("labels wealth and bank summaries in Bits", () => {
    const lang = JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8"));
    assert.equal(lang["WWN.items.bank.short"], "Bank (Bits)");
    assert.equal(lang["WWN.items.bank.long"], "Banked Bits");
    assert.equal(lang["WWN.items.total.short"], "Total Bits");
    assert.match(lang["WWN.items.total.long"], /Bits/);
  });
});

describe("legacy Dark Sun currency migration", () => {
  it("retains the criticals-branch slot meanings and multipliers", () => {
    assert.deepEqual(WWN_CURRENCIES, [
      { key: "cp", name: "N/A", multiplier: 0.1, perSlot: 100 },
      { key: "sp", name: "Bits", multiplier: 1, perSlot: 100, base: true },
      { key: "ep", name: "Ceramic Pieces", multiplier: 10, perSlot: 100 },
      { key: "gp", name: "Silver Pieces", multiplier: 100, perSlot: 100 },
      { key: "pp", name: "Gold Pieces", multiplier: 1000, perSlot: 100 },
    ]);
  });

  it("preserves every nonzero legacy slot and the bits bank", () => {
    const out = migrateActorData(legacyCharacter({ cp: 2, sp: 3, ep: 4, gp: 5, pp: 6, bank: 7 }));
    const currencies = out.items.filter((item) => item.type === "currency");

    assert.deepEqual(
      currencies.map(({ name, system }) => ({ name, ...system })),
      [
        { name: "N/A", multiplier: 0.1, perSlot: 100, carried: 2, banked: 0 },
        { name: "Bits", multiplier: 1, perSlot: 100, carried: 3, banked: 7 },
        { name: "Ceramic Pieces", multiplier: 10, perSlot: 100, carried: 4, banked: 0 },
        { name: "Silver Pieces", multiplier: 100, perSlot: 100, carried: 5, banked: 0 },
        { name: "Gold Pieces", multiplier: 1000, perSlot: 100, carried: 6, banked: 0 },
      ]
    );
  });

  it("creates a Bits item when only legacy banked currency is nonzero", () => {
    const out = migrateActorData(legacyCharacter({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, bank: 19 }));
    const currencies = out.items.filter((item) => item.type === "currency");

    assert.equal(currencies.length, 1);
    assert.equal(currencies[0].name, "Bits");
    assert.deepEqual(currencies[0].system, {
      multiplier: 1,
      perSlot: 100,
      carried: 0,
      banked: 19,
    });
  });
});
