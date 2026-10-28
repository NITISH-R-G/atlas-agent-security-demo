# Level 2: See how it works

Four steps: **the AI suggests, Atlas checks, you approve when needed, you see the result.**

## 1. The AI suggests

Atlas is a chat assistant with a few tools (read a project record, open a document, fetch plugin updates, send a message). When you ask for something, the AI does not run those tools itself. It only suggests which ones to use.

<img src="../assets/reference/atlas-product-desktop.png" alt="Atlas chat: the project record was read, and the send is waiting for approval" width="800">

*Small labels under the reply show each step: `✓` allowed, `⏸` waiting for approval, `⊘` blocked.*

## 2. Atlas checks

Before any suggestion runs, Atlas checks it: is this tool trusted, does the assistant have permission, is the resource restricted? The result is **allowed** or **blocked**.

<details><summary>Show the same flow as a diagram</summary>

<img src="../assets/reference/request-lifecycle.png" alt="Request lifecycle" width="800">

</details>

## 3. Approval for sensitive actions

Some actions are allowed only with your decision. Atlas pauses and shows an approval card. The action is **waiting, not done**.

<img src="../assets/reference/atlas-product-mobile.png" alt="Approval card on a phone" width="800">

- **Deny:** recorded as declined. Nothing runs.
- **Approve:** Atlas checks again, then runs the action once. Here that means adding a message to an outbox.

<details><summary>Diagram of the approval steps</summary>

<img src="../assets/reference/approval-lifecycle.png" alt="Approval lifecycle" width="800">

</details>

## 4. The result and the activity record

Atlas shows what really happened. Open **Activity** under a reply for the details of each step, and **Open full evidence** for every check. Each decision is saved in an **activity record**.

## What if a check fails?

<img src="../assets/reference/safe-stop.png" alt="If a check cannot run, Atlas stops safely" width="800">

When a check fails to run, Atlas stops safely and the send does not happen. The failure is injected in tests, so it does not tell you how a real outage would behave.

## See the difference: Security OFF and ON

Scenarios A and B run the same request twice. With Security **off** (a controlled weakness), a plugin's hidden instruction is followed. With Security **on**, the plugin is blocked. These are scripted so the comparison is repeatable; a live AI may behave differently.

<details><summary>Comparison diagram</summary>

<img src="../assets/reference/security-mode-comparison.png" alt="Security off versus on" width="800">

</details>

Next: [Level 3, engineering details](03-engineering-details.md).
