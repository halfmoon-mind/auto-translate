# Codex Context Translator

Chrome extension that translates visible web-page paragraphs into Korean through a local Codex native bridge. The bridge uses the user's local Codex CLI ChatGPT login and does not pass `OPENAI_API_KEY` or `CODEX_API_KEY` to translation runs.

## Can This Be Extension-Only?

Not with the current local-native architecture. Chrome extensions cannot install native messaging hosts, install the Codex CLI, or perform a local ChatGPT login for the user. A one-click Chrome-only install would require a hosted translation backend instead of the local Codex CLI bridge.

For this project, the smoothest distributable flow is:

1. Install the Chrome extension.
2. Follow the setup page shown by the extension if the local bridge is missing.
3. Click the extension and choose `페이지 번역`.

For a truly polished release, ship a signed companion installer per OS. The installer should copy the native runtime, register the native messaging host, then open the extension setup page. The extension owns connection checks and next-step guidance from that setup page.

## Requirements

- macOS and Google Chrome for the packaged installer included here.
- Windows is not provided as an installable release yet. Chrome Native Messaging supports Windows, but this repo still needs a Windows host executable wrapper and installer package before Windows users can complete setup.
- Node.js 18 or newer.
- Codex CLI installed and logged in with ChatGPT: `codex login`.

## User Install

Install the extension:

1. Use the published Chrome extension package, or open `chrome://extensions`.
2. If loading locally, enable Developer mode, choose Load unpacked, and select the `extension` folder.

Install the native bridge once:

1. Open `companion/macos`.
2. Double-click `Codex Translator Installer.app`.
3. Confirm the completion dialog.
4. Use the opened setup page to run `다시 확인`.

Chrome launches the native host only while it is handling a health check or translation session. During a page translation, the extension keeps one native messaging port open so translation batches can reuse the same host process. The native host starts `codex app-server` for that translation session, and the extension keeps the session alive for a few idle minutes so consecutive page translations skip the cold start; the session closes automatically after the idle timeout.

If the bridge is missing or cannot start, the extension popup shows `설정 열기`. That opens an in-extension setup page, so users do not need to hunt through this README to understand the next step.

## Installer Behavior

The macOS installer copies the runtime files into:

```text
~/Library/Application Support/CodexContextTranslator/app
```

It then creates:

```text
~/Library/Application Support/CodexContextTranslator/native-host/run-host
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex_context_translator.host.json
```

When launched through `Codex Translator Installer.app`, the installer opens:

```text
chrome-extension://<extension-id>/setup.html
```

Because the runtime is copied during install, users can move or delete the downloaded release folder after installation. Rerun the installer after updating the native host or server files.

The installer reports each step before it runs it. If a step fails, the dialog includes the failed step name, exit code, and a short recovery hint. The extension setup page then verifies the installed bridge from Chrome's point of view.

## Windows Install Status

Windows installation is not provided yet. There is currently no `.exe`, `.msi`, registry installer, or Windows host wrapper in this repo, so Windows users cannot complete the local bridge setup from the packaged release.

The Chrome extension can still be installed on Windows, but translation will not work until a Windows companion installer exists. A Windows release needs to implement the same Native Messaging architecture with Windows-specific installation mechanics:

- The native host manifest must be registered under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.codex_context_translator.host`.
- The registry default value points to the host manifest JSON.
- The manifest `path` should point to a Windows executable host wrapper.
- The wrapper can launch the installed Node.js runtime script, but it should be packaged as an `.exe` for reliable Chrome startup.

A Windows release should install runtime files under a per-user location such as:

```text
%LOCALAPPDATA%\CodexContextTranslator\app
```

Then it should write the registry key, verify Node.js and Codex CLI availability, and open the extension setup page or Chrome Web Store listing.

Until that Windows companion installer is added, Windows should be documented as unsupported for end-user installation.

## Distribution Notes

The native messaging manifest must allow the exact Chrome extension ID. The installer defaults to the unpacked extension ID derived from `extension/manifest.json`:

```text
mildfcoedbkcjlcbfmalbfefchdhjdkk
```

For a Chrome Web Store release, update the installer default after the store ID is known, or run the script with an override:

```sh
CODEX_TRANSLATOR_EXTENSION_ID=<chrome-extension-id> scripts/install-native-host-macos.sh
```

Keep `extension/background.js` and `scripts/install-native-host-macos.sh` on the same native host name:

```text
com.codex_context_translator.host
```

Do not include local/generated files in release archives:

```text
.DS_Store
.codegraph/*
```

## Configuration

The native bridge defaults prioritize speed:

```sh
CODEX_TRANSLATOR_MODEL=gpt-5.4-mini
CODEX_TRANSLATOR_EFFORT=low
CODEX_TRANSLATOR_TIMEOUT_MS=180000
CODEX_TRANSLATOR_APP_SERVER_REQUEST_TIMEOUT_MS=30000
CODEX_TRANSLATOR_MAX_CONTEXT_CHARS=6000
CODEX_TRANSLATOR_MAX_PARAGRAPHS_PER_RUN=20
CODEX_TRANSLATOR_MAX_TARGET_CHARS_PER_RUN=7000
CODEX_TRANSLATOR_MAX_PARALLEL_RUNS=4
```

Set `CODEX_TRANSLATOR_MODEL=` to let Codex use its default model. Set `CODEX_TRANSLATOR_MODEL=gpt-5.3-codex-spark` if you have Spark quota and want the faster profile. `CODEX_TRANSLATOR_EFFORT=fast` is accepted as an alias for Codex's `low` reasoning effort.

## API-Key Avoidance

The native bridge removes `OPENAI_API_KEY` and `CODEX_API_KEY` from the child process environment and passes `forced_login_method="chatgpt"` to `codex app-server`. It also disables the shell tool for translation runs. If the local Codex CLI is not logged in with ChatGPT, translation fails instead of falling back to API-key billing.

## Maintenance Notes

- The extension sends one translation request per page translation. The local native host splits the page into char-balanced batches and runs up to 4 in parallel; translated paragraphs stream back and appear in the page as each one completes.
- If individual paragraphs fail client-side validation (missing numbers, markers, or URLs), only those paragraphs are retried once with a hint; the rest of the page keeps its translations.
- Large pages can still consume Codex usage quickly because the page text is sent as translation input. Token usage shown in the popup is the real count reported by `codex app-server`.
- The extension replaces paragraph text in the page. Use `원문 복원` before re-translating.
