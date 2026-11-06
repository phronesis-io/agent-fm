# Agent FM

A quiet desktop space for working, studying, and spending time with your Agent.

Art fills the background. Instrumental and ambient music accompanies an optional Pomodoro. A lasting Codex conversation is there when you invite it in. The timer, playback, and local records work without waiting for a model response.

- **335 local programmes:** 235 contemporary image/music pairings and 100 earlier selections; four optional YouTube radio seeds.
- **A persistent companion:** one bound Codex conversation, with context limited to activity inside FM.
- **Local records:** no product account or central application backend. Codex model requests still use your existing Codex service and account.
- **Language-aware:** English is the default interface; Simplified Chinese is also supplied. Confirm your preferred working language. Source text and original titles remain accessible.
- **A restrained interface:** linked timer/music pause and resume, optional completion companionship, saved pairings, and sources for the media.

## Start

This is an experimental desktop preview. The current companion host is Codex; other Agents can use the CLI to prepare programmes but cannot replace the bound companion.

Requirements: Node.js 24 or 25, an authenticated Codex installation, and a desktop browser. macOS is the tested installation target. See [installation](INSTALL.md) for host compatibility and data locations.

```sh
git clone https://github.com/phronesis-io/agent-fm.git
cd agent-fm
npm ci
npm run build
node dist/cli.mjs install
node dist/cli.mjs open
```

The local address is retained across restarts. Music starts after a user gesture. This repository includes local media and is approximately 600 MB before dependencies.

## Agent interface

The installer provides the `agent-fm` command and a Codex Skill. Start with `agent-fm capabilities` and `agent-fm schema <command>`. Preparation does not interrupt playback; programme selection queues the next Pomodoro. [Interface reference](docs/AGENT-INTERFACE.md).

## Development

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

Tests use isolated local stores. Real Codex calls are not required by CI. Full decoding and muted playback checks do not constitute human listening review: complete audition, vocal-sample review and long-session listening feedback are still pending.

## Licence and media

Original software is MIT-licensed; see [LICENSE](LICENSE). Third-party images, recordings, source descriptions and fonts retain their own terms and are **not** relicensed as MIT. Per-asset attribution, source and licence links are provided in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the catalogues under `web/`. Follow their individual attribution and ShareAlike conditions where applicable.

YouTube channels play through their official embeds. Their content is not included in this repository or covered by the software licence.

Artwork descriptions open in their original language. Choose Translation to replace the text in place, and Original to return; cached translations never open automatically.
