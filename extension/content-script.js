(() => {
  if (window.__codexContextTranslatorLoaded) {
    return;
  }
  window.__codexContextTranslatorLoaded = true;

  const TRANSLATABLE_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "caption",
    "th",
    "td",
    "dt",
    "dd",
    "article div",
    "main div",
    "section div",
  ].join(",");
  const STRUCTURAL_UI_SELECTOR = [
    "header",
    "nav",
    "aside",
    "footer",
    "[role='banner']",
    "[role='navigation']",
    "[role='complementary']",
    "[role='contentinfo']",
    "[data-left-nav]",
    "[data-content-page-toc-rail]",
  ].join(",");
  const INTERACTIVE_SELECTOR = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='switch']",
    "[onclick]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const BLOCKING_DESCENDANT_SELECTOR = [
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='switch']",
    "[onclick]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const EXCLUDED_ANCESTOR_SELECTOR = [
    "script",
    "style",
    "noscript",
    "pre",
    "code",
    "kbd",
    "samp",
    "textarea",
    "input",
    "select",
    "svg",
    "canvas",
    STRUCTURAL_UI_SELECTOR,
    INTERACTIVE_SELECTOR,
    "[hidden]",
    "[aria-hidden='true']",
    "[contenteditable='true']",
  ].join(",");
  const BLOCK_DESCENDANT_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "caption",
    "th",
    "td",
    "dt",
    "dd",
  ].join(",");
  const TRANSLATED_CLASS = "codex-context-translator-translated";
  const STYLE_ID = "codex-context-translator-style";
  const INLINE_LINK_SELECTOR = "a[href]";
  const LINK_TOKEN_PREFIX = "CTX-LINK-";
  const LINK_MARKER_PATTERN = /\[\[(CTX-LINK-\d+)\]\]([\s\S]*?)\[\[\/\1\]\]/g;
  const ANY_LINK_MARKER_PATTERN = /\[\[\/?CTX-LINK-\d+\]\]/g;
  const MAX_CONTEXT_ITEMS = 40;
  const MAX_CONTEXT_SNIPPET_CHARS = 180;
  const ESTIMATE_MAX_PARAGRAPHS_PER_RUN = 40;
  const ESTIMATE_MAX_TARGET_CHARS_PER_RUN = 12000;
  const ESTIMATE_MAX_PARALLEL_RUNS = 3;

  const state = {
    inProgress: false,
    originals: new Map(),
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CODEX_TRANSLATOR_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "CODEX_TRANSLATE_PAGE") {
      translatePage().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
      return true;
    }

    if (message?.type === "CODEX_RESTORE_PAGE") {
      const restored = restoreOriginals();
      sendResponse({ ok: true, restored });
      return false;
    }

    return false;
  });

  async function translatePage() {
    if (state.inProgress) {
      throw new Error("이미 번역 중입니다.");
    }

    const startedAt = Date.now();
    let metrics = null;

    state.inProgress = true;
    ensureStyle();

    try {
      publishStatus("collecting", "번역할 단락을 찾는 중입니다.", null, null, { startedAt });
      const items = collectItems();

      if (items.length === 0) {
        throw new Error("번역할 단락을 찾지 못했습니다.");
      }

      metrics = estimateTranslationWork(items);
      const context = buildContext(items);
      const page = getPageInfo();
      publishStatus("translating", `${items.length}개 단락을 자동 번역 중입니다.`, 0, items.length, {
        startedAt,
        metrics,
      });

      const response = await sendRuntimeMessage({
        type: "CODEX_LOCAL_TRANSLATE",
        payload: {
          page,
          context,
          paragraphs: items.map((item) => ({
            id: item.id,
            text: item.text,
          })),
        },
      });

      if (!response?.ok) {
        throw new Error(response?.error || "로컬 번역 서버 오류입니다.");
      }

      const translatedCount = applyTranslations(items, response.translations || []);
      const elapsedMs = Date.now() - startedAt;
      publishStatus("done", `${translatedCount}개 단락을 번역했습니다.`, translatedCount, items.length, {
        startedAt,
        elapsedMs,
        metrics,
      });
      return { ok: true, translated: translatedCount, elapsedMs, metrics };
    } finally {
      state.inProgress = false;
    }
  }

  function collectItems() {
    const nodes = collectCandidateNodes();
    const items = [];
    const seen = new Set();

    for (const element of nodes) {
      if (!(element instanceof HTMLElement) || seen.has(element)) {
        continue;
      }

      const text = getCandidateText(element);

      if (!isCandidateElement(element, text)) {
        continue;
      }

      seen.add(element);
      const id = getOrCreateElementId(element, items.length + 1);
      const serialized = serializeCandidateText(element, text);
      items.push({ id, element, text: serialized.text, links: serialized.links });
    }

    return items;
  }

  function collectCandidateNodes() {
    if (!document.body) {
      return [];
    }
    return Array.from(document.body.querySelectorAll(TRANSLATABLE_SELECTOR));
  }

  function getCandidateText(element) {
    const tagName = element.tagName.toLowerCase();

    if (tagName === "div") {
      return normalizeText(
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" "),
      );
    }

    return normalizeText(element.innerText || element.textContent || "");
  }

  function isCandidateElement(element, text) {
    if (!text || text.length < 2 || element.classList.contains(TRANSLATED_CLASS)) {
      return false;
    }

    if (element.closest(EXCLUDED_ANCESTOR_SELECTOR)) {
      return false;
    }

    if (element.querySelector(BLOCKING_DESCENDANT_SELECTOR)) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === "div") {
      if (text.length < 40 || element.querySelector(BLOCK_DESCENDANT_SELECTOR)) {
        return false;
      }
    }

    if (!isVisible(element) || isMostlyNonText(text) || isMostlyKorean(text)) {
      return false;
    }

    return true;
  }

  function serializeCandidateText(element, fallbackText) {
    const links = [];

    if (!element.querySelector(INLINE_LINK_SELECTOR)) {
      return { text: fallbackText, links };
    }

    const text = normalizeText(
      Array.from(element.childNodes)
        .map((node) => serializeNodeText(node, links))
        .join(" "),
    );

    return {
      text: text || fallbackText,
      links,
    };
  }

  function serializeNodeText(node, links) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;

    if (element.matches(INLINE_LINK_SELECTOR)) {
      const token = `${LINK_TOKEN_PREFIX}${links.length + 1}`;
      const text = normalizeText(element.innerText || element.textContent || "");
      links.push({ token, element });
      return `[[${token}]]${text}[[/${token}]]`;
    }

    if (element.closest(EXCLUDED_ANCESTOR_SELECTOR)) {
      return "";
    }

    return Array.from(element.childNodes)
      .map((child) => serializeNodeText(child, links))
      .join(" ");
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") === 0
    ) {
      return false;
    }

    return element.getClientRects().length > 0;
  }

  function isMostlyNonText(text) {
    const letters = text.match(/[A-Za-z\u00C0-\u024F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g) || [];
    return letters.length < 2;
  }

  function isMostlyKorean(text) {
    const letters = text.match(/[A-Za-z\u00C0-\u024F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g) || [];
    const hangul = text.match(/[\uAC00-\uD7AF]/g) || [];

    if (letters.length === 0) {
      return false;
    }

    return hangul.length / letters.length > 0.6;
  }

  function getOrCreateElementId(element, index) {
    if (!element.dataset.codexContextTranslatorId) {
      element.dataset.codexContextTranslatorId = `ctx-${Date.now()}-${index}`;
    }
    return element.dataset.codexContextTranslatorId;
  }

  function buildContext(items) {
    const context = [];
    const title = normalizeText(document.title || "");
    const description = getMetaDescription();

    if (title) {
      context.push(`Title: ${title}`);
    }
    if (description) {
      context.push(`Description: ${description}`);
    }

    for (const item of items.slice(0, MAX_CONTEXT_ITEMS)) {
      context.push(item.text.slice(0, MAX_CONTEXT_SNIPPET_CHARS));
    }

    return context;
  }

  function estimateTranslationWork(items) {
    let batchCount = 0;
    let batchItems = 0;
    let batchChars = 0;
    let targetChars = 0;

    for (const item of items) {
      const textLength = item.text.length;
      const nextBatchChars = batchChars + textLength;
      const shouldStartNewBatch =
        batchItems > 0 &&
        (batchItems >= ESTIMATE_MAX_PARAGRAPHS_PER_RUN ||
          nextBatchChars > ESTIMATE_MAX_TARGET_CHARS_PER_RUN);

      if (shouldStartNewBatch) {
        batchCount += 1;
        batchItems = 0;
        batchChars = 0;
      }

      batchItems += 1;
      batchChars += textLength;
      targetChars += textLength;
    }

    if (batchItems > 0) {
      batchCount += 1;
    }

    const parallelRuns = Math.min(ESTIMATE_MAX_PARALLEL_RUNS, batchCount || 1);

    return {
      targetCount: items.length,
      targetChars,
      batchCount,
      parallelRuns,
      waveCount: Math.ceil(batchCount / parallelRuns),
    };
  }

  function getPageInfo() {
    return {
      title: document.title || "",
      url: window.location.href,
      language: document.documentElement.lang || "",
      description: getMetaDescription(),
    };
  }

  function getMetaDescription() {
    const element = document.querySelector("meta[name='description'], meta[property='og:description']");
    return normalizeText(element?.getAttribute("content") || "");
  }

  function applyTranslations(batch, translations) {
    const byId = new Map(translations.map((item) => [item.id, item.text]));
    let applied = 0;

    for (const item of batch) {
      const translatedText = byId.get(item.id);

      if (!translatedText) {
        continue;
      }

      if (!state.originals.has(item.id)) {
        state.originals.set(item.id, {
          element: item.element,
          html: item.element.innerHTML,
        });
      }

      applyTranslationText(item, translatedText);
      item.element.classList.add(TRANSLATED_CLASS);
      applied += 1;
    }

    return applied;
  }

  function applyTranslationText(item, translatedText) {
    const fragment = buildLinkedTranslationFragment(translatedText, item.links || []);

    if (fragment) {
      item.element.replaceChildren(fragment);
      return;
    }

    item.element.textContent = stripLinkMarkers(translatedText);
  }

  function buildLinkedTranslationFragment(translatedText, links) {
    if (!links.length) {
      return null;
    }

    const linkByToken = new Map(links.map((link) => [link.token, link.element]));
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let matchedLinks = 0;
    let match;

    LINK_MARKER_PATTERN.lastIndex = 0;
    while ((match = LINK_MARKER_PATTERN.exec(translatedText))) {
      const [fullMatch, token, label] = match;
      const link = linkByToken.get(token);

      if (!link) {
        continue;
      }

      appendTextNode(fragment, translatedText.slice(lastIndex, match.index));
      const clone = link.cloneNode(false);
      clone.textContent = stripLinkMarkers(label).trim() || normalizeText(link.innerText || link.textContent || "");
      fragment.append(clone);
      lastIndex = match.index + fullMatch.length;
      matchedLinks += 1;
    }

    if (matchedLinks === 0) {
      return null;
    }

    appendTextNode(fragment, translatedText.slice(lastIndex));
    return fragment;
  }

  function appendTextNode(fragment, text) {
    const cleaned = stripLinkMarkers(text);

    if (cleaned) {
      fragment.append(document.createTextNode(cleaned));
    }
  }

  function stripLinkMarkers(text) {
    return String(text || "").replace(ANY_LINK_MARKER_PATTERN, "");
  }

  function restoreOriginals() {
    let restored = 0;

    for (const [id, original] of state.originals.entries()) {
      const escapedId = window.CSS?.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
      const element = original.element?.isConnected
        ? original.element
        : document.querySelector(`[data-codex-context-translator-id="${escapedId}"]`);

      if (!element) {
        continue;
      }

      element.innerHTML = original.html;
      element.classList.remove(TRANSLATED_CLASS);
      restored += 1;
    }

    state.originals.clear();
    publishStatus("restored", `${restored}개 단락을 복원했습니다.`);
    return restored;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${TRANSLATED_CLASS} {
        background: rgba(255, 248, 184, 0.5) !important;
        outline: 1px solid rgba(190, 141, 0, 0.22) !important;
        transition: background 160ms ease;
      }
    `;
    document.documentElement.append(style);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function publishStatus(phase, message, current = null, total = null, extra = {}) {
    try {
      chrome.runtime.sendMessage(
        {
          type: "CODEX_TRANSLATION_STATUS",
          status: { phase, message, current, total, ...extra },
        },
        () => {
          void chrome.runtime.lastError;
        },
      );
    } catch {
      // The popup may be closed; translation can continue without status UI.
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
})();
