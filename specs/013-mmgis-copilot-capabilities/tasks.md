# Tasks

## Phase 1: diagnosis and contracts

- [x] Trace the live UI-to-provider-to-renderer request path.
- [x] Reproduce the HTTP-200 guest failure envelope.
- [x] Inventory all example-query sources and registered analytics.
- [x] Document the capability/result/continuation contracts.

## Phase 2: host capabilities

- [x] Add the safe plugin action registry to `mmgisAPI`.
- [x] Add state-level facade actions for common map/UI controls.
- [x] Add host registry unit tests and plugin-author documentation.

## Phase 3: backend/provider

- [x] Correct Agent auth behavior for explicit no-login mode.
- [x] Parse Azure structured function calls and preserve call/response IDs.
- [x] Add bounded tool-result continuation.
- [x] Merge sanitized runtime capability schemas into the live registry.
- [x] Enrich context/prompt construction and remove stale tool references.
- [x] Add provider, validation, exception, and malformed-response tests.

## Phase 4: frontend and analytics

- [x] Replace exact-query bypasses with capability selection.
- [x] Reject success-status failure envelopes and malformed payloads.
- [x] Consolidate and test all example/suggestion generation.
- [x] Add explicit layer analysis compatibility.
- [x] Add first-visible statistics and relative-threshold composition.
- [x] Replace simulated analytics with real execution or unsupported results.
- [x] Return structured action results and render a final assistant response.
- [x] Add frontend action, analytics, ambiguity, and plugin tests.

## Phase 5: integration validation

- [x] Run focused host and plugin unit suites.
- [x] Restart MMGIS so backend changes are loaded.
- [x] Run every configured example through the actual UI workflow with a
  deterministic planner and real MMGIS action/rendering paths.
- [x] Record intent, selected action, structured result, and visible response
  for all 203 configured/generated occurrences.
- [x] Smoke-test the restarted live backend and configured provider.
- [x] Run five privacy-safe non-configured paraphrases, including an ambiguous
  request, against the real external provider.
- [x] Run all 203 configured/generated examples in one unspliced pass against
  the real provider with fixed public synthetic context, strict semantic/action
  outcomes, exactly one initial request per example, and continuation/privacy
  checks.
- [x] Document remaining capabilities that cannot yet be exposed safely.
