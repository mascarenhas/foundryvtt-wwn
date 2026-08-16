/**
 * Theme tokens must keep prose fields readable in every UI theme.
 * Foundry's <prose-mirror> / CodeMirror follow --color-scheme and
 * --input-*-color; custom theme-* classes do not get core light/dark mixins.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "../module/config/themes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themesDir = path.join(__dirname, "..", "scss", "themes");

const REQUIRED_TOKENS = [
  "--color-scheme",
  "--wwn-text",
  "--wwn-bg-solid",
  "--wwn-input-bg",
  "--color-text-primary",
  "--input-text-color",
  "--input-background-color",
];

/** @param {string} scss */
function parseThemeTokens(scss) {
  const tokens = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(scss))) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** @param {Record<string, string>} tokens @param {string} value @param {number} [depth] */
function resolveTokenValue(tokens, value, depth = 0) {
  if (!value || depth > 8) return value;
  const match = value.match(/^var\(\s*([a-z0-9-]+)/i);
  if (!match) return value;
  const next = tokens[match[1]];
  if (!next) return value;
  return resolveTokenValue(tokens, next, depth + 1);
}

/** @param {string} value */
function parseCssColor(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  return null;
}

/** @param {{r:number,g:number,b:number}} color */
function relativeLuminance({ r, g, b }) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** @param {{r:number,g:number,b:number,a:number}} fg @param {{r:number,g:number,b:number,a:number}} bg */
function contrastRatio(fg, bg) {
  const under = bg.a >= 1 ? bg : {
    r: bg.r * bg.a + 255 * (1 - bg.a),
    g: bg.g * bg.a + 255 * (1 - bg.a),
    b: bg.b * bg.a + 255 * (1 - bg.a),
    a: 1,
  };
  const over = fg.a >= 1 ? fg : {
    r: fg.r * fg.a + under.r * (1 - fg.a),
    g: fg.g * fg.a + under.g * (1 - fg.a),
    b: fg.b * fg.a + under.b * (1 - fg.a),
    a: 1,
  };
  const l1 = relativeLuminance(over);
  const l2 = relativeLuminance(under);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** @param {{r:number,g:number,b:number,a:number}} fg @param {{r:number,g:number,b:number,a:number}} bg */
function compositeOver(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

describe("theme prose contrast", () => {
  const themeKeys = Object.keys(THEMES);
  assert.ok(themeKeys.length >= 4, "expected wwn/swn/awn/cwn themes");

  for (const key of themeKeys) {
    describe(key, () => {
      const scss = fs.readFileSync(path.join(themesDir, `_${key}.scss`), "utf8");
      const tokens = parseThemeTokens(scss);

      it("declares Foundry tokens that prose editors inherit", () => {
        for (const name of REQUIRED_TOKENS) {
          assert.ok(tokens[name], `${key} is missing ${name}`);
        }
        assert.equal(tokens["--color-scheme"], THEMES[key].colorScheme);
      });

      it("maps primary and input text to the theme body color", () => {
        const text = resolveTokenValue(tokens, tokens["--wwn-text"]);
        assert.equal(resolveTokenValue(tokens, tokens["--color-text-primary"]), text);
        assert.equal(resolveTokenValue(tokens, tokens["--input-text-color"]), text);
      });

      it("keeps body and editor text readable on theme surfaces", () => {
        const text = parseCssColor(resolveTokenValue(tokens, tokens["--wwn-text"]));
        const solid = parseCssColor(resolveTokenValue(tokens, tokens["--wwn-bg-solid"]));
        const input = parseCssColor(resolveTokenValue(tokens, tokens["--wwn-input-bg"]));
        assert.ok(text, `${key} --wwn-text is not a parseable color`);
        assert.ok(solid, `${key} --wwn-bg-solid is not a parseable color`);
        assert.ok(input, `${key} --wwn-input-bg is not a parseable color`);

        const editorSurface = compositeOver(input, solid);
        const bodyContrast = contrastRatio(text, solid);
        const editorContrast = contrastRatio(text, editorSurface);
        assert.ok(
          bodyContrast >= 4.5,
          `${key} --wwn-text vs --wwn-bg-solid contrast ${bodyContrast.toFixed(2)} < 4.5`
        );
        assert.ok(
          editorContrast >= 4.5,
          `${key} --wwn-text vs editor surface contrast ${editorContrast.toFixed(2)} < 4.5`
        );
      });
    });
  }

  it("overrides baked-in light-theme inline colors inside every WWN prose editor", () => {
    const chrome = fs.readFileSync(path.join(__dirname, "..", "scss", "wwn", "_sheet-chrome.scss"), "utf8");
    assert.match(chrome, /\.wwn\s+prose-mirror/);
    assert.match(chrome, /\[style\*=["']color["']\]/);
    assert.match(chrome, /color:\s*inherit\s*!important/);
  });
});
