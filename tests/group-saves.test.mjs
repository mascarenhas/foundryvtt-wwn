/**
 * Group saving throws from chat cards (modifier dialog + grouped results).
 * Run: node --test tests/group-saves.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveTokenModifiers,
  evaluateSaveOutcome,
  formatSaveRollDetail,
  buildSaveResult,
  sortSaveResults,
  partitionSaveResults,
  tokenRef,
  parseTokenRef,
  findTokensByRefs,
  buildGroupSaveCardContext,
} from "../module/chat/group-saves.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("resolveTokenModifiers", () => {
  const tokens = [{ id: "a" }, { id: "b" }];

  it("applies the global modifier when overrides are empty", () => {
    assert.deepEqual(
      resolveTokenModifiers({ globalModifier: "2", overrides: { a: "", b: "" } }, tokens),
      { a: 2, b: 2 }
    );
  });

  it("lets a per-token override replace the global modifier", () => {
    assert.deepEqual(
      resolveTokenModifiers({ globalModifier: "2", overrides: { a: "-1", b: "" } }, tokens),
      { a: -1, b: 2 }
    );
  });

  it("treats a typed zero as an override, not as empty", () => {
    assert.deepEqual(
      resolveTokenModifiers({ globalModifier: "3", overrides: { a: "0", b: "" } }, tokens),
      { a: 0, b: 3 }
    );
  });
});

describe("save outcomes", () => {
  it("succeeds on the target or higher", () => {
    assert.deepEqual(evaluateSaveOutcome(15, 15), { isSuccess: true, isFailure: false });
    assert.deepEqual(evaluateSaveOutcome(14, 15), { isSuccess: false, isFailure: true });
  });

  it("formats roll vs target without repeating the modifier", () => {
    assert.equal(formatSaveRollDetail({ total: 18, modifier: 0, target: 15 }), "18 vs 15");
    assert.equal(formatSaveRollDetail({ total: 20, modifier: 2, target: 15 }), "20 vs 15");
    assert.equal(formatSaveRollDetail({ total: 12, modifier: -1, target: 15 }), "12 vs 15");
  });

  it("builds a result row and partitions success from failure", () => {
    const passed = buildSaveResult({ name: "Alak", tokenId: "s.t1", total: 16, target: 15, modifier: 0 });
    const failed = buildSaveResult({ name: "Goblin", tokenId: "s.t2", total: 8, target: 15, modifier: 1 });
    assert.equal(passed.isSuccess, true);
    assert.equal(failed.isFailure, true);
    assert.equal(failed.detail, "8 vs 15");

    const sorted = sortSaveResults([failed, passed]);
    assert.deepEqual(sorted.map((r) => r.name), ["Alak", "Goblin"]);

    const groups = partitionSaveResults(sorted);
    assert.deepEqual(groups.successful.map((r) => r.name), ["Alak"]);
    assert.deepEqual(groups.failed.map((r) => r.name), ["Goblin"]);
  });
});

describe("token refs", () => {
  it("builds and parses scene.token refs", () => {
    assert.equal(tokenRef({ id: "tok1", scene: { id: "sc1" } }), "sc1.tok1");
    assert.deepEqual(parseTokenRef("sc1.tok1"), { sceneId: "sc1", tokenId: "tok1" });
    assert.deepEqual(parseTokenRef("tok1"), { sceneId: null, tokenId: "tok1" });
  });

  it("finds matching placeables for a group of refs", () => {
    const placeables = [
      { id: "tok1", scene: { id: "sc1" } },
      { id: "tok2", scene: { id: "sc1" } },
      { id: "tok3", scene: { id: "sc2" } },
    ];
    const found = findTokensByRefs(["sc1.tok1", "sc1.tok2"], placeables);
    assert.deepEqual(found.map((t) => t.id), ["tok1", "tok2"]);
  });
});

describe("group save card context", () => {
  it("exposes select-button flags for each outcome group", () => {
    const results = [
      buildSaveResult({ name: "Alak", tokenId: "s.t1", total: 16, target: 15, modifier: 0 }),
      buildSaveResult({ name: "Goblin", tokenId: "s.t2", total: 8, target: 15, modifier: 0 }),
    ];
    const ctx = buildGroupSaveCardContext(results);
    assert.equal(ctx.hasSuccessfulSaves, true);
    assert.equal(ctx.hasFailedSaves, true);
    assert.deepEqual(ctx.successfulTokenIds, ["s.t1"]);
    assert.deepEqual(ctx.failedTokenIds, ["s.t2"]);
  });
});

describe("group save wiring", () => {
  it("prompts for modifiers instead of skipping the dialog", () => {
    const src = fs.readFileSync(path.join(root, "module/chat/chat-listener.mjs"), "utf8");
    assert.match(src, /rollCardGroupSave|promptGroupSave/);
    assert.doesNotMatch(src, /rollSave\(actor, saveId, \{ skipDialog: true \}\)/);
  });

  it("omits the Succeeds-on-X+ column from the roll table", () => {
    const src = fs.readFileSync(path.join(root, "module/chat/group-saves.mjs"), "utf8");
    assert.doesNotMatch(src, /SaveTarget/);
    assert.doesNotMatch(src, /detail:\s*game\.i18n/);
    const tpl = fs.readFileSync(path.join(root, "templates/chat/group-save-body.hbs"), "utf8");
    assert.match(tpl, /wwn-chat-save-detail/);
  });

  it("can select successful or failed tokens from the results card", () => {
    const src = fs.readFileSync(path.join(root, "module/chat/chat-listener.mjs"), "utf8");
    assert.match(src, /selectSaveGroup/);
    const tpl = fs.readFileSync(path.join(root, "templates/chat/group-save-body.hbs"), "utf8");
    assert.match(tpl, /data-action="selectSaveGroup"/);
    assert.match(tpl, /Successful/);
    assert.match(tpl, /Failed/);
  });
});
