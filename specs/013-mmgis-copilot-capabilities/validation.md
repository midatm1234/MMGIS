# Validation Report

**Feature**: 013
**Status**: Passed: deterministic actual-panel and exhaustive external-provider
validation
**Date**: 2026-08-16
**MMGIS working-tree base**: `d78a5326`
**Agent plug-in working-tree base**: `2d6310c`

## Result

The repaired AgentChat panel handled all 203 configured/generated example
occurrences in a running Frozon mission. Every occurrence rendered non-empty
text; none rendered the generic empty-response guard. Of the 203 turns, 190
completed actions, 10 returned information or a clarification, and 3 returned
truthful mission/data limitations. There were no infrastructure or renderer
failures.

Separately, the configured external provider handled all 203 occurrences in
one unspliced run through the real panel and backend. That matrix produced 182
successful action executions, 5 typed action limitations, 9 information
answers, and 7 grounded clarifications. All 203 were handled; none were blank
or generic. These totals are reported separately because the deterministic run
proves stable MMGIS execution/rendering while the external-provider run also
proves natural-language interpretation and tool selection against bounded
public context.

The complete per-occurrence records are embedded in the Playwright JSON report
as the `copilot-example-validation.json` attachment and console record. Each
record contains `family`, `query`, `intent`, `tools`, `handled`,
`executionSucceeded`, structured tool results, and the exact visible response:
[full 203-query artifact](../../validation-artifacts/copilot-example-validation-20260815.json).

The authoritative static, generated, dynamic, and contextual query families
live in
[`copilot_demo_queries.json`](../../plugins/NASA-AMMOS--MMGIS-Plugins/backend/Agent/config/copilot_demo_queries.json).
[`suggestions.js`](../../plugins/NASA-AMMOS--MMGIS-Plugins/tools/AgentChat/suggestions.js)
is the shared consumer used by welcome/empty-chat suggestions, demo playback,
zoom grammar generation, live-layer suggestions, and contextual follow-ups.
The artifact contains every configured occurrence produced by that source, not
only the seven chips visible in one panel state. All required record properties
are present in all 203 rows; `executionSucceeded` is `null` only for the 10
information or clarification turns where no tool execution was applicable.

## Evidence boundaries

The exhaustive run intercepted the planner and continuation HTTP routes with a
deterministic plan fixture. It did exercise the actual AgentChat panel, example
discovery, request construction, registry dispatch, MMGIS actions, browser
raster/analytics paths, structured tool-result continuation, and final chat
rendering against the running mission. It does **not** prove that an external
model interpreted those 203 queries.

External-provider evidence is recorded separately below. The real-provider
harness replaces outbound context with a fixed public synthetic fixture; it
never copies the loaded mission catalog or metadata into provider requests.
Only a fixed checked-in public catalog is sent; no live-derived layer URLs,
geometries, feature properties, credentials, or chat history leave the test.
Provider-selected actions still execute through the actual running Frozon
panel, so locally rendered tool results may contain live mission layer names.
Continuations replace those live results with fixed public synthetic values
before any external request. This validates provider behavior against public
fixture state, not provider grounding in private/live mission metadata.

## A. Exhaustive actual-panel/action workflow

**Mission**: `frozon`
**Base URL**: `http://localhost:8889`
**Browser**: Playwright Chromium, one worker
**Key environment**: `PLAYWRIGHT_TEST_UNIT_ONLY=1`,
`COPILOT_LIVE_UI=true`, `COPILOT_LIVE_MISSION=frozon`
**Playwright result**: 1 expected, 0 unexpected, 0 flaky; 188,918 ms test
duration (194.9 seconds wall time)
**Acceptance result**: 203/203 meaningful visible results; 0 blank; 0 generic
empty-response messages

The aggregate suite ceiling was raised from 12 to 30 minutes after a diagnostic
run reached the old total-suite limit at occurrence 178. That was a harness
budget exhaustion, not a production full-extent action timeout: the isolated
full-extent operation completed in about 1.1 seconds. Per-query bounds remain
60 seconds normally and 180 seconds for full-extent raster work.

### Family totals

| Family | Occurrences | Successful actions | Informative limitations | Information/clarification | Selected tools |
| --- | ---: | ---: | ---: | ---: | --- |
| `static` | 27 | 19 | 2 | 6 | layer listing/discovery, statistics, difference, threshold, time, visibility, navigation |
| `zoom` | 145 | 145 | 0 | 0 | `zoom_to` |
| `dynamic:visibleAnalyzable` | 7 | 7 | 0 | 0 | mean/statistics, relative highlight, temporal trend |
| `dynamic:timeEnabled` | 2 | 0 | 1 | 1 | animation handoff; declared time-range answer |
| `dynamic:comparison` | 2 | 2 | 0 | 0 | aligned layer difference |
| `dynamic:fallback` | 2 | 2 | 0 | 0 | analyzable-data fallback; layer listing |
| `contextual:analysis` | 4 | 3 | 0 | 1 | first-visible statistics, relative highlight, difference, clarification |
| `contextual:layers` | 5 | 5 | 0 | 0 | list, opacity, description |
| `contextual:navigation` | 5 | 5 | 0 | 0 | named-region navigation; list |
| `contextual:time` | 4 | 2 | 0 | 2 | set time; declared time-range answer |
| **Total** | **203** | **190** | **3** | **10** | |

### All 27 canonical configured examples

The response column contains an exact visible first line (or the complete
one-line response). Full multiline results, including numeric statistics and
layer lists, are preserved in the linked artifact.

| Query | Interpreted intent | Tool/action selected | Outcome | Actual Copilot response excerpt |
| --- | --- | --- | --- | --- |
| `What is MMGIS?` | Information | None | Pass | `MMGIS is a web-based geospatial mission operations and analysis application.` |
| `List layers` | Action | `list_layers` | Pass | `Layers:` |
| `Show analyzable layers` | Action | `list_analyzable_layers` | Pass | `Currently visible and analyzable: SFNO Prediction Daily 10 km 2022-2024.` |
| `Tell me about MMGIS` | Information | None | Pass | `MMGIS is a web-based geospatial mission operations and analysis application.` |
| `What time range is available for the current layer?` | Information | None | Pass | `The configured temporal range for SFNO Prediction Daily 10 km 2022-2024 is 2023-01-03T00:00:00Z through 2024-12-31T23:59:59Z.` |
| `What layers are available in this mission?` | Action | `list_layers` | Pass | `Layers:` |
| `Which layers can I analyze?` | Action | `list_analyzable_layers` | Pass | `Currently visible and analyzable: SFNO Prediction Daily 10 km 2022-2024.` |
| `Show statistics of the first visible data layer` | Action | `statistics_first_visible` | Pass | `Statistics for the first visible analyzable layer, SFNO Prediction Daily 10 km 2022-2024:` |
| `Show statistics of the first visible layer` | Action | `statistics_first_visible` | Pass | `Statistics for the first visible analyzable layer, SFNO Prediction Daily 10 km 2022-2024:` |
| `Move the time slider to the latest date` | Action | `set_time` | Pass | `Interpreting "latest" as "latest available date".` |
| `Set time to January 2024` | Action | `set_time` | Pass | `Parsed "January 2024" to 2024-01-01T00:00:00Z.` |
| `Turn on the forecast prediction layer` | Action | `toggle_layer` | Pass | `SFNO Prediction Daily 10 km 2022-2024 is now visible.` |
| `Compare Land Mask vs Ice Forecast` | Action | `calculate_layer_difference` | Pass: truthful limitation | `Cannot calculate a numeric layer difference. Land Mask: No scalar analytics source or plugin-provided analysis capability is registered for this layer.` |
| `Show the difference between predicted and ground truth ice` | Action | `calculate_layer_difference` | Pass | `Difference: SFNO Prediction Daily 10 km 2022-2024 - SFNO Ground Truth Daily 10 km 2022-2024` |
| `Highlight areas where the current layer exceeds its average value` | Action | `highlight_relative_to_mean` | Pass | `Highlighted values above the mean (60.9075) for SFNO Prediction Daily 10 km 2022-2024.` |
| `Calculate mean for GIBS MODIS True Color` | Action | `calculate_layer_mean` | Pass: truthful limitation | `GIBS MODIS True Color cannot provide scalar statistics. This is visualization-only RGB imagery and does not expose a meaningful scalar value for statistics. Choose a layer listed by “Which layers can I analyze?” instead.` |
| `Show me the sea ice forecast for January 2024` | Action | `toggle_layer`, `set_time` | Pass | `SFNO Prediction Daily 10 km 2022-2024 is now visible.` (followed by the January 2024 time result) |
| `What is the predicted sea ice concentration today?` | Information/limitation | None | Pass | `A current scalar forecast sample is required to answer this. The deterministic UI harness does not read external mission rasters.` |
| `Compare the AI prediction with ground truth for last week` | Clarification | None | Pass | `This comparison needs an explicit prior-week time range (or a successful time-control action) before the two rasters can be compared; the deterministic harness will not silently substitute the current map instant.` |
| `What is the sea ice extent trend over 2023?` | Action | `temporal_trends` | Pass | `Temporal Trend Analysis: SFNO Prediction Daily 10 km 2022-2024` |
| `Zoom to the Arctic region` | Action | `zoom_to` | Pass | `Zoomed to the Arctic Ocean at zoom level 3.` |
| `Zoom to the current area of interest` | Clarification | None | Pass | `No named area of interest is selected. Specify a region or bounding box to zoom there.` |
| `Turn on a data layer to analyze` | Action | compatible-layer fallback / `calculate_layer_mean` | Pass | `Analytics service unavailable; statistics computed locally from the active raster.` |
| `Show available data layers` | Action | `list_layers` | Pass | `Layers:` |
| `Zoom into the Chukchi Sea at zoom level 4` | Action | `zoom_to` | Pass | `Zoomed to the Chukchi Sea at zoom level 4.` |
| `Zoom to the Greenland Sea at zoom level 5` | Action | `zoom_to` | Pass | `Zoomed to the Greenland Sea at zoom level 5.` |
| `Zoom into the Beaufort Sea at zoom level 3` | Action | `zoom_to` | Pass | `Zoomed to the Beaufort Sea at zoom level 3.` |

### Generated and contextual highlights

- All 145 generated named-region/grammar/zoom-level combinations executed
  `zoom_to` and returned verified visible text.
- Full-layer-extent statistics completed with `calculate_layer_mean`: mean
  57.3928%, standard deviation 47.2800%, range 0–100%, 85,901 valid cells, and
  the configured `(b1*100)` scalar expression.
- Prediction-versus-ground-truth comparison resolved semantic role aliases,
  aligned the two rasters, and returned difference statistics.
- The contextual opacity, layer-description, latest-date, January 2024,
  first-visible statistics, above-average highlight, and comparison requests
  all completed through the corresponding MMGIS action/analytics handlers.
- The one generated animation request returned
  `The Animation tool is not available in the current mission.` This is an
  accepted mission capability limitation, not an empty or generic response.

## B. Real backend/provider evidence

The configured Azure published-agent endpoint was smoke-tested after the final
server restart. `What is MMGIS?` returned HTTP 200, no action, a conversation
identifier, and the non-empty response beginning `MMGIS (Multi-Mission
Geographic Information System) is NASA AMMOS/JPL’s web-based platform...`.
The live tools endpoint also returned HTTP 200 with 25 capabilities.

### Exhaustive fixed-public provider matrix

The full provider matrix passed 1/1 in Playwright Chromium with one worker:
909,475 ms test duration, 911,513 ms total report duration (about 15.2
minutes). The run submitted all 203 occurrences in configuration order through
the actual AgentChat panel, backend, configured provider, MMGIS action
registry, action continuation, and visible renderer.

The strict transport audit recorded exactly 203 initial `/api/agent` requests,
one per example. Action turns could additionally use `/api/agent/continue`.
Every initial and continuation request used empty history and the bounded
public fixture; serialized outbound traffic contained no live URLs, features,
geometry, properties, or descriptions. The complete records contain query,
family, interpreted intent, action arguments, selected tools, execution status,
structured tool results, outcome, baseline proof, and exact visible response:

- [203-row provider artifact](../../validation-artifacts/copilot-real-public-exhaustive-validation-20260816.json)
- [green Playwright report](../../validation-artifacts/copilot-real-exhaustive-playwright-report-20260815.json)

All required properties are present in every row. `executionSucceeded` is
`null` only for the 16 information/clarification turns where execution was not
applicable.

#### Provider family totals

| Family | Occurrences | Successful actions | Typed action limitations | Information | Clarification |
| --- | ---: | ---: | ---: | ---: | ---: |
| `static` | 27 | 18 | 1 | 6 | 2 |
| `zoom` | 145 | 145 | 0 | 0 | 0 |
| `dynamic:visibleAnalyzable` | 7 | 5 | 1 | 0 | 1 |
| `dynamic:timeEnabled` | 2 | 0 | 1 | 1 | 0 |
| `dynamic:comparison` | 2 | 2 | 0 | 0 | 0 |
| `dynamic:fallback` | 2 | 2 | 0 | 0 | 0 |
| `contextual:analysis` | 4 | 1 | 1 | 0 | 2 |
| `contextual:layers` | 5 | 2 | 1 | 0 | 2 |
| `contextual:navigation` | 5 | 5 | 0 | 0 | 0 |
| `contextual:time` | 4 | 2 | 0 | 2 | 0 |
| **Total** | **203** | **182** | **5** | **9** | **7** |

#### All 27 canonical provider examples

The response column quotes an exact visible first line where backticked and
otherwise gives a concise summary. Complete multiline responses and numeric
provenance are in the linked artifact.

| Query | Interpreted intent | Tool/action | Execution | Actual Copilot response excerpt |
| --- | --- | --- | --- | --- |
| `What is MMGIS?` | Information | None | N/A | `MMGIS is NASA's Multi-Mission Geographic Information System: a web-based mapping and analysis platform...` |
| `List layers` | Layer inventory | `list_layers` | Pass | `Layers:` followed by all five loaded live-mission layers and visibility/time state. |
| `Show analyzable layers` | Analytics discovery | `list_analyzable_layers` | Pass | `Currently visible and analyzable: SFNO Prediction Daily 10 km 2022-2024.` |
| `Tell me about MMGIS` | Information | None | N/A | `MMGIS (Multi-Mission Geographic Information System) is NASA AMMOS/JPL’s web-based mapping platform...` |
| `What time range is available for the current layer?` | Temporal information | None | N/A | `The current active layer is Ice Forecast... 2023-01-01T00:00:00Z to 2024-12-31T00:00:00Z.` |
| `What layers are available in this mission?` | Layer inventory | `list_layers` | Pass | `Layers:` followed by the complete live catalog. |
| `Which layers can I analyze?` | Analytics discovery | `list_analyzable_layers` | Pass | Listed two analyzable layers and three unsupported/visualization layers with reasons. |
| `Show statistics of the first visible data layer` | First-visible statistics | `statistics_first_visible` | Pass | `Statistics for the first visible analyzable layer, SFNO Prediction Daily 10 km 2022-2024:` followed by real local-raster statistics. |
| `Show statistics of the first visible layer` | First-visible statistics | `statistics_first_visible` | Pass | Reported mean 71.9008%, std 42.6677%, quantiles, 0–100% range, and 64,961 valid samples. |
| `Move the time slider to the latest date` | Temporal action | `set_time` | Pass | `Interpreting "latest" as "latest available date".` followed by verified layer updates. |
| `Set time to January 2024` | Temporal action | `set_time` | Pass | `Parsed "January 2024" to 2024-01-01T00:00:00Z.` |
| `Turn on the forecast prediction layer` | Idempotent visibility | None | N/A | `Ice Forecast is already visible.` |
| `Compare Land Mask vs Ice Forecast` | Compatibility information | None | N/A | Explained that Land Mask has no scalar comparison capability and suggested Ice Ground Truth. |
| `Show the difference between predicted and ground truth ice` | Raster comparison | `calculate_layer_difference` | Pass | `Difference: SFNO Prediction Daily 10 km 2022-2024 - SFNO Ground Truth Daily 10 km 2022-2024` followed by aligned difference statistics. |
| `Highlight areas where the current layer exceeds its average value` | Relative threshold | `highlight_relative_to_mean` | Typed limitation | `The threshold overlay could not load raster tiles from the configured source.` (`HIGHLIGHT_TILE_LOAD_FAILED`) |
| `Calculate mean for GIBS MODIS True Color` | Compatibility information | None | N/A | Explained that visualization-only RGB imagery has no scalar mean and suggested analyzable layers. |
| `Show me the sea ice forecast for January 2024` | Temporal action | `set_time` | Pass | `Parsed "January 2024" to 2024-01-01T00:00:00Z.` followed by verified live-layer updates. |
| `What is the predicted sea ice concentration today?` | Current-view statistics | `calculate_layer_mean` | Pass | Reported current-view mean 71.9008%, distribution statistics, 64,961 valid samples, and provenance. |
| `Compare the AI prediction with ground truth for last week` | Range ambiguity/limitation | None | Clarification | Explained that comparison supports one map time, not a week interval, and asked for current time or one exact date. |
| `What is the sea ice extent trend over 2023?` | Temporal analytics | `temporal_trends` | Pass | `Temporal Trend Analysis: SFNO Prediction Daily 10 km 2022-2024` with 12 monthly samples and trend statistics. |
| `Zoom to the Arctic region` | Named-region navigation | `zoom_to` | Pass | `Zoomed to the Arctic Ocean at zoom level 3.` |
| `Zoom to the current area of interest` | Missing AOI | None | Clarification | `No area of interest or selection extent is currently available.` Asked for current view, named region, or coordinates/bbox. |
| `Turn on a data layer to analyze` | Compatible-layer visibility | `toggle_layer` | Pass | `SFNO Ground Truth Daily 10 km 2022-2024 is now visible.` |
| `Show available data layers` | Data-layer inventory | `list_layers` | Pass | `Layers:` followed by the complete live catalog. |
| `Zoom into the Chukchi Sea at zoom level 4` | Named-region navigation | `zoom_to` | Pass | `Zoomed to the Chukchi Sea at zoom level 4.` |
| `Zoom to the Greenland Sea at zoom level 5` | Named-region navigation | `zoom_to` | Pass | `Zoomed to the Greenland Sea at zoom level 5.` |
| `Zoom into the Beaufort Sea at zoom level 3` | Named-region navigation | `zoom_to` | Pass | `Zoomed to the Beaufort Sea at zoom level 3.` |

#### Generated/contextual provider highlights

- All 145 generated region/grammar/zoom combinations selected `zoom_to`,
  executed successfully, and returned visible confirmation.
- Full-layer-extent statistics selected `calculate_layer_mean` with
  `geographical_area: "full layer extent"` and returned mean 57.4832%, std
  47.5109%, 0–100% range, 85,837 valid cells, `(b1*100)`, and
  native-resolution-raster-window provenance.
- `Show Ice Forecast changes over time` selected `temporal_trends` and returned
  24 monthly samples across 2023–2024 plus trend statistics.
- Both generated comparison phrasings selected aligned raster difference and
  succeeded. Generic `Analyze Ice Forecast` correctly asked which supported
  analysis the user wanted instead of guessing.
- The five typed action limitations were preserved and rendered: three
  `HIGHLIGHT_TILE_LOAD_FAILED` results for the current configured threshold
  tile source, one `ANIMATION_TOOL_UNAVAILABLE`, and one
  `LAYER_INFORMATION_UNAVAILABLE`. The layer-information response still
  returned known type, visibility, and time state while explaining that no
  descriptive mission summary was configured.
- Contextual opacity and layer-information requests without a unique target
  asked for a layer. Comparison of visible analyzable layers explained that
  only Ice Forecast was visible and offered to enable Ice Ground Truth first.

### Real-provider paraphrases

The final paraphrase smoke passed 1/1 in 26.2 seconds with all five records
handled: four successful actions and one grounded clarification, with no blank
or generic response. All outbound requests again used fixed public synthetic
context:

- [five-row paraphrase artifact](../../validation-artifacts/copilot-real-provider-paraphrases-20260816.json)
- [green paraphrase Playwright report](../../validation-artifacts/copilot-real-provider-paraphrases-playwright-report-20260816.json)

| Query | Interpreted intent | Tool/action selected | Outcome | Actual Copilot response |
| --- | --- | --- | --- | --- |
| `What layers can be analyzed?` | Analyzable-layer discovery | `list_analyzable_layers` | Pass | Identified SFNO Prediction as visible/analyzable; listed two analyzable layers and three unsupported layers with reasons. |
| `Give me stats for the visible layer` | First-visible statistics | `statistics_first_visible` | Pass | Reported SFNO Prediction mean 63.4099%, std 46.3243%, q25 0.1341%, median 97.9377%, q75 99.8507%, min 0%, max 100%, and 66,037 valid cells. |
| `Take me to the Beaufort Sea` | Named-region navigation | `zoom_to` | Pass | `Zoomed to the Beaufort Sea at zoom level 5.` |
| `Show the Beaufort Sea at zoom 3` | Named-region navigation with level | `zoom_to` | Pass | `Zoomed to the Beaufort Sea at zoom level 3.` |
| `Hide the current layer` | Ambiguous layer target | None | Pass: clarification | `I can’t identify a current or active layer from the available UI state. Please name the layer you want to hide.` |

## C. Automated regression results

| Scope | Result | What it covers |
| --- | ---: | --- |
| Host Copilot action registry | 17/17 passed | Namespacing, schema validation, discovery, availability, invocation, unregister, analytic applicability |
| Full installed plug-in unit suite, `AUTH=off` | 257/257 passed | Final current-tree backend/frontend Copilot contracts plus existing plug-in regressions |
| Full installed plug-in unit suite, `AUTH=local` | 257/257 passed | Final protected-mode compatibility and existing plug-in regressions |
| Focused post-full-extent frontend set | 48/48 passed | Resolver roles, CRS/bbox handling, workflow, examples, browser dispatch |
| Final focused AgentChat capability set | 37/37 passed | Action dispatch, rendering, typed results, and removal of nested provider calls |
| Final focused provider-policy/traffic set | 17/17 passed | Semantic dual outcomes, ambiguity, exactly one initial request per user turn, privacy audit |
| Azure Responses + provider contract | 39/39 passed | Final prompt routing, function-call parsing, `call_id`, continuation, streaming, malformed/empty response behavior |
| Real Rasterio integration | 2/2 passed | Statistics and aligned raster difference |
| Exhaustive running-panel example test | 1/1 passed, 203 records | Real panel/actions/analytics/rendering with deterministic planner |
| Exhaustive real-provider example test | 1/1 passed, 203 records | Real panel/backend/provider interpretation, action execution, continuation, rendering, traffic/privacy audit |
| Real-provider paraphrases | 1/1 passed, 5 records | Four successful paraphrased actions plus one grounded ambiguity clarification |

Required regression scenarios are present for informational answers, layer
listing and visibility, analyzable-layer discovery, named-region zoom with and
without explicit level, temporal commands, first-visible statistics,
threshold/highlight, comparison, runtime plug-in actions, ambiguity,
unsupported analysis, post-tool assistant text, tool exceptions, and
malformed/empty provider output. The browser workflow specifically verifies
that a successful action is continued and final assistant text is rendered;
exceptions are structured, sanitized, continued, and rendered.

## D. Remaining safe capability boundaries

- Scalar analytics intentionally reject RGB visualization imagery, missing or
  unknown CRS, unsupported scalar transforms, unverified NoData/ranges, and
  comparisons whose units cannot be proven compatible. These return typed
  explanations instead of fabricated numbers.
- The current Frozon mission's Land Mask does not expose a registered scalar
  analytics source, so numeric comparison with the ice forecast is unavailable.
- Relative-threshold selection and dispatch are implemented, but three turns
  in the final provider run could not load raster tiles from the currently
  configured threshold source. They returned `HIGHLIGHT_TILE_LOAD_FAILED`
  rather than claiming that a visual overlay was created.
- The current mission does not expose an Animation tool. The maintained
  Analysis plug-in can register its Copilot action, but an installed legacy
  Analysis build without that registration returns a typed unavailable/manual
  handoff rather than invoking an unknown global.
- A loaded layer without descriptive mission metadata can still report its
  type, visibility, and time state, but returns
  `LAYER_INFORMATION_UNAVAILABLE` for the missing scientific summary.
- Plug-in-specific controls are discoverable only after the owning plug-in
  opts in through the namespaced Copilot action registry. Arbitrary plug-in
  browser code and arbitrary `window` methods are deliberately never exposed.
- Antimeridian-spanning analytic bounds are rejected rather than silently
  split, and NetCDF sources without a registered analytic adapter remain
  unsupported.
- Layer-group expanded/collapsed state is panel-local in MMGIS. Copilot uses
  the same layer-panel owner/action when present; it does not manufacture a
  separate global state.

These boundaries preserve data integrity and existing plug-in behavior. They
are extension points, not reasons for a supported action to return a blank
assistant message.
