# Installation

Agent FM is a desktop development preview. The supported companion is a lasting Codex chat. It has no central product backend and does not require a separate product account.

## Requirements

- Node.js 24 or 25 (built-in SQLite is required).
- An authenticated Codex installation. App Server integration was exercised with Codex 0.164.0-alpha.11.1 and 0.166.0-alpha.5.1; compatibility with other releases must be checked. This is a tested-version record, not a recommendation to replace your host installation.
- A desktop browser. macOS installation and login recovery are tested; other desktop platforms are not release-qualified.

Use the existing host login. Never paste credentials into FM or a chat. A compatible Codex binary can be selected with `AGENT_FM_CODEX_BINARY`.

## Build and open

```sh
npm ci
npm run build
node dist/cli.mjs install
node dist/cli.mjs open
```

Installation registers the Skill and launcher and creates or resumes the bound companion. Reinstalling must preserve that binding rather than silently create another chat. If connection is uncertain, run `node dist/cli.mjs doctor`.

A prebuilt package, when available, runs the same `install` and `open` commands without rebuilding. `npm run package` produces a local archive and SHA-256 checksum; repository source availability does not imply an official binary release exists.

## Local storage and access

Data defaults to `~/.local/share/agent-fm` and can be separated with `AGENT_FM_DATA_DIR`. The service listens only on `127.0.0.1`. Its port is saved and reused. After initial pairing, bookmark the ordinary address without the one-time pairing token. Use `open` again after clearing browser storage or changing browsers.

Personal messages, timer records, local secrets and Codex credentials must never be committed or uploaded. Deleting local records is separate from deleting the Codex chat. Stop/uninstall preserves personal data and the bound conversation.

The installer records the launcher path in the installed Skill and provides `~/.local/bin/agent-fm`; add that directory to PATH if desired. Use `capabilities` and `schema <command>` before automating the CLI.

## Preferences and playback

Confirm the listener's working language; English is the default and unsupported interface-language fallback. Language does not imply nationality or preferred culture. Music requires a user gesture. Timer pause/resume also pauses/resumes music. Prepared programmes do not interrupt the current source.

Optional Codex selection and day-close notes are disabled by default and budgeted separately. FM collects only in-app activity, not other desktop apps. Native timer completion does not depend on a model response. External tool permission approvals are not supported by this preview.

## Restart, upgrade and removal

On macOS, `agent-fm autostart enable` enables login recovery. `stop` stops this instance, while `autostart disable` removes future login startup. `uninstall` removes FM's managed launcher/Skill/trigger and retains personal data.

Before upgrading, stop the service and back up its data directory. Use the new build's `install` command to update managed launcher paths. Current storage uses schema 1; automatic cross-version data migrations are not promised. If system time or sleep recovery cannot be reconstructed safely, the timer pauses for user recovery.

## Known limits

Other companion hosts, mobile pairing and shared community publication are not implemented. Full human review of each recording, whole-machine restart/sleep edge cases, clean-machine compatibility and long-session listening remain areas for further verification. An embedded player starting does not establish audibility, regional availability or uninterrupted playback.
