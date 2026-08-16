import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasRenderableDescription } from "../module/chat/item-description.mjs";

describe("hasRenderableDescription", () => {
  it("rejects empty and tag-only markup", () => {
    assert.equal(hasRenderableDescription(""), false);
    assert.equal(hasRenderableDescription("   "), false);
    assert.equal(hasRenderableDescription("<p></p>"), false);
    assert.equal(hasRenderableDescription("<p><br></p>"), false);
  });

  it("accepts real text, including HTML wrappers", () => {
    assert.equal(hasRenderableDescription("A short sword."), true);
    assert.equal(hasRenderableDescription("<p>A short sword.</p>"), true);
  });
});
