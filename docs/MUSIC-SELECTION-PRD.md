# Music selection: reachable, immediate, explicit

2026-11-17. User report: cannot click or change music. Existing local programme rows expose only a next-Pomodoro queue action after long descriptions. Channel buttons change immediately, making the two behaviors inconsistent.

## Contract

Keep the quiet artwork-led room and current timer. Put a visible “Switch to this / 换成这组” action beside every local pairing, without expanding its facts. Show recording title and performer in the row; keep facts folded and original-first. Retain “Next Pomodoro / 下一钟听” as a separate secondary action. Selecting now changes art and audio atomically, preserves timer identity, deadline, remaining time and running/paused state, and does not consume a different queued selection. An open untimed room retains its explicitly selected pair when its timer first starts, unless the user queued another pair. No model call.

Local media switches through one server operation. Reject unknown IDs and non-local programme types before any mutation. Repeated selection of the same item is idempotent. During a request, prevent competing switches, show progress, keep the shelf scroll/focus stable; on failure retain current playback and display actionable failure text. Current row has an explicit Selected state; paused remains paused after a switch. Starting sound still follows browser gesture rules.

## Design

Use the existing room palette and typefaces. A wider, opaque-enough shelf (up to 480 CSS px) supports a thumbnail, a short title/recording credit and a direct action. Separate expansion of facts from changing music. No new hero copy or decorative cards. Search includes actual recording title and performer. Actions have at least 44×44 CSS-pixel targets as this product's generous web target, not a claim that CSS pixels equal Apple's platform points. Keep controls out of overlapping layers; honor hidden panels and keyboard focus. Feedback is inline, not an interrupting dialog.

## Acceptance and evidence

Reference Apple HIG Buttons, Feedback and Pointing Devices: https://developer.apple.com/design/human-interface-guidelines/buttons ; https://developer.apple.com/design/human-interface-guidelines/feedback ; https://developer.apple.com/design/human-interface-guidelines/pointing-devices . This is our testable web interpretation, not Apple certification.

Exercise real pointer clicks (no forced clicks or API-only substitute) at 1280×800 and 1440×800, including expanded long facts, scrolled rows, repeated selections, search, current/queued states and keyboard operation. Check center-point hit testing, no overlap, visible focus, ≥44px actions, unchanged clock deadline, paused audio staying paused, resumed audio advancing, and no extra session or model call. Test server invalid ID/no mutation and idempotence. Inspect screenshots. Keep existing programme, radio and timer regression tests.

Deploy between Pomodoros with backup, fixed origin and bound chat preserved. Verify the installed UI and actual media; rollback to the previous runtime on failure. Content-source diversification remains a separate ongoing delivery within this task; do not count this interaction fix as that completion.

## Verification — 2026-11-17

- Reproduced the old action below the viewport at 1280×800 after expanding facts (y=838–872).
- TypeScript check and 66 unit tests passed.
- Full browser regression: 32 passed. Added a third switching case afterward; all three switching cases and the affected next-set regression passed (33 distinct browser cases covered).
- Real pointer/keyboard selection, recording source replacement and advancing playback, paused silence, unchanged timer identity/deadline, independent queue, 503 recovery, and delayed-request locking verified. No forced clicks. Screenshots inspected at 1280 and 1440 widths.
- Scope: local pairing selection. External channels retain their existing dedicated station controls; no new music or cultural-coverage claim belongs to this change.
