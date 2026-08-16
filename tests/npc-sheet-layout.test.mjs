/**
 * NPC sheet combat-layout contract.
 * Run: node --test tests/npc-sheet-layout.test.mjs
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

describe("NPC sheet contract", () => {
  it("registers a Powers tab and 640×640 default size", () => {
    const src = read("module/sheets/actor/npc-sheet.mjs");
    assert.match(src, /id:\s*"powers"/);
    assert.match(src, /templates\/actor\/npc\/tabs\/powers\.hbs/);
    assert.match(src, /width:\s*640/);
    assert.match(src, /height:\s*640/);
  });

  it("does not force favorites off on the NPC sheet", () => {
    const src = read("module/sheets/actor/npc-sheet.mjs");
    assert.doesNotMatch(src, /favoritesEnabled\s*=\s*false/);
    assert.doesNotMatch(src, /context\.favorites\s*=\s*\[\]/);
  });

  it("enables favorites for PCs and NPCs on the base sheet", () => {
    const src = read("module/sheets/actor/base-actor-sheet.mjs");
    assert.match(src, /favoritesEnabled\s*=\s*isPc\(actor\)\s*\|\|\s*isNpc\(actor\)/);
    assert.match(src, /context\.isNpc\s*=\s*isNpc\(actor\)/);
  });
});

describe("NPC header and Main combat bands", () => {
  it("rolls HP from the HD chip, puts the HP bar under the name, and keeps XP and alignment off the header", () => {
    const src = read("templates/actor/npc/header.hbs");
    assert.match(src, /data-action="rollNpcHp"/);
    assert.match(src, /wwnResourceBars/);
    assert.match(src, /wwn-npc-hp/);
    assert.doesNotMatch(src, /system\.details\.xp/);
    assert.doesNotMatch(src, /showAlignment/);
    assert.doesNotMatch(src, /rollReaction/);
  });

  it("puts save-style combat panels on Main and omits prep / extra combat fields", () => {
    const src = read("templates/actor/npc/tabs/main.hbs");
    assert.match(src, /wwn-npc-band--vitals/);
    assert.match(src, /wwn-npc-combat-stack/);
    assert.match(src, /wwn-npc-saves[\s\S]*?wwn-form-panel[\s\S]*?wwn-save-grid/);
    assert.match(src, /name="system\.combat\.ab"/);
    assert.match(src, /name="system\.combat\.acManual\.melee"/);
    assert.match(src, /name="system\.movement\.base\.value"/);
    assert.match(src, /name="system\.details\.morale"/);
    assert.match(src, /data-action="rollMorale"/);
    assert.match(src, /data-action="rollNpcSkill"/);
    assert.match(src, /data-action="rollInstinct"/);
    assert.match(src, /useTrauma/);
    assert.match(src, /name="system\.trauma\.value"/);
    assert.doesNotMatch(src, /wwn-npc-band--combat/);
    assert.doesNotMatch(src, /wwn-chip/);
    assert.doesNotMatch(src, /wwnResourceBars/);
    assert.doesNotMatch(src, /system\.details\.appearing/);
    assert.doesNotMatch(src, /instinctTable/);
    assert.doesNotMatch(src, /system\.combat\.initMod/);
    assert.doesNotMatch(src, /system\.combat\.damageBonus/);
    assert.doesNotMatch(src, /system\.details\.xp/);
  });
});

describe("NPC Main lists", () => {
  it("shows Attacks & Equipment and favorites and does not embed the Powers body", () => {
    const src = read("templates/actor/npc/tabs/main.hbs");
    assert.match(src, /WWN\.category\.attacksAndEquipment/);
    assert.match(src, /count=\(add attackPatterns\.length otherItems\.length\)/);
    assert.match(src, /wwnFavoritesDock/);
    assert.match(src, /wwnItemControls/);
    const gear = src.slice(src.indexOf("wwn-npc-gear"));
    assert.match(gear, /favoritable=@root\.favoritesEnabled/);
    assert.match(gear, /wwn-data-table/);
    assert.match(src, /otherItems/);
    assert.doesNotMatch(src, /wwnPowersTabBody/);
    assert.doesNotMatch(src, /WWN\.category\.abilities/);
  });

  it("gives Attacks a wider left column than Favorites", () => {
    const css = read("scss/wwn/_monster-sheet.scss");
    const block = css.slice(css.indexOf(".wwn-npc-main-lists"));
    assert.match(block, /grid-template-columns:\s*1\.4fr\s+1fr/);
    assert.doesNotMatch(block.slice(0, 400), /grid-template-columns:\s*1fr\s+1fr/);
    const inv = read("scss/wwn/_inventory.scss");
    const npcInv = inv.slice(inv.indexOf("&.npc"));
    assert.doesNotMatch(npcInv, /attributes-tab[\s\S]*?\.inventory[\s\S]*?width:\s*420px/);
  });

  it("defines the Attacks & Equipment label", () => {
    const lang = read("lang/en.json");
    assert.match(lang, /"WWN\.category\.attacksAndEquipment": "Attacks & Equipment"/);
  });
});

describe("NPC Powers empty hint", () => {
  it("uses the monster empty string when isNpc", () => {
    const src = read("templates/partials/powers-tab-body.hbs");
    assert.match(src, /WWN\.Power\.EmptyHintNpc/);
    assert.match(src, /isNpc/);
    const lang = read("lang/en.json");
    assert.match(lang, /"WWN\.Power\.EmptyHintNpc": "Add a power to this monster\."/);
  });
});

describe("NPC Details prep fields", () => {
  it("hosts appearing, treasure, instinct table, XP, extras, and leftover gear", () => {
    const src = read("templates/actor/npc/tabs/details.hbs");
    assert.match(src, /system\.details\.xp/);
    assert.match(src, /WWN\.details\.dungeonAppearing/);
    assert.match(src, /WWN\.details\.wildernessAppearing/);
    assert.doesNotMatch(src, /WWN\.details\.appearingA/);
    assert.doesNotMatch(src, /WWN\.details\.appearingB/);
    assert.match(src, /system\.details\.treasure\.type/);
    assert.match(src, /system\.details\.treasure\.table/);
    assert.match(src, /instinctTableLink/);
    assert.match(src, /system\.combat\.initMod/);
    assert.match(src, /system\.combat\.damageBonus/);
    assert.match(src, /rollReaction/);
  });

  it("does not list leftover gear on Details", () => {
    const src = read("templates/actor/npc/tabs/details.hbs");
    assert.doesNotMatch(src, /otherItems/);
    assert.doesNotMatch(src, /npc\.gear/);
  });

  it("uses a text-only treasure table placeholder (not a RollTable drop hint)", () => {
    const src = read("templates/actor/npc/tabs/details.hbs");
    assert.doesNotMatch(
      src,
      /name="system\.details\.treasure\.table"[^>]*placeholder="\{\{localize 'WWN\.details\.treasureTableHint'\}\}"/
    );
    assert.match(src, /placeholder="\{\{localize 'WWN\.details\.treasureTableTextHint'\}\}"/);
    const lang = read("lang/en.json");
    assert.match(lang, /"WWN\.details\.treasureTableTextHint": "Treasure table name or reference\."/);
  });
});

describe("NPC Details chrome", () => {
  it("stacks Config and Save Modifiers in the right column", () => {
    const src = read("templates/actor/npc/tabs/details.hbs");
    assert.match(src, /wwn-form-column/);
    const config = src.indexOf('WWN.category.config');
    const saves = src.indexOf('WWN.Effects.SaveModifiers');
    const column = src.indexOf("wwn-form-column");
    assert.ok(column >= 0 && config > column && saves > config);
  });

  it("puts All Saves Modifier last in the Save Modifiers panel", () => {
    const src = read("templates/actor/npc/tabs/details.hbs");
    const names = [
      "system.saveMods.evasion",
      "system.saveMods.mental",
      "system.saveMods.physical",
      "system.saveMods.luck",
      "system.saveMods.base",
    ];
    const idxs = names.map((name) => src.indexOf(`name="${name}"`));
    assert.ok(idxs.every((i) => i >= 0));
    for (let i = 1; i < idxs.length; i += 1) {
      assert.ok(idxs[i] > idxs[i - 1], `${names[i]} should follow ${names[i - 1]}`);
    }
  });

  it("uses one field column on the NPC Details tab without changing the shared actor grid", () => {
    const npcCss = read("scss/wwn/_monster-sheet.scss");
    const shared = read("scss/wwn/_components.scss");
    assert.match(npcCss, /\.wwn-form-panel-fields[\s\S]*?grid-template-columns:\s*1fr/);
    assert.match(shared, /\.wwn-form-panel-fields[\s\S]*?grid-template-columns:\s*1fr\s+1fr/);
  });
});
