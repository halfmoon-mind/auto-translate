#!/usr/bin/env node

// Loads the real content-script closure with stubbed browser globals and
// checks the quality-validation decisions, including the format-marker-only
// degradation path.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTENT_SCRIPT_PATH = path.join(__dirname, "..", "extension", "content-script.js");

const api = loadContentScriptInternals();

const item = {
  id: "ctx-test-1",
  kind: "list_item",
  text:
    "[[CTX-FMT-1]]Working code is not free.[[/CTX-FMT-1]] They say [[CTX-FMT-2]]everyone[[/CTX-FMT-2]] " +
    "should write code, with a boundary where they [[CTX-FMT-3]]can[[/CTX-FMT-3]] participate. " +
    "See [[CTX-LINK-1]]the 2024 post[[/CTX-LINK-1]] and [[CTX-PRESERVE-1]].",
  links: [{ token: "CTX-LINK-1" }],
  preservedNodes: [{ token: "CTX-PRESERVE-1" }],
  formatNodes: [{ token: "CTX-FMT-1" }, { token: "CTX-FMT-2" }, { token: "CTX-FMT-3" }],
};

const validText =
  "[[CTX-FMT-1]]동작하는 코드는 공짜가 아닙니다.[[/CTX-FMT-1]] [[CTX-FMT-2]]모두[[/CTX-FMT-2]]가 코드를 " +
  "작성해야 한다고 하지만, [[CTX-FMT-3]]참여할 수 있는[[/CTX-FMT-3]] 경계가 있는지의 문제입니다. " +
  "[[CTX-LINK-1]]2024년 글[[/CTX-LINK-1]]과 [[CTX-PRESERVE-1]]을 보세요.";

// Sanity: a fully conforming translation validates.
api.validateTranslationQuality(item, validText);

// The reported case: the model dropped the CTX-FMT-3 pair.
const droppedFormatPair = validText.replace("[[CTX-FMT-3]]", "").replace("[[/CTX-FMT-3]]", "");
assert.throws(() => api.validateTranslationQuality(item, droppedFormatPair), /서식 마커/);
assert.equal(api.isFormatMarkerOnlyFailure(item, droppedFormatPair), true);

// Half-dropped pair (only the close marker survived) is still format-only.
const droppedOpenMarker = validText.replace("[[CTX-FMT-3]]", "");
assert.equal(api.isFormatMarkerOnlyFailure(item, droppedOpenMarker), true);

// A duplicated format pair is format-only.
const duplicatedFormatPair = validText.replace(
  "[[CTX-FMT-2]]모두[[/CTX-FMT-2]]",
  "[[CTX-FMT-2]]모두[[/CTX-FMT-2]] [[CTX-FMT-2]]모두[[/CTX-FMT-2]]",
);
assert.equal(api.isFormatMarkerOnlyFailure(item, duplicatedFormatPair), true);

// An invented format marker the source never had is format-only.
assert.equal(api.isFormatMarkerOnlyFailure(item, `${validText} [[CTX-FMT-9]]`), true);

// A broken link marker must stay a hard failure.
const droppedLinkMarker = droppedFormatPair.replace("[[CTX-LINK-1]]", "");
assert.equal(api.isFormatMarkerOnlyFailure(item, droppedLinkMarker), false);

// A missing preserve token must stay a hard failure.
const droppedPreserveToken = droppedFormatPair.replace("[[CTX-PRESERVE-1]]", "");
assert.equal(api.isFormatMarkerOnlyFailure(item, droppedPreserveToken), false);

// Broken format markers plus a missing number must stay a hard failure.
const numberItem = { ...item, text: `${item.text} It costs $12.` };
const missingNumber = droppedFormatPair;
assert.equal(api.isFormatMarkerOnlyFailure(numberItem, missingNumber), false);

// The reported case: wrong-script characters leaking into the Korean output
// ("ذهن적 모델") must fail validation and must never degrade to "apply anyway".
const foreignScript = validText.replace("동작하는", "ذهن적");
assert.throws(() => api.validateTranslationQuality(item, foreignScript), /다른 언어 문자/);
assert.equal(api.isFormatMarkerOnlyFailure(item, foreignScript), false);

// Foreign characters quoted in the source stay allowed in the translation.
const quotedItem = { ...item, text: `${item.text} The word ذهن means mind.` };
const quotedTranslation = `${validText} ذهن은 정신을 뜻합니다.`;
api.validateTranslationQuality(quotedItem, quotedTranslation);

// Latin, digits, and Han characters are normal in Korean prose.
api.validateTranslationQuality(item, `${validText} API 서버는 美 서비스입니다.`);

console.log("quality validation checks passed");

function loadContentScriptInternals() {
  const source = fs.readFileSync(CONTENT_SCRIPT_PATH, "utf8");
  const bodyStart = source.indexOf("{") + 1;
  const bodyEnd = source.lastIndexOf("})();");
  const body = source.slice(bodyStart, bodyEnd);
  const factory = new Function(
    "window",
    "chrome",
    "document",
    `${body}\nreturn { validateTranslationQuality, isFormatMarkerOnlyFailure };`,
  );

  return factory(
    {},
    { runtime: { onMessage: { addListener() {} } } },
    {},
  );
}
