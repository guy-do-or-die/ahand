# Project orientation

This section explains what aHand is, what it deliberately is not, and which questions remain genuinely open.

- [Vision and principles](vision.md)
- [Glossary](glossary.md)
- [Scope and non-goals](scope-and-non-goals.md)
- [Open questions](open-questions.md)

The shortest accurate description:

> aHand is a success-contingent routing protocol for requests. A Raiser escrows an ERC-20 reward and creates a Hand; a capability-bearing link carries the Hand through any communication channel; each Shaker that forwards the live capability may reserve a disclosed success-only margin; the Giver who supplies the accepted solution receives the remaining reward when the Raiser Thanks it. Settlement also allocates a mandatory charity share (1–30%, chosen by the Raiser) and commits the facts from which a separate soulbound Signals ledger is materialized permissionlessly: the Raiser and Giver earn Up from the charitable USD value, and every distinct consented Shaker on the winning Hand receives one `SHAKEN` receipt. The contracts (`AHandCore`, `AHandSignals`, `AHandWitness`) are deployed on Base Sepolia with Circle's Base Sepolia USDC as the reward token; the reference client is the web app at https://ahand.in.
