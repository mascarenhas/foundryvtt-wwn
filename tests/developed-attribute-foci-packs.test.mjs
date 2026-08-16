/**
 * Developed Attribute is six pack foci, each with one active AE.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEVELOPED_ATTRIBUTE_VARIANTS } from "../module/helpers/developed-attribute-focus.mjs";

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packs",
  "source",
  "abilities-wwn",
);

function collectFoci(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collectFoci(p, out);
    else if (ent.name.endsWith(".json")) {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      if (data.type === "focus") out.push(data);
    }
  }
  return out;
}

describe("Developed Attribute pack foci", () => {
  const foci = collectFoci(ROOT);
  const developed = foci.filter((f) => f.name.startsWith("Developed Attribute"));

  it("has one focus per attribute and no combined leftover", () => {
    const names = developed.map((f) => f.name).sort();
    assert.deepEqual(
      names,
      DEVELOPED_ATTRIBUTE_VARIANTS.map((v) => `Developed Attribute (${v.label})`).sort(),
    );
    assert.ok(!foci.some((f) => f.name === "Developed Attribute"));
  });

  it("each variant has a single enabled AE for that attribute", () => {
    for (const variant of DEVELOPED_ATTRIBUTE_VARIANTS) {
      const focus = developed.find((f) => f.name === `Developed Attribute (${variant.label})`);
      assert.equal(focus.effects.length, 1, variant.label);
      assert.equal(focus.effects[0].disabled, false, variant.label);
      assert.deepEqual(focus.effects[0].system.changes, [
        { key: `system.abilities.${variant.key}.baseMod`, type: "add", value: 1, phase: "initial" },
      ]);
    }
  });
});
