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
    "body div",
    "span[dir]",
  ].join(",");
  const MAIN_CONTENT_SELECTOR = [
    "main",
    "article",
    "[role='main']",
  ].join(",");
  const SECONDARY_CONTENT_SELECTOR = [
    "aside",
    "nav",
    "[role='complementary']",
    "[role='navigation']",
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
  const INLINE_PRESERVE_SELECTOR = [
    "pre",
    "code",
    "kbd",
    "samp",
    "br",
    "wbr",
    "img",
    "picture",
    "svg",
    "canvas",
    "audio",
    "video",
    "sup",
    "sub",
    "[role='doc-noteref']",
    "[role='doc-biblioref']",
    "a[rel~='footnote']",
    "a[role='doc-noteref']",
    "a[role='doc-biblioref']",
    "a.footnote",
    "a.footnote-ref",
    "a.noteref",
    "a[href^='#fn']",
    "a[href^='#footnote']",
    "a[href^='#endnote']",
    "a[href^='#note']",
    "a[href^='#ref']",
    "span.math",
    ".math",
    "mjx-container",
    ".MathJax",
    ".MathJax_Display",
    ".katex",
    "math",
  ].join(",");
  const INLINE_FORMAT_SELECTOR = [
    "strong",
    "b",
    "em",
    "i",
    "mark",
    "small",
    "s",
    "del",
    "ins",
    "u",
    "cite",
    "abbr",
    "dfn",
    "q",
  ].join(",");
  const LINK_TOKEN_PREFIX = "CTX-LINK-";
  const PRESERVE_TOKEN_PREFIX = "CTX-PRESERVE-";
  const FORMAT_TOKEN_PREFIX = "CTX-FMT-";
  const INLINE_MARKER_PATTERN = /\[\[(\/?CTX-(?:LINK|FMT|PRESERVE)-\d+)\]\]/g;
  const ANY_LINK_MARKER_PATTERN = /\[\[\/?CTX-LINK-\d+\]\]/g;
  const ANY_PRESERVE_MARKER_PATTERN = /\[\[\/?CTX-PRESERVE-\d+\]\]/g;
  const ANY_FORMAT_MARKER_PATTERN = /\[\[\/?CTX-FMT-\d+\]\]/g;
  const MAX_CONTEXT_ITEMS = 4;
  const MAX_CONTEXT_SNIPPET_CHARS = 100;
  // Must match MAX_ITEM_CHARS in server/translator.js.
  const MAX_ITEM_CHARS = 12000;
  const ESTIMATE_MAX_PARAGRAPHS_PER_RUN = 18;
  const ESTIMATE_MAX_TARGET_CHARS_PER_RUN = 6000;
  const PRIORITY_BATCH_MAX_PARAGRAPHS = 8;
  const PRIORITY_BATCH_MAX_TARGET_CHARS = 2500;
  const COLLECT_RETRY_DELAYS_MS = [250, 750];
  const MAX_RETRY_SPLIT_DEPTH = 6;
  const MAX_SINGLE_ITEM_QUALITY_RETRIES = 1;
  const MAX_TRANSLATION_CACHE_ENTRIES = 500;
  const QUALITY_ERROR_PREFIX = "번역 품질 검증 실패";

  const state = {
    inProgress: false,
    lastStatus: null,
    originals: new Map(),
    translationCache: new Map(),
    inflightTranslations: new Map(),
    activeItems: null,
    partialApplied: new Set(),
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CODEX_TRANSLATOR_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "CODEX_GET_TRANSLATION_STATUS") {
      sendResponse({ ok: true, status: state.lastStatus });
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

    if (message?.type === "CODEX_TRANSLATE_PARTIAL") {
      applyPartialTranslations(message.translations || []);
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
    let sessionId = null;
    const clientTimings = {};

    state.inProgress = true;
    ensureStyle();

    try {
      publishStatus("collecting", "번역할 단락을 찾는 중입니다.", null, null, { startedAt });
      const collectStartedAt = Date.now();
      const items = await collectItemsWhenReady();
      clientTimings.collectMs = Date.now() - collectStartedAt;

      if (items.length === 0) {
        throw new Error("번역할 단락을 찾지 못했습니다.");
      }

      const prioritizedItems = prioritizeItems(items);
      const batches = createTranslationBatches(prioritizedItems);
      metrics = estimateTranslationWork(items, batches);
      const context = buildContext(items);
      const page = getPageInfo();
      state.activeItems = new Map(prioritizedItems.map((item) => [item.id, item]));
      state.partialApplied = new Set();
      publishStatus("translating", `${items.length}개 단락을 자동 번역 중입니다.`, 0, items.length, {
        startedAt,
        metrics,
      });
      const sessionStartedAt = Date.now();
      const session = await startTranslationSession();
      clientTimings.sessionStartMs = Date.now() - sessionStartedAt;
      sessionId = session.sessionId;
      metrics = addProjectedUsage(metrics, context, session.pricing);
      publishStatus("translating", `${items.length}개 단락을 자동 번역 중입니다.`, 0, items.length, {
        startedAt,
        metrics,
      });

      const result = await translateBatches({
        batches,
        page,
        context,
        startedAt,
        metrics,
        totalItems: items.length,
        sessionId,
      });

      const elapsedMs = Date.now() - startedAt;
      const timings = mergeTimingValues(clientTimings, result.timings);
      timings.totalElapsedMs = elapsedMs;
      const message = result.failed
        ? `${result.translated}개 단락을 번역했고 ${result.failed}개는 실패했습니다.`
        : `${result.translated}개 단락을 번역했습니다.`;
      publishStatus("done", message, result.translated + result.failed, items.length, {
        startedAt,
        elapsedMs,
        metrics,
        usage: result.usage,
        timings,
        failed: result.failed,
      });
      return {
        ok: true,
        translated: result.translated,
        failed: result.failed,
        elapsedMs,
        metrics,
        usage: result.usage,
        timings,
      };
    } catch (error) {
      publishStatus("failed", getErrorMessage(error), null, null, {
        startedAt,
        elapsedMs: Date.now() - startedAt,
        metrics,
        timings: clientTimings,
      });
      throw error;
    } finally {
      // The session stays open on purpose: the background keeps it (and the
      // warm codex app-server) alive for the next translation.
      state.inProgress = false;
      state.inflightTranslations.clear();
      state.activeItems = null;
    }
  }

  function collectItems() {
    return collectItemsFromNodes(collectCandidateNodes());
  }

  async function collectItemsWhenReady() {
    let items = collectItems();

    for (const delayMs of COLLECT_RETRY_DELAYS_MS) {
      if (items.length > 0) {
        return items;
      }

      await wait(delayMs);
      items = collectItems();
    }

    return items;
  }

  function collectItemsFromNodes(nodes) {
    const items = [];
    const seen = new Set();

    for (const element of nodes) {
      if (
        !(element instanceof HTMLElement) ||
        seen.has(element) ||
        hasSelectedAncestor(element, seen)
      ) {
        continue;
      }

      const text = getCandidateText(element);

      if (!isCandidateElement(element, text)) {
        continue;
      }

      const serialized = serializeCandidateText(element, text);
      if (isPreserveOnlyText(serialized.text)) {
        continue;
      }
      // ponytail: oversize single blocks stay untranslated; split at sentence
      // boundaries if this ever matters in practice.
      if (serialized.text.length > MAX_ITEM_CHARS) {
        continue;
      }

      seen.add(element);
      const id = getOrCreateElementId(element, items.length + 1);
      items.push({
        id,
        element,
        kind: getTranslationKind(element),
        text: serialized.text,
        links: serialized.links,
        preservedNodes: serialized.preservedNodes,
        formatNodes: serialized.formatNodes,
        fullWrapLink: serialized.fullWrapLink,
      });
    }

    return items;
  }

  function wait(delayMs) {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function hasSelectedAncestor(element, selectedElements) {
    let parent = element.parentElement;

    while (parent) {
      if (selectedElements.has(parent)) {
        return true;
      }

      parent = parent.parentElement;
    }

    return false;
  }

  function collectCandidateNodes() {
    if (!document.body) {
      return [];
    }

    return Array.from(document.body.querySelectorAll(TRANSLATABLE_SELECTOR));
  }

  function getCandidateText(element) {
    return normalizeText(element.innerText || element.textContent || "");
  }

  function getTranslationKind(element) {
    const tagName = element.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tagName)) {
      return "heading";
    }
    if (tagName === "li") {
      return "list_item";
    }
    if (tagName === "blockquote") {
      return "quote";
    }
    if (tagName === "figcaption" || tagName === "caption") {
      return "caption";
    }
    if (tagName === "th" || tagName === "td") {
      return "table_cell";
    }
    if (tagName === "dt" || tagName === "dd") {
      return "definition";
    }

    return "paragraph";
  }

  function isCandidateElement(element, text) {
    if (!text || text.length < 2 || element.classList.contains(TRANSLATED_CLASS)) {
      return false;
    }

    if (element.closest(EXCLUDED_ANCESTOR_SELECTOR)) {
      return false;
    }

    if (hasBlockingDescendant(element)) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === "div") {
      if (
        text.length < 40 ||
        element.querySelector(BLOCK_DESCENDANT_SELECTOR) ||
        element.querySelector("div")
      ) {
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
    const preservedNodes = [];
    const formatNodes = [];
    const inlineSelector = [
      INLINE_LINK_SELECTOR,
      INLINE_PRESERVE_SELECTOR,
      INLINE_FORMAT_SELECTOR,
    ].join(",");

    if (!element.querySelector(inlineSelector)) {
      return { text: fallbackText, links, preservedNodes, formatNodes, fullWrapLink: null };
    }

    const text = normalizeText(
      Array.from(element.childNodes)
        .map((node) => serializeNodeText(node, links, preservedNodes, formatNodes))
        .join(""),
    );

    return {
      ...unwrapFullLink(text || fallbackText, links),
      preservedNodes,
      formatNodes,
    };
  }

  // A target that is one single link wrapping the whole text (nav items, list
  // links) tempts the model into dropping the wrapper markers. Send the bare
  // label instead and re-wrap with the remembered link element on apply.
  function unwrapFullLink(text, links) {
    if (links.length !== 1) {
      return { text, links, fullWrapLink: null };
    }

    const openMarker = `[[${links[0].token}]]`;
    const closeMarker = `[[/${links[0].token}]]`;

    if (
      !text.startsWith(openMarker) ||
      !text.endsWith(closeMarker) ||
      countOccurrences(text, openMarker) !== 1 ||
      countOccurrences(text, closeMarker) !== 1
    ) {
      return { text, links, fullWrapLink: null };
    }

    return {
      text: text.slice(openMarker.length, text.length - closeMarker.length).trim(),
      links: [],
      fullWrapLink: links[0].element,
    };
  }

  function serializeNodeText(node, links, preservedNodes, formatNodes, withinInline = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;

    if (isInlinePreserveElement(element)) {
      const token = `${PRESERVE_TOKEN_PREFIX}${preservedNodes.length + 1}`;
      preservedNodes.push({ token, element });
      return `[[${token}]]`;
    }

    if (element.matches(INLINE_LINK_SELECTOR)) {
      const token = `${LINK_TOKEN_PREFIX}${links.length + 1}`;
      links.push({ token, element });
      const text = serializeElementChildren(element, links, preservedNodes, formatNodes, true);
      return `[[${token}]]${text}[[/${token}]]`;
    }

    if (element.matches(INLINE_FORMAT_SELECTOR)) {
      const token = `${FORMAT_TOKEN_PREFIX}${formatNodes.length + 1}`;
      formatNodes.push({ token, element });
      const text = serializeElementChildren(element, links, preservedNodes, formatNodes, true);
      return `[[${token}]]${text}[[/${token}]]`;
    }

    if (!withinInline && element.closest(EXCLUDED_ANCESTOR_SELECTOR)) {
      return "";
    }

    return serializeElementChildren(element, links, preservedNodes, formatNodes, withinInline);
  }

  function serializeElementChildren(element, links, preservedNodes, formatNodes, withinInline) {
    return Array.from(element.childNodes)
      .map((child) => serializeNodeText(child, links, preservedNodes, formatNodes, withinInline))
      .join("");
  }

  function isInlinePreserveElement(element) {
    if (!element.matches(INLINE_PRESERVE_SELECTOR)) {
      return false;
    }

    if (element.matches(INLINE_LINK_SELECTOR)) {
      return isFootnoteReferenceElement(element);
    }

    return true;
  }

  function isFootnoteReferenceElement(element) {
    const text = normalizeText(element.innerText || element.textContent || "");
    const href = String(element.getAttribute("href") || "").toLowerCase();
    const rel = String(element.getAttribute("rel") || "").toLowerCase();
    const role = String(element.getAttribute("role") || "").toLowerCase();

    if (
      element.closest("sup,sub") ||
      role === "doc-noteref" ||
      role === "doc-biblioref" ||
      rel.split(/\s+/).includes("footnote")
    ) {
      return true;
    }

    if (!/#(?:fn|footnote|endnote|note|ref|cite)/.test(href)) {
      return false;
    }

    return isShortReferenceText(text);
  }

  function isShortReferenceText(text) {
    const compact = text.replace(/[\s()[\].,#:-]/g, "");

    if (!compact || compact.length > 8) {
      return false;
    }

    return (
      /^\d+[a-z]?$/i.test(compact) ||
      /^[ivxlcdm]+$/i.test(compact) ||
      /^[a-z]$/i.test(compact) ||
      /^\*+$/.test(compact) ||
      /^[\u2020\u2021\u00a7]+$/.test(compact)
    );
  }

  function hasBlockingDescendant(element) {
    for (const descendant of element.querySelectorAll(BLOCKING_DESCENDANT_SELECTOR)) {
      if (!descendant.closest(INLINE_PRESERVE_SELECTOR)) {
        return true;
      }
    }

    return false;
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

  function isPreserveOnlyText(text) {
    return isMostlyNonText(stripInlineMarkers(text));
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
    // Title and description already travel in the payload's page object.
    return items
      .slice(0, MAX_CONTEXT_ITEMS)
      .map((item) => `${item.kind}: ${item.text.slice(0, MAX_CONTEXT_SNIPPET_CHARS)}`);
  }

  function prioritizeItems(items) {
    return items
      .map((item, index) => ({
        item,
        index,
        viewportRank: getViewportRank(item.element),
        contentRank: getContentAreaRank(item.element),
      }))
      .sort((left, right) => {
        if (left.viewportRank.group !== right.viewportRank.group) {
          return left.viewportRank.group - right.viewportRank.group;
        }
        if (left.viewportRank.distance !== right.viewportRank.distance) {
          return left.viewportRank.distance - right.viewportRank.distance;
        }
        if (left.contentRank !== right.contentRank) {
          return left.contentRank - right.contentRank;
        }
        return left.index - right.index;
      })
      .map((entry) => entry.item);
  }

  function getViewportRank(element) {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = element.getBoundingClientRect();

    if (rect.bottom >= 0 && rect.top <= viewportHeight) {
      return { group: 0, distance: Math.max(0, rect.top) };
    }

    if (rect.top > viewportHeight) {
      return { group: 1, distance: rect.top - viewportHeight };
    }

    return { group: 2, distance: Math.abs(rect.bottom) };
  }

  function getContentAreaRank(element) {
    if (element.closest(SECONDARY_CONTENT_SELECTOR)) {
      return 2;
    }

    if (element.closest(MAIN_CONTENT_SELECTOR)) {
      return 0;
    }

    return 1;
  }

  function createTranslationBatches(items) {
    const batches = [];
    let batch = [];
    let charCount = 0;

    for (const item of items) {
      const nextCharCount = charCount + item.text.length;
      const limits = getBatchLimits(batches.length);
      const shouldStartNewBatch =
        batch.length > 0 &&
        (batch.length >= limits.maxParagraphs ||
          nextCharCount > limits.maxTargetChars);

      if (shouldStartNewBatch) {
        batches.push(batch);
        batch = [];
        charCount = 0;
      }

      batch.push(item);
      charCount += item.text.length;
    }

    if (batch.length > 0) {
      batches.push(batch);
    }

    return batches;
  }

  function getBatchLimits(batchIndex) {
    if (batchIndex === 0) {
      return {
        maxParagraphs: PRIORITY_BATCH_MAX_PARAGRAPHS,
        maxTargetChars: PRIORITY_BATCH_MAX_TARGET_CHARS,
      };
    }

    return {
      maxParagraphs: ESTIMATE_MAX_PARAGRAPHS_PER_RUN,
      maxTargetChars: ESTIMATE_MAX_TARGET_CHARS_PER_RUN,
    };
  }

  function estimateTranslationWork(items, batches) {
    const targetChars = items.reduce((sum, item) => sum + item.text.length, 0);
    const batchCount = batches.length;
    const nativeRequestCount = batchCount > 0 ? 1 : 0;
    const parallelRuns = nativeRequestCount;
    const priorityBatchCount = countPriorityBatches(batches);
    const waveCount = nativeRequestCount;

    return {
      targetCount: items.length,
      targetChars,
      batchCount,
      nativeRequestCount,
      parallelRuns,
      waveCount,
      priorityBatchCount,
    };
  }

  async function translateBatches({ batches, page, context, startedAt, metrics, totalItems, sessionId }) {
    const progress = { translated: 0, failed: 0, firstError: null, usage: null, timings: null };
    const orderedBatch = batches
      .map((batch, index) => ({ batch, index }))
      .sort(compareBatchJobs)
      .flatMap((job) => job.batch);

    await translateBatchWithRetry({
      batch: orderedBatch,
      page,
      context,
      startedAt,
      metrics,
      totalItems,
      progress,
      depth: 0,
      sessionId,
    });

    if (progress.translated === 0 && progress.failed > 0) {
      throw new Error(
        progress.firstError
          ? `모든 번역 배치가 실패했습니다. ${progress.firstError}`
          : "모든 번역 배치가 실패했습니다.",
      );
    }

    return progress;
  }

  function compareBatchJobs(left, right) {
    const leftPriority = isPriorityBatch(left.batch) ? 0 : 1;
    const rightPriority = isPriorityBatch(right.batch) ? 0 : 1;
    return leftPriority - rightPriority || left.index - right.index;
  }

  function countPriorityBatches(batches) {
    return batches.reduce((count, batch) => count + (isPriorityBatch(batch) ? 1 : 0), 0);
  }

  function isPriorityBatch(batch) {
    return batch.some((item) => getViewportRank(item.element).group === 0);
  }

  async function translateBatchWithRetry(options) {
    const { batch, depth } = options;
    let result;

    try {
      result = await requestTranslationBatch(options);
    } catch (error) {
      // Whole-request failure (bridge/server); per-item quality failures are
      // returned in result.failedItems instead of thrown.
      if (batch.length > 1 && depth < MAX_RETRY_SPLIT_DEPTH && shouldSplitRetry(error)) {
        const midpoint = Math.ceil(batch.length / 2);
        await Promise.all([
          translateBatchWithRetry({
            ...options,
            batch: batch.slice(0, midpoint),
            depth: depth + 1,
          }),
          translateBatchWithRetry({
            ...options,
            batch: batch.slice(midpoint),
            depth: depth + 1,
          }),
        ]);
        return;
      }

      console.warn("Codex translation batch failed.", getSafeErrorLogDetails(error));
      options.progress.firstError ||= getErrorMessage(error);
      recordTranslationProgress(options, 0, batch.length);
      return;
    }

    addUsage(options.progress, result.usage);
    addTimings(options.progress, result.timings);
    const translated = applyTranslations(batch, result.translations);
    recordTranslationProgress(options, translated, 0);

    if (result.failedItems.length === 0) {
      return;
    }

    // Retry only the items that actually failed validation, one hint each.
    const retryCount = (options.qualityRetryCount || 0) + 1;

    if (retryCount > MAX_SINGLE_ITEM_QUALITY_RETRIES) {
      for (const failed of result.failedItems) {
        logTranslationQualityFailure(failed.error, [failed.item], "failed", options.qualityRetryCount || 0);
      }
      options.progress.firstError ||= getErrorMessage(result.failedItems[0].error);
      recordTranslationProgress(options, 0, result.failedItems.length);
      return;
    }

    await Promise.all(
      result.failedItems.map((failed) => {
        logTranslationQualityFailure(failed.error, [failed.item], "retrying_single_item", retryCount);
        return translateBatchWithRetry({
          ...options,
          batch: [failed.item],
          qualityRetry: createQualityRetryHint(failed.error),
          qualityRetryCount: retryCount,
        });
      }),
    );
  }

  async function requestTranslationBatch({ batch, page, context, sessionId, qualityRetry }) {
    const cachedById = new Map();
    const uncachedItems = [];
    const pendingItems = [];

    for (const item of batch) {
      const cachedText = getCachedTranslation(page, item);

      if (cachedText) {
        cachedById.set(item.id, cachedText);
        continue;
      }

      const cacheKey = getTranslationCacheKey(page, item);
      const pendingTranslation = state.inflightTranslations.get(cacheKey);

      if (pendingTranslation) {
        pendingItems.push({ item, promise: pendingTranslation });
        continue;
      }

      uncachedItems.push(item);
    }

    const uniqueItems = getUniqueTranslationItems(uncachedItems);
    const fetchedByKey = new Map();
    const failedByKey = new Map();
    const pendingByCacheKey = new Map();
    let usage = null;
    let timings = null;

    if (uniqueItems.length > 0) {
      for (const item of uniqueItems) {
        const cacheKey = getTranslationCacheKey(page, item);
        const deferred = createDeferredTranslation();

        pendingByCacheKey.set(cacheKey, deferred);
        state.inflightTranslations.set(cacheKey, deferred.promise);
      }

      try {
        const result = await fetchTranslations({
          items: uniqueItems,
          page,
          context,
          sessionId,
          qualityRetry,
        });
        usage = result.usage;
        timings = result.timings;

        for (const item of uniqueItems) {
          const translatedText = result.translations.get(item.id);
          const sourceKey = getTranslationSourceKey(item);
          const cacheKey = getTranslationCacheKey(page, item);

          if (translatedText) {
            fetchedByKey.set(sourceKey, translatedText);
            pendingByCacheKey.get(cacheKey)?.resolve(translatedText);
          } else {
            const error = new Error(`${QUALITY_ERROR_PREFIX}: ${item.id} 번역이 누락되었습니다.`);
            failedByKey.set(sourceKey, error);
            pendingByCacheKey.get(cacheKey)?.reject(error);
          }
        }
      } catch (error) {
        for (const deferred of pendingByCacheKey.values()) {
          deferred.reject(error);
        }
        throw error;
      } finally {
        for (const cacheKey of pendingByCacheKey.keys()) {
          state.inflightTranslations.delete(cacheKey);
        }
      }
    }

    for (const { item, promise } of pendingItems) {
      try {
        fetchedByKey.set(getTranslationSourceKey(item), await promise);
      } catch (error) {
        failedByKey.set(getTranslationSourceKey(item), error);
      }
    }

    const translations = [];
    const failedItems = [];

    for (const item of batch) {
      const sourceKey = getTranslationSourceKey(item);
      const translatedText = cachedById.get(item.id) || fetchedByKey.get(sourceKey);

      if (!translatedText) {
        failedItems.push({
          item,
          error:
            failedByKey.get(sourceKey) ||
            new Error(`${QUALITY_ERROR_PREFIX}: ${item.id} 번역이 누락되었습니다.`),
        });
        continue;
      }

      try {
        validateTranslationQuality(item, translatedText);
      } catch (error) {
        failedItems.push({ item, error });
        continue;
      }

      if (fetchedByKey.has(sourceKey)) {
        cacheTranslation(page, item, translatedText);
      }
      translations.push({ id: item.id, text: translatedText });
    }

    return { translations, failedItems, usage, timings };
  }

  async function fetchTranslations({ items, page, context, sessionId, qualityRetry }) {
    const startedAt = Date.now();
    const response = await sendRuntimeMessage({
      type: "CODEX_LOCAL_TRANSLATE",
      sessionId,
      payload: {
        page,
        context,
        paragraphs: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          text: item.text,
        })),
        ...(qualityRetry ? { qualityRetry } : {}),
      },
    });

    if (!response?.ok) {
      const error = new Error(response?.error || "로컬 번역 브리지 오류입니다.");
      if (typeof response?.setupCode === "string" && response.setupCode) {
        error.setupCode = response.setupCode;
      }
      throw error;
    }

    return {
      translations: normalizeTranslationResponse(response.translations || []),
      usage: response.usage || null,
      timings: {
        ...(response.timings || {}),
        nativeRoundTripMs: Date.now() - startedAt,
      },
    };
  }

  async function startTranslationSession() {
    const response = await sendRuntimeMessage({
      type: "CODEX_LOCAL_TRANSLATION_SESSION_START",
    });

    if (!response?.ok || typeof response.sessionId !== "string") {
      throw new Error(response?.error || "로컬 번역 세션을 시작하지 못했습니다.");
    }

    return {
      sessionId: response.sessionId,
      pricing: response.pricing || null,
    };
  }

  // Streamed per-paragraph translations arriving ahead of the final response.
  function applyPartialTranslations(translations) {
    if (!state.inProgress || !state.activeItems) {
      return;
    }

    for (const translation of translations) {
      const item = state.activeItems.get(translation?.id);
      const text = typeof translation?.text === "string" ? translation.text.trim() : "";

      if (!item || !text || state.partialApplied.has(item.id)) {
        continue;
      }

      try {
        validateTranslationQuality(item, text);
      } catch {
        continue; // The final response path retries this item with a hint.
      }

      applyTranslations([item], [{ id: item.id, text }]);
      state.partialApplied.add(item.id);
    }

    if (state.partialApplied.size > 0 && state.lastStatus?.phase === "translating") {
      publishStatus(
        "translating",
        `${state.partialApplied.size}개 단락을 번역했습니다…`,
        state.partialApplied.size,
        state.activeItems.size,
        {
          startedAt: state.lastStatus.startedAt,
          metrics: state.lastStatus.metrics,
        },
      );
    }
  }

  function addUsage(progress, usage) {
    const normalizedUsage = normalizeUsage(usage);
    if (!normalizedUsage) {
      return;
    }

    progress.usage = sumUsage(progress.usage, normalizedUsage);
  }

  function addTimings(progress, timings) {
    progress.timings = mergeTimingValues(progress.timings, timings);
  }

  function mergeTimingValues(current, next) {
    const merged = current && typeof current === "object" ? { ...current } : {};
    if (!next || typeof next !== "object") {
      return Object.keys(merged).length > 0 ? merged : null;
    }

    const sumFields = [
      "collectMs",
      "sessionStartMs",
      "nativeRoundTripMs",
      "normalizeMs",
      "serverRequestMs",
      "serverTotalMs",
      "serverBatchCount",
      "promptBuildMs",
      "appServerStartMs",
      "threadStartMs",
      "turnStartMs",
      "turnWaitMs",
      "parseMs",
      "validationMs",
      "codexTotalMs",
      "retryDelayMs",
      "codexAttempts",
      "codexRetries",
      "targetCount",
      "targetChars",
      "missingCount",
    ];
    const maxFields = ["serverParallelRuns"];
    const stringFields = ["mode"];
    const booleanFields = [];

    for (const field of sumFields) {
      const value = readOptionalNumber(next[field]);
      if (value === null) {
        continue;
      }

      merged[field] = (readOptionalNumber(merged[field]) || 0) + value;

      if (field.endsWith("Ms")) {
        const maxField = field.replace(/Ms$/, "MaxMs");
        merged[maxField] = Math.max(readOptionalNumber(merged[maxField]) || 0, value);
      }
    }

    for (const field of maxFields) {
      const value = readOptionalNumber(next[field]);
      if (value !== null) {
        merged[field] = Math.max(readOptionalNumber(merged[field]) || 0, value);
      }
    }

    for (const field of stringFields) {
      if (typeof next[field] === "string" && next[field]) {
        merged[field] = next[field];
      }
    }

    for (const field of booleanFields) {
      if (typeof next[field] === "boolean") {
        merged[field] = next[field];
      }
    }

    if (Array.isArray(next.runs)) {
      merged.runs = [...(Array.isArray(merged.runs) ? merged.runs : []), ...next.runs].slice(-40);
    }

    return Object.keys(merged).length > 0 ? merged : null;
  }

  function addProjectedUsage(metrics, context, pricing) {
    const projectedUsage = estimateProjectedUsage(metrics, context, pricing);

    if (!projectedUsage) {
      return metrics;
    }

    return {
      ...metrics,
      estimatedUsage: projectedUsage,
    };
  }

  function estimateProjectedUsage(metrics, context, pricing) {
    if (!metrics || !Number.isFinite(metrics.targetChars) || metrics.targetChars < 1) {
      return null;
    }

    const batchCount = Number.isFinite(metrics.batchCount) && metrics.batchCount > 0
      ? metrics.batchCount
      : 1;
    const targetCount = Number.isFinite(metrics.targetCount) && metrics.targetCount > 0
      ? metrics.targetCount
      : 1;
    const contextChars = Array.isArray(context)
      ? context.reduce((sum, value) => sum + String(value || "").length, 0)
      : 0;
    const promptOverheadChars = 1800 * batchCount;
    const jsonOverheadChars = 120 * batchCount + 40 * targetCount;
    const inputTokens = estimateTokenCountFromChars(
      metrics.targetChars + contextChars * batchCount + promptOverheadChars + jsonOverheadChars,
    );
    const outputTokens = estimateTokenCountFromChars(metrics.targetChars + 40 * targetCount);
    const totalTokens = inputTokens + outputTokens;
    const cost = estimateProjectedCost(inputTokens, outputTokens, pricing);

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd: cost?.usd ?? null,
      costBasis: cost?.basis ?? null,
      estimated: true,
      projected: true,
    };
  }

  function estimateProjectedCost(inputTokens, outputTokens, pricing) {
    const safePricing = normalizePricing(pricing);
    if (!safePricing) {
      return null;
    }

    return {
      usd: (inputTokens / 1000000) * safePricing.inputUsdPerMillion +
        (outputTokens / 1000000) * safePricing.outputUsdPerMillion,
      basis: safePricing,
    };
  }

  function normalizePricing(pricing) {
    if (!pricing || typeof pricing !== "object") {
      return null;
    }

    const inputUsdPerMillion = readOptionalNumber(pricing.inputUsdPerMillion);
    const outputUsdPerMillion = readOptionalNumber(pricing.outputUsdPerMillion);

    if (!Number.isFinite(inputUsdPerMillion) || !Number.isFinite(outputUsdPerMillion)) {
      return null;
    }

    return {
      model: typeof pricing.model === "string" ? pricing.model : "",
      inputUsdPerMillion,
      cachedInputUsdPerMillion: readOptionalNumber(pricing.cachedInputUsdPerMillion),
      outputUsdPerMillion,
      source: typeof pricing.source === "string" ? pricing.source : "",
      retrievedAt: typeof pricing.retrievedAt === "string" ? pricing.retrievedAt : "",
      unit: typeof pricing.unit === "string" ? pricing.unit : "",
      tier: typeof pricing.tier === "string" ? pricing.tier : "",
    };
  }

  function estimateTokenCountFromChars(charCount) {
    return Math.max(1, Math.ceil(Math.max(0, charCount) / 4));
  }

  function sumUsage(current, next) {
    if (!current) {
      return { ...next };
    }

    return {
      inputTokens: current.inputTokens + next.inputTokens,
      cachedInputTokens: (current.cachedInputTokens || 0) + (next.cachedInputTokens || 0),
      outputTokens: current.outputTokens + next.outputTokens,
      totalTokens: current.totalTokens + next.totalTokens,
      costUsd: sumOptionalNumbers(current.costUsd, next.costUsd),
      costBasis: current.costBasis || next.costBasis || null,
      estimated: current.estimated || next.estimated,
    };
  }

  function normalizeUsage(usage) {
    if (!usage || typeof usage !== "object") {
      return null;
    }

    const inputTokens = readTokenCount(usage.inputTokens);
    const outputTokens = readTokenCount(usage.outputTokens);
    const totalTokens = readTokenCount(usage.totalTokens);

    if (!inputTokens && !outputTokens && !totalTokens) {
      return null;
    }

    return {
      inputTokens,
      cachedInputTokens: readTokenCount(usage.cachedInputTokens),
      outputTokens,
      totalTokens: totalTokens || inputTokens + outputTokens,
      costUsd: readOptionalNumber(usage.costUsd),
      costBasis: usage.costBasis && typeof usage.costBasis === "object" ? usage.costBasis : null,
      estimated: usage.estimated !== false,
      projected: usage.projected === true,
    };
  }

  function readTokenCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  function readOptionalNumber(value) {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function sumOptionalNumbers(left, right) {
    const safeLeft = Number.isFinite(left) ? left : 0;
    const safeRight = Number.isFinite(right) ? right : 0;

    return safeLeft || safeRight ? safeLeft + safeRight : null;
  }

  function normalizeTranslationResponse(translations) {
    const byId = new Map();

    for (const translation of translations) {
      if (!translation || typeof translation !== "object") {
        continue;
      }

      const id = typeof translation.id === "string" ? translation.id : "";
      const text = typeof translation.text === "string" ? translation.text.trim() : "";

      if (id && text) {
        byId.set(id, text);
      }
    }

    return byId;
  }

  function getUniqueTranslationItems(items) {
    const uniqueItems = [];
    const seen = new Set();

    for (const item of items) {
      const sourceKey = getTranslationSourceKey(item);

      if (seen.has(sourceKey)) {
        continue;
      }

      seen.add(sourceKey);
      uniqueItems.push(item);
    }

    return uniqueItems;
  }

  function createDeferredTranslation() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    promise.catch(() => {});
    return { promise, resolve, reject };
  }

  function getCachedTranslation(page, item) {
    const cacheKey = getTranslationCacheKey(page, item);
    const cachedText = state.translationCache.get(cacheKey);

    if (!cachedText) {
      return "";
    }

    try {
      validateTranslationQuality(item, cachedText);
    } catch {
      state.translationCache.delete(cacheKey);
      return "";
    }

    state.translationCache.delete(cacheKey);
    state.translationCache.set(cacheKey, cachedText);
    return cachedText;
  }

  function cacheTranslation(page, item, translatedText) {
    const cacheKey = getTranslationCacheKey(page, item);
    state.translationCache.set(cacheKey, translatedText);

    while (state.translationCache.size > MAX_TRANSLATION_CACHE_ENTRIES) {
      const oldestKey = state.translationCache.keys().next().value;
      state.translationCache.delete(oldestKey);
    }
  }

  function getTranslationCacheKey(page, item) {
    return `${getPageCacheScope(page)}\n${getTranslationSourceKey(item)}`;
  }

  function getPageCacheScope(page) {
    const url = typeof page?.url === "string" ? page.url.split("#")[0] : "";
    const title = typeof page?.title === "string" ? page.title : "";

    return `${url}\n${title}`;
  }

  function getTranslationSourceKey(item) {
    return item.text;
  }

  function validateTranslationQuality(item, translatedText) {
    const text = String(translatedText || "").trim();

    if (!text) {
      throw new Error(`${QUALITY_ERROR_PREFIX}: ${item.id} 결과가 비어 있습니다.`);
    }

    const invalidLinkTokens = getInvalidPairedTokens(item.links || [], text);
    if (invalidLinkTokens.length > 0) {
      throw new Error(
        `${QUALITY_ERROR_PREFIX}: ${item.id} 링크 마커가 누락되었거나 중복되었습니다 (${invalidLinkTokens.join(", ")}).`,
      );
    }

    const invalidFormatTokens = getInvalidPairedTokens(item.formatNodes || [], text);
    if (invalidFormatTokens.length > 0) {
      throw new Error(
        `${QUALITY_ERROR_PREFIX}: ${item.id} 서식 마커가 누락되었거나 중복되었습니다 (${invalidFormatTokens.join(", ")}).`,
      );
    }

    const invalidPreserveTokens = getInvalidPreserveTokens(item, text);
    if (invalidPreserveTokens.length > 0) {
      throw new Error(
        `${QUALITY_ERROR_PREFIX}: ${item.id} 보존 마커가 누락되었거나 중복되었습니다 (${invalidPreserveTokens.join(", ")}).`,
      );
    }

    const markerNestingError = getInlineMarkerNestingError(item, text);
    if (markerNestingError) {
      throw new Error(
        `${QUALITY_ERROR_PREFIX}: ${item.id} 인라인 마커 순서가 깨졌습니다 (${markerNestingError}).`,
      );
    }

    const sourceText = stripInlineMarkers(item.text);
    const targetText = stripInlineMarkers(text);
    const missingUrls = getMissingPreservedTokens(extractUrls(sourceText), targetText);

    if (missingUrls.length > 0) {
      throw new Error(`${QUALITY_ERROR_PREFIX}: ${item.id} URL이 누락되었습니다.`);
    }

    const missingNumbers = getMissingNumbers(sourceText, targetText);

    if (missingNumbers.length > 0) {
      throw createMissingNumbersQualityError(item, sourceText, targetText, missingNumbers);
    }
  }

  function createMissingNumbersQualityError(item, sourceText, targetText, missingNumbers) {
    const error = new Error(
      `${QUALITY_ERROR_PREFIX}: ${item.id} 숫자가 누락되었습니다 (${missingNumbers.length}개).`,
    );

    Object.defineProperty(error, "translationQuality", {
      value: {
        itemId: item.id,
        kind: item.kind || "paragraph",
        reason: "missing_numbers",
        sourceLength: sourceText.length,
        translatedLength: targetText.length,
        sourceNumberCount: extractNumbers(sourceText).length,
        translatedNumberCount: extractNumbers(targetText).length,
        missingNumbers,
      },
    });
    return error;
  }

  function isQualityValidationError(error) {
    return Boolean(error?.translationQuality) || getErrorMessage(error).startsWith(QUALITY_ERROR_PREFIX);
  }

  function logTranslationQualityFailure(error, batch, action, retryAttempt) {
    if (!isQualityValidationError(error)) {
      return;
    }

    console.warn("Codex translation quality diagnostics.", {
      action,
      retryAttempt,
      batchSize: batch.length,
      ...getTranslationQualityLogDetails(error, batch),
    });
  }

  function getTranslationQualityLogDetails(error, batch) {
    const details = error.translationQuality;

    if (!details) {
      return {
        itemIds: batch.map((item) => item.id).slice(0, 10),
        message: getSafeErrorLogMessage(error),
      };
    }

    return {
      itemId: details.itemId,
      kind: details.kind,
      reason: details.reason,
      sourceLength: details.sourceLength,
      translatedLength: details.translatedLength,
      sourceNumberCount: details.sourceNumberCount,
      translatedNumberCount: details.translatedNumberCount,
      missingNumberCount: Array.isArray(details.missingNumbers) ? details.missingNumbers.length : 0,
    };
  }

  function createQualityRetryHint(error) {
    const details = error?.translationQuality || {};

    return {
      itemId: details.itemId || "",
      reason: details.reason || "quality_validation_failed",
      missingNumbers: Array.isArray(details.missingNumbers) ? details.missingNumbers : [],
    };
  }

  function getSafeErrorLogDetails(error) {
    return {
      name: error instanceof Error ? error.name : typeof error,
      setupCode: typeof error?.setupCode === "string" ? error.setupCode : "",
      message: getSafeErrorLogMessage(error),
    };
  }

  function getSafeErrorLogMessage(error) {
    const message = getErrorMessage(error);
    const firstLine = message.split("\n")[0].trim();

    if (isSafeErrorLogMessage(firstLine)) {
      return firstLine;
    }

    return firstLine
      ? "자세한 오류 메시지는 개인정보 보호를 위해 콘솔에서 생략되었습니다."
      : "";
  }

  function isSafeErrorLogMessage(message) {
    return (
      message.startsWith(QUALITY_ERROR_PREFIX) ||
      message.startsWith("Codex exited with code ") ||
      message.startsWith("Codex timed out after ") ||
      message.startsWith("Codex returned non-JSON output.") ||
      [
        "failed to fetch",
        "local server responded",
        "native messaging host",
        "native host",
        "not logged in",
        "log in",
        "unauthorized",
        "authentication",
      ].some((term) => message.toLowerCase().includes(term))
    );
  }

  function getInvalidPairedTokens(entries, translatedText) {
    const invalid = [];

    for (const entry of entries) {
      const openMarker = `[[${entry.token}]]`;
      const closeMarker = `[[/${entry.token}]]`;

      if (
        countOccurrences(translatedText, openMarker) !== 1 ||
        countOccurrences(translatedText, closeMarker) !== 1
      ) {
        invalid.push(entry.token);
      }
    }

    return invalid;
  }

  function getInvalidPreserveTokens(item, translatedText) {
    const invalid = [];

    for (const preservedNode of item.preservedNodes || []) {
      if (countOccurrences(translatedText, `[[${preservedNode.token}]]`) !== 1) {
        invalid.push(preservedNode.token);
      }
    }

    return invalid;
  }

  function getInlineMarkerNestingError(item, translatedText) {
    const pairedTokens = new Set([
      ...(item.links || []).map((link) => link.token),
      ...(item.formatNodes || []).map((formatNode) => formatNode.token),
    ]);
    const preserveTokens = new Set((item.preservedNodes || []).map((preservedNode) => preservedNode.token));
    const stack = [];
    let match;

    INLINE_MARKER_PATTERN.lastIndex = 0;
    while ((match = INLINE_MARKER_PATTERN.exec(translatedText))) {
      const marker = match[1];

      if (marker.startsWith(PRESERVE_TOKEN_PREFIX)) {
        if (!preserveTokens.has(marker)) {
          return marker;
        }
        continue;
      }

      if (marker.startsWith("/")) {
        const token = marker.slice(1);
        const expected = stack.pop();
        if (expected !== token) {
          return token;
        }
        continue;
      }

      if (!pairedTokens.has(marker)) {
        return marker;
      }

      stack.push(marker);
    }

    return stack.length > 0 ? stack[stack.length - 1] : "";
  }

  function countOccurrences(text, value) {
    let count = 0;
    let index = 0;

    while ((index = String(text || "").indexOf(value, index)) !== -1) {
      count += 1;
      index += value.length;
    }

    return count;
  }

  function extractUrls(text) {
    return getUniqueMatches(text, /https?:\/\/[^\s<>"')\]]+/g).map((url) =>
      url.replace(/[.,;:!?]+$/, ""),
    );
  }

  function getMissingPreservedTokens(tokens, targetText) {
    return tokens.filter((token) => !targetText.includes(token));
  }

  function getMissingNumbers(sourceText, targetText) {
    const sourceNumbers = extractNumbers(sourceText);
    const targetNumbers = new Set(extractNumbers(targetText).map(normalizeNumberToken));

    return sourceNumbers.filter((number) => !targetNumbers.has(normalizeNumberToken(number)));
  }

  function extractNumbers(text) {
    return getUniqueMatches(text, /[$€£¥₩]?\d[\d,]*(?:\.\d+)?%?/g);
  }

  function normalizeNumberToken(token) {
    return token.replace(/[$€£¥₩,]/g, "");
  }

  function getUniqueMatches(text, pattern) {
    return Array.from(new Set(String(text || "").match(pattern) || []));
  }

  function shouldSplitRetry(error) {
    // Infrastructure failures carry a setupCode; splitting the batch and
    // retrying against a dead bridge only multiplies the failure.
    if (typeof error?.setupCode === "string" && error.setupCode) {
      return false;
    }

    const message = getErrorMessage(error).toLowerCase();
    return (
      !message.includes("failed to fetch") &&
      !message.includes("local server responded") &&
      !message.includes("native messaging host") &&
      !message.includes("native host") &&
      !message.includes("not logged in") &&
      !message.includes("log in") &&
      !message.includes("unauthorized") &&
      !message.includes("authentication")
    );
  }

  function recordTranslationProgress({ progress, startedAt, metrics, totalItems }, translated, failed) {
    progress.translated += translated;
    progress.failed += failed;

    const completed = progress.translated + progress.failed;
    const message = progress.failed
      ? `${progress.translated}개 번역 완료, ${progress.failed}개 실패했습니다.`
      : `${progress.translated}개 단락을 번역 중입니다.`;

    publishStatus("translating", message, completed, totalItems, {
      startedAt,
      metrics,
      usage: progress.usage,
      failed: progress.failed,
    });
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
    const fragment = buildTranslationFragment(
      translatedText,
      item.links || [],
      item.preservedNodes || [],
      item.formatNodes || [],
    );
    const content = fragment || document.createTextNode(stripInlineMarkers(translatedText));

    if (item.fullWrapLink) {
      const linkClone = item.fullWrapLink.cloneNode(false);
      linkClone.append(content);
      item.element.replaceChildren(linkClone);
      return;
    }

    if (fragment) {
      item.element.replaceChildren(fragment);
      return;
    }

    item.element.textContent = stripInlineMarkers(translatedText);
  }

  function buildTranslationFragment(translatedText, links, preservedNodes, formatNodes) {
    if (!links.length && !preservedNodes.length && !formatNodes.length) {
      return null;
    }

    const markerMaps = {
      linkByToken: new Map(links.map((link) => [link.token, link.element])),
      preservedByToken: new Map(
        preservedNodes.map((preservedNode) => [preservedNode.token, preservedNode.element]),
      ),
      formatByToken: new Map(formatNodes.map((formatNode) => [formatNode.token, formatNode.element])),
    };
    const fragment = document.createDocumentFragment();
    const matchedTokens = appendTranslatedInline(fragment, translatedText, markerMaps);

    if (matchedTokens === 0) {
      return null;
    }

    return fragment;
  }

  function appendTranslatedInline(parent, translatedText, markerMaps) {
    const markerPattern = new RegExp(INLINE_MARKER_PATTERN.source, "g");
    let lastIndex = 0;
    let matchedTokens = 0;
    let match;

    while ((match = markerPattern.exec(translatedText))) {
      const marker = match[1];

      if (marker.startsWith("/")) {
        appendTextNode(parent, translatedText.slice(lastIndex, match.index));
        lastIndex = markerPattern.lastIndex;
        continue;
      }

      appendTextNode(parent, translatedText.slice(lastIndex, match.index));

      if (marker.startsWith(PRESERVE_TOKEN_PREFIX)) {
        const preservedNode = markerMaps.preservedByToken.get(marker);
        if (preservedNode) {
          parent.append(preservedNode.cloneNode(true));
          matchedTokens += 1;
        }
        lastIndex = markerPattern.lastIndex;
        continue;
      }

      const closeMarker = `[[/${marker}]]`;
      const contentStart = markerPattern.lastIndex;
      const closeIndex = translatedText.indexOf(closeMarker, contentStart);

      if (closeIndex === -1) {
        lastIndex = markerPattern.lastIndex;
        continue;
      }

      const content = translatedText.slice(contentStart, closeIndex);
      const markerNode = createInlineMarkerNode(marker, content, markerMaps);

      if (markerNode) {
        parent.append(markerNode);
        matchedTokens += 1;
      } else {
        appendTextNode(parent, content);
      }

      lastIndex = closeIndex + closeMarker.length;
      markerPattern.lastIndex = lastIndex;
    }

    appendTextNode(parent, translatedText.slice(lastIndex));
    return matchedTokens;
  }

  function createInlineMarkerNode(token, content, markerMaps) {
    if (token.startsWith(LINK_TOKEN_PREFIX)) {
      const link = markerMaps.linkByToken.get(token);
      if (!link) {
        return null;
      }

      const clone = link.cloneNode(false);
      appendInlineContentOrFallback(
        clone,
        content,
        markerMaps,
        normalizeText(link.innerText || link.textContent || ""),
      );
      return clone;
    }

    if (token.startsWith(FORMAT_TOKEN_PREFIX)) {
      const formatNode = markerMaps.formatByToken.get(token);
      if (!formatNode) {
        return null;
      }

      const clone = formatNode.cloneNode(false);
      appendInlineContentOrFallback(
        clone,
        content,
        markerMaps,
        normalizeText(formatNode.innerText || formatNode.textContent || ""),
      );
      return clone;
    }

    return null;
  }

  function appendInlineContentOrFallback(parent, content, markerMaps, fallbackText) {
    const fragment = document.createDocumentFragment();
    appendTranslatedInline(fragment, content, markerMaps);

    if (fragment.hasChildNodes()) {
      parent.append(fragment);
      return;
    }

    if (fallbackText) {
      parent.append(document.createTextNode(fallbackText));
    }
  }

  function appendTextNode(fragment, text) {
    const cleaned = stripInlineMarkers(text);

    if (cleaned) {
      fragment.append(document.createTextNode(cleaned));
    }
  }

  function stripLinkMarkers(text) {
    return String(text || "").replace(ANY_LINK_MARKER_PATTERN, "");
  }

  function stripPreserveMarkers(text) {
    return String(text || "").replace(ANY_PRESERVE_MARKER_PATTERN, "");
  }

  function stripFormatMarkers(text) {
    return String(text || "").replace(ANY_FORMAT_MARKER_PATTERN, "");
  }

  function stripInlineMarkers(text) {
    return stripFormatMarkers(stripPreserveMarkers(stripLinkMarkers(text)));
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
    const status = { phase, message, current, total, ...extra };
    state.lastStatus = status;

    try {
      chrome.runtime.sendMessage(
        {
          type: "CODEX_TRANSLATION_STATUS",
          status,
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
