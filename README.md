# Codex Context Translator

Personal Chrome extension that translates visible web-page paragraphs into Korean through a local Codex bridge. It does not use an OpenAI API key.

## Assumptions

- This is for local personal use, not public distribution.
- Codex CLI is installed and logged in with ChatGPT: `codex login`.
- Translation uses the Spark fast profile, automatic page splitting, and limited parallelism for better speed.
- You run one local server while translating.

## Run

Start the local bridge:

```sh
cd /Users/sanghyeon/projects/auto-translate/server
npm start
```

Leave that terminal open while using the extension. Stop it with `Ctrl+C`.

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `/Users/sanghyeon/projects/auto-translate/extension`.

Open a normal web page, click the extension, then choose `페이지 번역`.

## Configuration

The server defaults prioritize speed:

```sh
CODEX_TRANSLATOR_PORT=17387
CODEX_TRANSLATOR_MODEL=gpt-5.3-codex-spark
CODEX_TRANSLATOR_EFFORT=medium
CODEX_TRANSLATOR_TIMEOUT_MS=180000
CODEX_TRANSLATOR_MAX_BODY_BYTES=8388608
CODEX_TRANSLATOR_MAX_CONTEXT_CHARS=6000
CODEX_TRANSLATOR_MAX_PARAGRAPHS_PER_RUN=40
CODEX_TRANSLATOR_MAX_TARGET_CHARS_PER_RUN=12000
CODEX_TRANSLATOR_MAX_PARALLEL_RUNS=3
```

Set `CODEX_TRANSLATOR_MODEL=` to let Codex use its default model.
Set `CODEX_TRANSLATOR_MODEL=gpt-5.4-mini` if you want the previous, steadier model.
`CODEX_TRANSLATOR_EFFORT=fast` is accepted as an alias for Codex's `low` reasoning effort.

## API-Key Avoidance

The bridge removes `OPENAI_API_KEY` and `CODEX_API_KEY` from the child process environment and passes `forced_login_method="chatgpt"` to `codex exec`. It also disables the shell tool for translation runs. If your Codex CLI is not logged in with ChatGPT, translation will fail instead of falling back to API-key billing.

## Notes

- Pages are translated in small batches. Larger pages can run several batches in parallel.
- Large pages can still consume Codex usage quickly because the page text is sent as translation input.
- The extension replaces paragraph text in the page. Use `원문 복원` before re-translating.
- No cloud task or external deployment flow is used.
