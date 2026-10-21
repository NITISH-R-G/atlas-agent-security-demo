# Reference analysis

Two external projects were inspected before the interface was reworked. Neither was added as a dependency.

## morluto/rea (chat interface reference)

Inspected: README, `package.json`, repository tree, `website/` sources and style guide.

- It is **a reverse-engineering MCP toolkit** (CLI plus MCP server, MIT licensed). It contains **no chat UI**: there is no sidebar, composer or message list to study. Its website is static HTML; the word "chat" only appears in setup instructions for chat clients that can host MCP servers.
- What was usable: its website style guide's principles (state the question, show the evidence, keep the main path short, let readers open details) informed the "evidence on request" design.
- The ChatGPT-style layout (sidebar with history, centered column, rounded bottom composer, assistant text without bubbles) was therefore taken from the publicly known conventions of consumer chat products, not from that repository, and re-implemented with Atlas's own branding and components. Atlas does not use OpenAI logos or claim any affiliation.

## ronanarm/WalkthroughJS (tour library)

Inspected: README, `API.md`, `src/walkthrough.js` (about 820 lines), `package.json`, license.

| Question | Finding |
|---|---|
| License | LGPL-3.0-or-later; bundling it in an app has copyleft implications |
| Maintenance | single author, about five stars, last push September 2025, no tests |
| Fit with React 19 | global, imperative DOM library; elements are found at start and it has no observer for UI that changes |
| Accessibility | no ARIA roles, no focus management, no `prefers-reduced-motion` handling (searched the source) |
| Cleanup | one `destroy` reference; no ResizeObserver or focus restoration |

Decision: not used. Atlas has a small tour (`src/components/chat/Tour.tsx`, about 150 lines) that finds targets at the moment each step is shown, skips missing ones, never blocks pointer input, re-measures on scroll and resize, restores focus, supports Escape and arrow keys, and respects reduced motion.

## Public chat interface patterns applied

Collapsible sidebar with New chat and history, drawer on phones, readable centered column, composer anchored at the bottom with safe-area padding, assistant replies as flowing text, user messages as bubbles, compact inline tool status, details behind a disclosure.
