/**
 * Item attribute panels use a single field column; actor sheets keep the shared 2-col grid.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function fieldOrder(src, names) {
  return names.map((name) => src.indexOf(`name="${name}"`));
}

describe("item sheet field columns", () => {
  it("stacks item panel fields in one column without changing the shared actor grid", () => {
    const itemCss = read("scss/wwn/_item-sheets.scss");
    const shared = read("scss/wwn/_components.scss");
    const itemFields = itemCss.slice(itemCss.indexOf(".wwn-form-panel-fields"));
    assert.match(itemFields, /grid-template-columns:\s*1fr/);
    assert.doesNotMatch(itemFields.slice(0, 200), /grid-template-columns:\s*1fr\s+1fr/);
    assert.match(shared, /\.wwn-form-panel-fields[\s\S]*?grid-template-columns:\s*1fr\s+1fr/);
  });

  it("does not persist a skill slug field", () => {
    const src = read("module/data/item/skill.mjs");
    assert.doesNotMatch(src, /schema\.slug/);
    const tpl = read("templates/item/attributes/skill.hbs");
    assert.doesNotMatch(tpl, /system\.slug/);
  });

  it("does not expose a per-weapon skill-to-damage toggle", () => {
    const src = read("templates/item/attributes/weapon.hbs");
    assert.doesNotMatch(src, /system\.skillDamage/);
    const model = read("module/data/item/weapon.mjs");
    assert.doesNotMatch(model, /schema\.skillDamage/);
  });

  it("orders weapon attack identity before save, then TL/firearm", () => {
    const src = read("templates/item/attributes/weapon.hbs");
    const [score, skill, bonus, save, tl, firearm] = fieldOrder(src, [
      "system.score",
      "system.skillFallback",
      "system.bonus",
      "system.save",
      "system.tl",
      "system.firearm",
    ]);
    assert.ok(score < skill && skill < bonus && bonus < save && save < tl && tl < firearm);
  });

  it("groups asset identity before location and cost", () => {
    const src = read("templates/item/attributes/asset.hbs");
    const [rating, type, magic, location, cost] = fieldOrder(src, [
      "system.rating",
      "system.assetType",
      "system.magic",
      "system.location",
      "system.cost",
    ]);
    assert.ok(rating < type && type < magic && magic < location && location < cost);
  });

  it("keeps armor-fitting Shock and Trauma as compound rows", () => {
    const src = read("templates/item/attributes/armor-fitting.hbs");
    assert.match(
      src,
      /name="system\.shock\.damage"[^>]*>\s*\/\s*<input[^>]*name="system\.shock\.ac"/,
    );
    assert.match(
      src,
      /name="system\.trauma\.die"[^>]*>\s*\/\s*<input[^>]*name="system\.trauma\.rating"/,
    );
  });
});
