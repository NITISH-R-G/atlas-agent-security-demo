# Interface design audit and design system

The interface follows the interaction patterns of current chat products. It does not use OpenAI branding, claims no affiliation, and invents no capabilities.

## What was studied (October 2026)

| Source | What it showed |
|---|---|
| chatgpt.com, signed out, desktop (800 px wide) and phone (375 px) | Dark system theme; a narrow sidebar with icon rows (New chat, library items, Settings) and a collapse icon; a centered heading with the composer in the middle of an empty screen and one suggestion chip below it; a pill composer with a leading action, input, and a round send control; a legal footer line. On a phone: a round menu button, the product name, a primary action at the right, and the same centered composer |
| Release notes (updated this week) | A chat's "more options" (•••) menu for per-chat actions; pinned chats; locked chats; plugins and connected apps; slides. These informed the per-chat options menu. Features that need accounts, uploads or connectors were **not** copied |
| "Finding your chats, projects, and files" | Sidebar search over titles and message text, opened with Ctrl+K or Cmd+K, with an honest empty result. Implemented for this tab's conversations |
| "Projects in ChatGPT" | Projects need accounts and stored files, so they are not imitated |
| github.com/morluto/rea | A reverse-engineering toolkit with a static documentation site and no chat interface. It supplied no layout code; see [REFERENCE-ANALYSIS.md](REFERENCE-ANALYSIS.md) |

## Audit and decisions

| Area | Pattern observed | Atlas decision |
|---|---|---|
| Layout | Sidebar about 260 px, content column about 768 px | `--side-w: 260px`, `--col: 768px` |
| Sidebar | Compact icon rows, collapsible, drawer on phones | New chat, Search chats, then history; collapses on desktop, becomes a drawer with a scrim under 860 px |
| History | Per-chat options menu | Rename and Delete, real and session-local. Labelled "This session" and "Kept in this browser tab only"; nothing is saved to an account |
| Search | Ctrl or Cmd + K | Real filter over titles, your messages and Atlas replies; Escape clears; a clear no-results line |
| Empty screen | Heading and composer centered, suggestions below | Same; the composer is the same element before and after the first message, so typing and focus are never lost |
| Messages | User text in a soft bubble, assistant text with no card | Same. No avatar, no per-message border |
| Composer | Rounded pill, round send, Enter sends, Shift+Enter adds a line, stop while streaming | Same. No attachment, voice, web search or model picker, because none exists in Atlas |
| Message actions | Quiet actions under a reply | **Copy** only, because it is the only action that works |
| Activity | Tool use shown inline | Short sentence with icon: `✓ Project record read`, `⏸ Approval required`, `⊘ Restricted document blocked`, `! Security check unavailable`, built from the server's decision. Details under a collapsed Activity line |
| Approval | n/a | Card with the action, "Not done yet. It runs only if you approve.", separate Deny and Approve, a checking state while the server decides, then the confirmed result |
| Menus | Popover with keyboard dismissal | `role="menu"`, Escape or outside click closes it and focus returns to its button |
| Mobile | Round menu button, centered composer | Drawer, 44 px touch targets on coarse pointers, safe-area padding, `100dvh` so the composer stays above the keyboard |
| Theme | Follows the system | Light and dark token sets via `prefers-color-scheme` |
| Motion | Short, quiet | 120 to 300 ms with one easing; everything stops under `prefers-reduced-motion` |

## Design tokens

All in `src/app/atlas.css`, at the top.

- **Surfaces:** `--bg-page`, `--bg-sidebar`, `--bg-surface`, `--bg-composer`, `--bg-bubble`, `--bg-hover`, `--bg-press`.
- **Text and lines:** `--text`, `--text-2`, `--text-3`, `--border`, `--border-strong`.
- **Semantic colors, always paired with an icon and words:** `--ok` (allowed or confirmed), `--bad` (blocked or failed), `--warn` (waiting for approval), `--info` (model or tool activity), gray (inactive). Each has a `-bg` and `-line` variant.
- **Scales:** spacing `--sp-1` to `--sp-6`; radius `--r-sm` to `--r-pill`; type `--fs-xs` to `--fs-xl`; line heights; elevation `--shadow-1` to `--shadow-3`; icon size; breakpoints at 560, 860 and 1100 px.
- **Interaction:** one focus ring (`--focus`), hover and pressed backgrounds, durations `--dur-1` to `--dur-3`, easing `--ease`.

A test (`Chat2.test.tsx`) checks that the shell and message components use tokens rather than raw colors, that a dark theme exists, and that a reduced-motion block exists.

## What was deliberately not built

Accounts, saved server-side history, projects, file upload, voice, image generation, web search, a model selector, and a permanent security dashboard. None exists in Atlas, so none is drawn.
