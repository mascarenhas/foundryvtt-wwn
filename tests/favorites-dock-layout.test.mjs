/**
 * Shared Favorites dock row: one-line names, controls on the right.
 * Run: node --test tests/favorites-dock-layout.test.mjs
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

describe("Favorites dock rows", () => {
  it("does not wrap favorite names and pins item controls to the right", () => {
    const inv = read("scss/wwn/_inventory.scss");
    const fav = inv.slice(inv.indexOf(".inventory.wwn-favorites-dock"));
    assert.notEqual(fav.indexOf(".inventory.wwn-favorites-dock"), -1);
    assert.match(fav, /flex-wrap:\s*nowrap/);
    assert.match(fav, /\.item-name[\s\S]*?min-width:\s*0/);
    assert.match(fav, /white-space:\s*nowrap/);
    assert.match(fav, /\.item-controls[\s\S]*?margin-left:\s*auto/);
  });
});
