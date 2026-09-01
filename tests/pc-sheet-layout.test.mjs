/**
 * PC Main-tab layout: scrollable two-column skills and in-bar resource values.
 * Run: node --test tests/pc-sheet-layout.test.mjs
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

function skillsListBlock(css) {
  const start = css.indexOf(".wwn-skills-list");
  assert.ok(start >= 0, "expected .wwn-skills-list in character-sheet SCSS");
  return css.slice(start, start + 400);
}

function resourceBarBlock(css) {
  const start = css.indexOf(".wwn-resource-bar {");
  assert.ok(start >= 0, "expected .wwn-resource-bar rule");
  return css.slice(start, start + 900);
}

describe("PC skills list scrolling", () => {
  it("lays skills out in a two-column grid instead of CSS columns", () => {
    const block = skillsListBlock(read("scss/wwn/_character-sheet.scss"));
    assert.match(block, /display:\s*grid/);
    assert.match(block, /grid-template-columns:\s*1fr\s+1fr/);
    assert.doesNotMatch(block, /^\s*columns:/m);
  });

  it("keeps the skills list a vertical scroll container", () => {
    const block = skillsListBlock(read("scss/wwn/_character-sheet.scss"));
    assert.match(block, /min-height:\s*0/);
    assert.match(block, /overflow-y:\s*auto/);
  });
});

describe("resource bar value overlay", () => {
  it("nests value/max inputs inside each fill bar, not the header", () => {
    const src = read("templates/partials/resource-bars.hbs");
    const valueHits = [...src.matchAll(/wwn-resource-bar-values/g)];
    assert.ok(valueHits.length >= 2, "expected value/max on tracker bars and XP");
    for (const hit of valueHits) {
      const before = src.slice(0, hit.index);
      const lastFill = before.lastIndexOf("wwn-resource-bar-fill");
      const lastHeader = before.lastIndexOf("wwn-resource-bar-box-header");
      assert.ok(lastFill > lastHeader, "values must sit inside the bar after the fill, not in the header");
    }
  });

  it("centers values over the bar with a higher stacking order and no input chrome", () => {
    const css = read("scss/wwn/_resource-bars.scss");
    const bar = resourceBarBlock(css);
    assert.match(bar, /position:\s*relative/);
    assert.match(bar, /z-index:\s*0/);

    const valuesStart = css.indexOf(".wwn-resource-bar-values");
    assert.ok(valuesStart >= 0);
    const values = css.slice(valuesStart, valuesStart + 500);
    assert.match(values, /position:\s*absolute/);
    assert.match(values, /z-index:\s*1/);
    assert.match(values, /justify-content:\s*center/);

    const inputStart = css.indexOf(".wwn-resource-bar-values input");
    assert.ok(inputStart >= 0);
    const input = css.slice(inputStart, inputStart + 700);
    assert.match(input, /border:\s*none/);
    assert.match(input, /background:/);
    assert.doesNotMatch(input, /border:\s*1px/);
  });
});

describe("class assignment prompt retry", () => {
  it("requires a post-migration flag and guards only an in-flight check", () => {
    const src = read("module/sheets/actor/pc-sheet.mjs");
    const onRenderStart = src.indexOf("async _onRender(context, options)");
    const onRenderEnd = src.indexOf("/*  Actions", onRenderStart);
    assert.ok(onRenderStart >= 0 && onRenderEnd > onRenderStart, "expected PC sheet render hook");
    const onRender = src.slice(onRenderStart, onRenderEnd);

    assert.doesNotMatch(src, /_wwnClassAssignmentPrompted/);
    assert.match(src, /this\._wwnClassAssignmentPromptPending = false/);
    assert.match(onRender, /!this\._wwnClassAssignmentPromptPending/);
    assert.match(onRender, /this\.isEditable/);
    assert.match(onRender, /create hooks deliberately skip companion and bonus-skill/);
    assert.match(onRender, /!game\.wwn\?\.migrating/);
    assert.match(onRender, /this\.actor\.getFlag\("wwn", "needsClassAssignment"\)/);
    assert.match(onRender, /this\._wwnClassAssignmentPromptPending = true/);
    assert.match(onRender, /await maybeShowClassAssignmentDialog\(this\.actor\)/);
    assert.match(
      onRender,
      /finally\s*\{[\s\S]*this\._wwnClassAssignmentPromptPending = false/,
      "the in-flight guard must reset whether the dialog is skipped, shown, or fails"
    );
  });

  it("keeps native Edges out of the class-name header", () => {
    const sheet = read("module/sheets/actor/pc-sheet.mjs");
    const header = read("templates/actor/pc/header.hbs");
    assert.match(sheet, /context\.headerClassEdges = context\.classEdges\.filter\(isClassItem\)/);
    assert.match(header, /#if headerClassEdges\.length/);
    assert.match(header, /#each headerClassEdges as \|edge\|/);
  });
});
