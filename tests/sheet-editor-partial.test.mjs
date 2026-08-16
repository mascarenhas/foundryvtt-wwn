/**
 * All sheet prose fields must use the shared wwnSheetEditor lego.
 * NPC/item editors that inline <prose-mirror> inside .resizable-editor collapse
 * to 0 height when Foundry activates the editor (absolute .editor-content).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const CONSUMERS = [
  "templates/actor/pc/tabs/details.hbs",
  "templates/actor/npc/tabs/details.hbs",
  "templates/item/description.hbs",
  "templates/actor/faction/tabs/main.hbs",
  "templates/actor/starship/tabs/details.hbs",
  "templates/actor/power-armor/tabs/details.hbs",
];

describe("wwnSheetEditor lego", () => {
  it("is registered as a named Handlebars partial", () => {
    const registry = fs.readFileSync(path.join(root, "module/helpers/templates.mjs"), "utf8");
    assert.match(registry, /wwnSheetEditor:\s*"systems\/wwn\/templates\/partials\/sheet-editor\.hbs"/);
  });

  it("defines a prose-mirror bound to name, value, uuid, and enriched HTML", () => {
    const partial = fs.readFileSync(path.join(root, "templates/partials/sheet-editor.hbs"), "utf8");
    assert.match(partial, /class="wwn-sheet-editor/);
    assert.match(partial, /<prose-mirror/);
    assert.match(partial, /name="\{\{name\}\}"/);
    assert.match(partial, /value="\{\{value\}\}"/);
    assert.match(partial, /data-document-uuid="\{\{documentUuid\}\}"/);
    assert.match(partial, /\{\{\{enriched\}\}\}/);
  });

  it("is used by every actor/item prose field instead of a raw <prose-mirror>", () => {
    for (const rel of CONSUMERS) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      assert.match(src, /\{\{>\s*wwnSheetEditor/, `${rel} must include {{> wwnSheetEditor}}`);
      assert.doesNotMatch(src, /<prose-mirror/, `${rel} must not inline <prose-mirror>`);
      assert.doesNotMatch(src, /resizable-editor/, `${rel} must not use the legacy resizable-editor wrapper`);
    }
  });

  it("gives the active Foundry editor-container a real height floor", () => {
    const chrome = fs.readFileSync(path.join(root, "scss/wwn/_sheet-chrome.scss"), "utf8");
    const components = fs.readFileSync(path.join(root, "scss/wwn/_components.scss"), "utf8");
    const css = `${chrome}\n${components}`;
    assert.match(css, /\.wwn-sheet-editor/);
    assert.match(css, /\.editor-container/);
    assert.match(css, /min-height/);
  });

  it("lets NPC, item, and PC notes editors fill leftover sheet height", () => {
    const partial = fs.readFileSync(path.join(root, "templates/partials/sheet-editor.hbs"), "utf8");
    assert.match(partial, /wwn-sheet-editor--fill/);

    const npc = fs.readFileSync(path.join(root, "templates/actor/npc/tabs/details.hbs"), "utf8");
    const item = fs.readFileSync(path.join(root, "templates/item/description.hbs"), "utf8");
    const pc = fs.readFileSync(path.join(root, "templates/actor/pc/tabs/details.hbs"), "utf8");
    assert.match(npc, /fill=true/);
    assert.match(item, /fill=true/);
    assert.match(pc, /wwn-sheet-editors/);
    assert.equal((pc.match(/fill=true/g) ?? []).length, 2, "PC Description and Notes both fill leftover space");

    const components = fs.readFileSync(path.join(root, "scss/wwn/_components.scss"), "utf8");
    assert.match(components, /\.wwn-sheet-editor--fill/);
    assert.match(components, /\.wwn-sheet-editors/);
    assert.match(components, /flex:\s*1\s+1\s+0/);
  });
});
