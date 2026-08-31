/**
 * Weapon sheet skill field must persist to the DataModel (skillFallback / skillId),
 * not the pre-migration `system.skill` key that TypeDataModel strips.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

describe("weapon sheet skill field", () => {
  it("binds the typed skill input to system.skillFallback", () => {
    const tpl = fs.readFileSync(path.join(root, "templates/item/attributes/weapon.hbs"), "utf8");
    assert.match(tpl, /name="system\.skillFallback"/);
    assert.match(tpl, /value="\{\{system\.skillFallback\}\}"/);
    assert.doesNotMatch(tpl, /name="system\.skill"/);
  });

  it("migrates leftover system.skill onto skillFallback before schema validation", () => {
    const src = fs.readFileSync(path.join(root, "module/data/item/weapon.mjs"), "utf8");
    assert.match(src, /source\.skillFallback\s*=\s*source\.skill/);
    assert.match(src, /delete source\.skill/);
  });
});
