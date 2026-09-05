import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightedExactText } from "../app/desktop/structured-today-span-dialog";

test("exact transcript text renders only the verified substring as semantic mark", () => {
  const html = renderToStaticMarkup(createElement(HighlightedExactText, {
    content: "前缀😀精确证据后缀",
    start: 2,
    end: 8
  }));
  assert.match(html, /前缀<mark data-evidence-highlight="true">😀精确证据<\/mark>后缀/u);
});

test("invalid highlight coordinates render plain text without guessing", () => {
  const html = renderToStaticMarkup(createElement(HighlightedExactText, {
    content: "完整文本",
    start: 9,
    end: 12
  }));
  assert.doesNotMatch(html, /<mark/u);
  assert.match(html, /完整文本/u);
});
