# MMGIS Copilot Capability Integration

**Feature**: 013
**Status**: Implemented and validated
**Created**: 2026-08-15

## Problem

The active AgentChat frontend can accept an HTTP 200 authentication-failure
envelope as a successful agent response. It then renders an empty-answer
fallback because the payload has neither assistant text nor actions. The
current Azure Responses integration also treats structured function calls as
empty output and has no tool-result continuation, while Copilot capabilities
are a private static registry that other MMGIS plugins cannot extend.

## User scenarios

### 1. Supported command completes conversationally

Given an MMGIS mission with Copilot enabled, when a user asks for a supported
map, layer, temporal, analysis, or plugin action, Copilot MUST execute the same
application-level behavior used by the UI and MUST display a non-empty result.

### 2. Data compatibility is explicit

When an analysis is requested, Copilot MUST inspect live layer metadata and
registered analysis capabilities. It MUST select a compatible visible layer or
explain why the requested layer is unsupported; it MUST NOT fabricate results.

### 3. Natural language and ambiguity

Equivalent paraphrases MUST be routed through the model/capability selection
flow rather than exact-query handlers. If a required target is genuinely
ambiguous, Copilot MUST ask a concise clarification question and execute no
action.

### 4. Plugin-provided capability

An MMGIS plugin MAY register a namespaced Copilot action with a description,
JSON Schema, availability predicate, and safe handler. Copilot MUST discover
available actions, invoke only registered handlers, and receive a structured
result. Plugins MUST behave unchanged when Copilot is unused.

### 5. Failures remain diagnosable

Provider, validation, execution, authentication, and malformed-response errors
MUST retain structured server/client diagnostics while exposing a safe,
actionable chat message. A generic empty-answer guard is permitted only as a
last resort.

## Functional requirements

- **FR-001**: Public `AUTH=none` missions with `WITH_AGENT=true` MUST reach the
  Agent route; protected auth modes MUST continue rejecting guests.
- **FR-002**: The frontend MUST treat failure envelopes and invalid JSON as
  failures even when the HTTP status is 2xx.
- **FR-003**: Azure message text and `function_call` output items MUST both be
  parsed, and tool results MUST be continued with the provider when possible.
- **FR-004**: Every successful action MUST yield a structured result containing
  `ok`, `message`, and optional `data`; exceptions MUST yield a stable error.
- **FR-005**: The model-visible registry MUST contain current descriptions and
  argument schemas, including dynamically registered client/plugin actions.
- **FR-006**: Agent actions MUST execute through registered handlers or the
  existing MMGIS state/action APIs, never arbitrary method names or DOM
  coordinates.
- **FR-007**: Layer context MUST include visibility, type/source, temporal
  metadata, and analysis compatibility derived from the live mission.
- **FR-008**: Statistics, first-visible statistics, thresholds relative to a
  statistic, comparisons, and currently exposed real analytic operations MUST
  return computed results or an explicit unsupported reason.
- **FR-009**: Simulated/random analytic output MUST not be presented as data.
- **FR-010**: Demo, welcome, empty-state, dynamic, contextual, and zoom examples
  MUST have one testable configuration/generation source.
- **FR-011**: Every configured/generated example MUST produce a non-empty plan,
  result, clarification, or compatibility explanation in regression tests.
- **FR-012**: The host MUST expose a collision-safe plugin action registry whose
  discovery representation contains no executable functions.

## Non-functional requirements

- Client-provided descriptors MUST be bounded and sanitized before inclusion in
  an LLM prompt.
- Provider/tool loops MUST have a finite iteration limit.
- Client errors MUST not expose credentials, absolute paths, or stack traces.
- UI actions MUST retain existing layer-type, interaction, and plugin hooks.
- The change MUST not modify mission data, database configuration, or raw data.

## Success criteria

- The screenshot failure is reproducible before the change and absent after it.
- Unit/contract tests cover informational, navigation, layer, temporal,
  analytics, plugin, clarification, exception, malformed, and post-tool text
  paths.
- A running Frozon mission completes every configured example with a meaningful
  visible response or a truthful compatibility explanation.
- At least three non-configured paraphrases choose the intended capability.
