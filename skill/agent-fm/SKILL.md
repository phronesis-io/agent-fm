---
name: agent-fm
description: Open and manage the user's local Codex FM companion space, its dedicated lasting conversation, music, timer, and explicitly handed-over notes. Use when the user asks to open Agent FM, prepare its programs, set its language, or leave something in that space.
---

# Agent FM

The space has its own persistent Codex conversation. This installation/work chat is not that conversation. Do not create a new thread manually or adopt the most recently active chat.

Read `location.json` beside this file to locate the built launcher and Node executable. Execute them as an argument array (paths may contain spaces):

- `open`: start or resume the same bridge and conversation, then open the local page.
- `status` / `doctor`: inspect readiness without model calls.
- `stop`: stop only this bridge; keep memories and the Codex thread.
- `note`: pass the text on stdin only when the user explicitly asks to bring a result into the space. It is labelled as a handoff. Do not transfer unrelated chat history.
- `metrics`: read-only self-use numbers (open days, Pomodoros, skip rate by source, model calls). No model call.
- `prune`: list old local releases and backups; add `--apply` only when the user asks to delete them.
- `uninstall`: only when requested; remove this Skill, retain personal data and the Codex conversation.

Do not expose `control.secret` or copy Codex credentials into the page. One-time opening links contain pairing credentials: open locally, do not publish or log them. If Codex needs login, ask the user to complete Codex's own login; do not request credentials in chat.

The default room is continuous and untimed. Music starts with a user gesture; opening a player is not proof that a person heard a track. During a Pomodoro, the clock and music buttons pause and resume both together. Outside a timed session, the music button controls listening independently. Agent use is budgeted in the bridge: choosing the next set (opt-in, at most 12 calls a day) and one optional day-close note (opt-in, at most once a day). Both consume the user's existing Codex allowance; every call appears in the in-app ledger. The companion may choose silence and cannot change the scene, music or timer.

If a submission or thread creation has an uncertain result, do not retry with a new ID or invent a new companion. Run doctor and report the actual state. A missing thread is not permission to silently replace its history.


## Agent interface

Use the installed `agent-fm` command, or the location.json argument array above. Start with `capabilities`, then `schema <command>` for the exact input. These are read-only and work offline. The current companion host is Codex; another Agent can prepare programs or submit an invitation through the CLI, but cannot take over the companion or write its replies.

Before first conversation, read `language get`. If unset, ask the listener their preferred language, using their current language as a suggestion, then run `language set <BCP47>` after their answer. Honor later changes. Do not infer nationality or preferred culture from this setting.

`context read` returns this room's bounded records. `events read --after <cursor>` pages events. If a cursor expires, read the snapshot again. These records describe FM interactions, not work in other apps or proof of listening.

Use `program validate` and `program prepare` with a JSON draft on stdin. Supply actual sources and original titles, keep interpretation in note, and check the linked media. Validation checks structure and media references, not truth. Preserve the program ID on retries. `program select <id>` schedules the next Pomodoro, so preparation alone does not change the current experience. Contemporary and historical culture are both welcome when the actual sound suits the listener.

`invitation create` accepts a stable id and text on stdin. Use `invitation get <id>` to check status and reply. Retry the same text with the same id; an uncertain result needs inspection, not a new request. Invitations call the existing Codex session.

`autostart enable` enables macOS login recovery. `stop` unloads the current service; `autostart disable` removes future login startup. Completion companionship is separately opt-in, at most once per timer and 24 times per day. The local completion sound does not depend on a model reply.
