/**
 * @skill formula terms are case-insensitive (@Stab, @stab, @sTaB).
 * Run: node --test tests/roll-data-case.test.mjs
 */
import "../build/foundry-shim.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { caseInsensitiveRollData } from "../module/helpers/roll-data.mjs";

describe("caseInsensitiveRollData", () => {
  it("resolves @Stab, @stab, and @sTaB to the same skill level", () => {
    const data = caseInsensitiveRollData({ stab: 2, strScore: 14 });
    assert.equal(foundry.utils.getProperty(data, "stab"), 2);
    assert.equal(foundry.utils.getProperty(data, "Stab"), 2);
    assert.equal(foundry.utils.getProperty(data, "sTaB"), 2);
    assert.equal("Stab" in data, true);
    assert.equal("sTaB" in data, true);
    assert.equal(foundry.dice.Roll.replaceFormulaData("3d8 + @Stab", data), "3d8 + 2");
    assert.equal(foundry.dice.Roll.replaceFormulaData("3d8 + @sTaB", data), "3d8 + 2");
  });

  it("still prefers an exact camelCase key over a lowercased miss", () => {
    const data = caseInsensitiveRollData({ strScore: 14 });
    assert.equal(foundry.utils.getProperty(data, "strScore"), 14);
  });
});
