> **Approved execution update — 9 November 2026:** Professional V1 launches for churches, ministries/nonprofits, and evangelists/missionaries on the same architecture. Creator-specific audiences/onboarding, public Discovery, native articles, community storefronts and external blog distribution are **Post-launch**, preserving their specifications for later. Core courses/digital products, checkout/delivery and community/group workflows remain Launch V1. **Zernio is the API provider only: do not reuse or adapt its frontend implementations.** Build original, polished Harvest scheduler/inbox UI with Studio Admin, shared shadcn components and a Harvest-owned integration layer. Shared CRM filters are the authorized first implementation slice, followed by HC-06 in separate PRs. PR #43 and its independent security review are a separate infrastructure task and do not block authorized product work on separate branches. No merge, deployment or production activation is authorized. Dodo SaaS billing and undecided commerce/donation providers remain unchanged. See [approved delivery plan](../plans/professional-v1-audit-proposal.md).

# AI Assistant Architecture: Provider-Agnostic and Future-Proof

> **Professional V1 release classification (2026-11-09):** `docs/prd/professional-v1-launch-scope.md` is the founder-approved authority for initial paid launch scope and feature freeze. This PRD retains its detailed long-term requirements; any earlier P0/P1 labels, creator-first sequencing or broad modules conflicting with the six-system contract are **Post-launch / Future Vision** until explicitly approved. No features are deleted. Preserve consent, security and activation gates.


**Founder requirement (Matei, 4 Nov 2026).** Binding for every AI feature in Harvest v2 (AI assistant, custom AI assistants, AI Chat, ministry copilot, auto-replies). Read it alongside PRD-v2.5 and PRD-v2.7-companion; where they differ on AI architecture, this document wins.

**Library decision:** the assistant is built on the **Vercel AI SDK** (`ai` package and its provider packages). The AI SDK is open source and runs on any Node host, so it doesn't break the portability rule. Don't depend on Vercel-only AI products (for example AI Gateway) as the only path; any gateway stays behind our own adapter interface.

## Core Requirement

The SaaS AI assistant must be built using a provider-agnostic, modular architecture. No AI model or provider should be tightly coupled to the application's business logic, UI, tools, memory, or integrations.

Initial preferred model: **Xiaomi MiMo-V2.6-Flash**, subject to API capability verification.

The architecture must allow switching to another model (OpenAI, Anthropic, Google Gemini, or future providers) through configuration, without rewriting the assistant.

## Technical Requirements

### 1. AI Provider Abstraction Layer
- Create a centralized AI gateway/service that handles all model interactions.
- Use a common provider interface with adapters for each supported AI provider.
- Never call model-specific APIs directly from frontend components, CRM modules, inbox services, or other application features.
- Keep provider-specific SDKs and request/response formats isolated within adapters.
- Prefer an established abstraction library such as Vercel AI SDK if compatible, rather than building unnecessary infrastructure from scratch. (Decided: Vercel AI SDK.)

### 2. Configurable Model Selection
Support configuration for:
- Default assistant model
- Advanced reasoning model
- Fallback model
- Models for specific tasks
- Provider API credentials
- Token limits, timeouts, and reasoning settings

Models must be configurable through environment variables or an administrative configuration system, without code changes or redeployment where practical.

### 3. Multimodal Support
Design the assistant to support text, images, audio, video, and documents.
- Use a normalized multimodal message format.
- Each provider adapter must declare its supported capabilities.
- When a model doesn't support a particular modality, the system should use an appropriate preprocessing service or route the request to another capable model.
- Do not assume all models support identical modalities, context limits, structured outputs, or tool-calling behavior.

### 4. Model-Independent Tool System
The assistant's integrations must operate independently of the underlying AI model. This includes CRM, email, calendar, social media scheduling, unified inbox, marketing automation, and other future SaaS features.
- Implement a centralized tool registry with validated schemas.
- The model may request tool execution, but actual execution must be handled by the application backend.
- Enforce tenant isolation, user permissions, input validation, and approval requirements independently of the model.

### 5. Model-Independent Memory
- Conversation history, user preferences, relevant business context, and long-term assistant memory must be stored in application-controlled infrastructure.
- Never make a provider's proprietary conversation storage or memory system the only source of assistant context.
- Store conversations in a normalized format that can be reconstructed for different model providers.

### 6. Intelligent Model Routing
Implement an extensible routing layer capable of selecting models based on task complexity, required input modality, tool-calling capabilities, latency, estimated cost, and model availability.

Initially, simple configuration-based routing is sufficient. Avoid introducing unnecessary routing complexity.

### 7. Reliability and Fallbacks
- Support provider timeouts, retries, and circuit breakers.
- Allow fallback to another compatible model.
- Prevent duplicate execution of side-effecting tools when requests are retried.
- Preserve conversation context when switching providers.
- Gracefully handle unsupported features.

### 8. Monitoring and Cost Control
Track model usage per tenant and per task, including provider and model, input/output tokens, estimated API cost, latency, errors and failures, and tool execution outcomes.

Support tenant-level budgets and usage limits.

### 9. Testing and Model Replacement
Build automated tests verifying that:
- Providers can be replaced through configuration.
- Tool execution works across supported models.
- Multimodal inputs are routed correctly.
- Conversation history survives provider changes.
- Tenant permissions remain enforced.
- Provider failures do not cause duplicate actions.

Include a small benchmark suite using realistic SaaS assistant tasks to evaluate new models before deployment.

## Critical Architectural Rule

**The AI model is a replaceable component, not the foundation of the assistant.**

The assistant's identity, permissions, memory, business logic, tools, and workflows must remain owned by the SaaS application.

Replacing MiMo with another compatible model should primarily involve changing provider configuration or adding a new adapter, not rewriting the assistant.

Document the provider interface, routing rules, capability matrix, and model-switching procedure in the project's technical documentation.
