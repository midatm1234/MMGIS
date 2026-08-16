# Implementation Plan

## Architecture

The repair uses a bounded plan/execute/continue loop:

1. AgentChat sends the user request plus live map/layer/time state and available
   host/plugin capability descriptors.
2. The Agent backend intersects static tools with sanitized runtime descriptors
   and asks the configured provider for either assistant text or actions.
3. AgentChat invokes only a registered renderer, MMGIS facade action, or plugin
   capability handler and normalizes the result.
4. Structured tool results are returned to the provider. Native Azure function
   calls use `function_call_output`; JSON-planned actions use a result-summary
   continuation.
5. The final assistant text is rendered, with deterministic handler messages as
   a fallback if continuation is unavailable.

## Components

- **Host action registry** (`src/essence/mmgisAPI`): registration, discovery,
  availability, collision protection, invocation, and result normalization.
- **Agent backend plugin** (`MMGIS-Plugins/backend/Agent`): auth policy,
  sanitized live registry merge, provider parsing/continuation, validation,
  serialization, and diagnostics.
- **AgentChat tool** (`MMGIS-Plugins/tools/AgentChat`): live context, example
  generation, action execution, analytic compatibility, and conversational
  result rendering.
- **Regression harnesses**: pure unit/contract tests plus an opt-in live-provider
  and browser workflow.

## Key decisions

- `AUTH=none` is the explicit public/no-login mode and may access an Agent plugin
  that the operator separately enabled with `WITH_AGENT=true`. Other auth modes
  retain guest rejection.
- Runtime plugin capabilities execute in the browser and are never executed by
  the server. The backend accepts only bounded descriptors for model selection;
  the client registry remains the authority for invocation.
- Existing MMGIS functions remain the source of truth for UI behavior. The
  registry wraps them rather than manipulating screen coordinates.
- Analysis compatibility is an explicit per-layer result with supported
  operations and a reason, not a layer-name allowlist.
- Above-average highlighting is an atomic composite capability so a numeric
  statistic can safely feed the threshold step.

## Security and safety

- Preserve authentication gates and make the public-mode exception explicit.
- Validate all tool arguments against JSON Schema and revalidate runtime action
  membership at execution time.
- Bound descriptor, prompt, tool-result, and iteration sizes.
- Keep detailed errors in logs/debug objects and return safe user messages.
- Do not execute arbitrary `window` methods supplied by the model.

## Constitution check

- **I / II**: This spec, plan, and tasks document the hotfix and measurable
  requirements.
- **III**: Host registry, backend protocol, frontend analytics, and validation
  are independently testable tracks.
- **IV**: Unit, contract, example-iteration, and live browser tests are included.
- **V**: Async handlers, Express middleware, and existing map APIs are reused.
- **VI**: Agent/API bounds remain WGS84
  `[minLon,minLat,maxLon,maxLat]`. Raster analytics transform those bounds into
  each source CRS, preserve raster masks and declared NoData values, and align
  comparison grids before calculation; raw source data is never mutated.
- **VII**: The work is request/response and local UI state; no WebSocket editing
  protocol is changed.

## Rollback

The host registry is additive. Disabling `WITH_AGENT` restores prior MMGIS
behavior. The frontend retains deterministic handler messages if provider
continuation is unavailable, so the action path degrades without becoming
silent.
