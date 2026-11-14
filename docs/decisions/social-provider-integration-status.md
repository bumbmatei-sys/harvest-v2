# Social provider integration layer: engineering status (14 Nov 2026)

**Engineering status:** a Harvest-owned, provider-neutral server layer for the social scheduler and unified inbox is built as a foundation (plan: [`../plans/zernio-integration-layer.md`](../plans/zernio-integration-layer.md), record: [`../acceptance/zernio-integration-layer.md`](../acceptance/zernio-integration-layer.md)). The vendor adapter is hard-disabled by a constant and the integration is disabled by a second constant; nothing can reach the provider, no account can be linked in production, and no post or message can be sent.

This records no decision. Every open gate (provider agreement, sandbox, OAuth ownership, key model, rate limits, launch providers and features, Auto-DM support, scheduling ownership, inbox retention) remains **UNAPPROVED** and is listed in the plan. Production activation is not authorized, and merging the code does not authorize it. The HC-02 activation gates are unchanged.
