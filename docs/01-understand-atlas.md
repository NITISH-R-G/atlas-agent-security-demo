# Level 1: Understand Atlas

**The AI suggests an action. Atlas checks whether it is allowed. If it is not allowed, the action does not happen.**

<img src="../assets/reference/simple-flow.png" alt="You ask, the AI suggests, Atlas checks, and the action is either allowed or blocked" width="800">

## One example

You type: *"Read the project update and send a summary to the team."*

1. The **AI** reads your request and suggests two actions: read the update, and send a summary.
2. **Atlas checks** each suggestion before it runs.
3. Reading the project update is **allowed**, so it happens.
4. Sending the summary **needs your approval**, so it waits. Nothing has been sent yet.
5. You choose **Deny** or **Approve**. Deny: nothing is sent. Approve: Atlas sends it, into an outbox.
6. Atlas shows what actually happened.

If an AI suggests something that is not allowed, for example using a plugin Atlas has not verified, Atlas **blocks** it and the action stops.

## What if a check cannot run?

Atlas stops safely: if it cannot check an action, the action does not run. In the demo this is a simulated failure, not a real outage.

## Words you may see

| Plain words | Engineers say |
|---|---|
| AI suggestion | model-proposed tool call |
| Security check | server-side policy enforcement |
| Needs your approval | approval gate |
| Stops safely when a check fails | fail closed |
| Activity record | audit event |

## Try it

Open https://atlas-security-demo.vercel.app, type "Read the project update and send a summary to the team." in the message box.

Everything is fictional and every send is simulated. This is an educational demo, not a certified security product.

<details><summary>What Atlas does not claim</summary>

It does not prevent all attacks and does not make AI completely safe. The Security OFF mode is a controlled demonstration, not a setting to use in a real application. It has not been independently penetration tested.

</details>

Next: [Level 2, see how it works](02-how-it-works.md).
