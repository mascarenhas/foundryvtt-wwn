/**
 * Skill roll dialog: themed showWwnDialog lego + selectable attribute.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../build/foundry-shim.mjs";
import { skillRollAbilityChoices, parseRollDialogResult } from "../module/dice/roll-prompt.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("skillRollAbilityChoices", () => {
  const abilities = { str: "STR", dex: "DEX", int: "INT" };

  it("returns empty when the actor has no ability scores", () => {
    assert.deepEqual(skillRollAbilityChoices({ system: {} }, "int", { abilities }), []);
  });

  it("lists abilities and marks the skill default as selected", () => {
    const actor = { system: { abilities: { str: { mod: 1 }, dex: { mod: 2 }, int: { mod: 0 } } } };
    const choices = skillRollAbilityChoices(actor, "dex", { abilities, localize: (k) => k });
    assert.deepEqual(choices.map((c) => c.key), ["str", "dex", "int"]);
    assert.equal(choices.find((c) => c.key === "dex")?.selected, true);
    assert.equal(choices.find((c) => c.key === "int")?.selected, false);
  });
});

describe("parseRollDialogResult", () => {
  it("returns null when cancelled", () => {
    assert.equal(parseRollDialogResult(null, { defaultAbilityKey: "int" }), null);
    assert.equal(parseRollDialogResult("cancel", { defaultAbilityKey: "int" }), null);
  });

  it("reads the chosen attribute and situational modifier", () => {
    assert.deepEqual(parseRollDialogResult({ abilityKey: "str", modifier: "2" }, { defaultAbilityKey: "int" }), {
      modifier: 2,
      abilityKey: "str",
    });
    assert.deepEqual(parseRollDialogResult({ modifier: "" }, { defaultAbilityKey: "wis" }), {
      modifier: 0,
      abilityKey: "wis",
    });
  });
});

describe("skill roll dialog wiring", () => {
  it("uses the shared roll-options template with an attribute select", () => {
    const tpl = fs.readFileSync(path.join(root, "templates/dialog/roll-options.hbs"), "utf8");
    assert.match(tpl, /name="abilityKey"/);
    assert.match(tpl, /#if abilities/);
    assert.match(tpl, /name="modifier"/);
  });

  it("skill rolls go through showWwnDialog and honor the chosen attribute", () => {
    const dice = fs.readFileSync(path.join(root, "module/dice/dice.mjs"), "utf8");
    assert.match(dice, /showWwnDialog/);
    assert.match(dice, /skillRollAbilityChoices/);
    assert.match(dice, /prompt\.abilityKey/);
  });

  it("themes wwn-dialog windows like sheets and restores dialog field chrome", () => {
    const chrome = fs.readFileSync(path.join(root, "scss/wwn/_sheet-chrome.scss"), "utf8");
    const dialogs = fs.readFileSync(path.join(root, "scss/wwn/_dialogs.scss"), "utf8");
    const css = `${chrome}\n${dialogs}`;
    assert.match(css, /\.wwn-dialog/);
    assert.match(css, /--color-scheme|color-scheme/);
    assert.match(dialogs, /\.form-group/);
    assert.match(dialogs, /--wwn-input-bg/);
  });
});
