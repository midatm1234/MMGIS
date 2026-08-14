# `frozon` plugin container

FROZON-specific MMGIS plugins. Unlike the other containers under `plugins/`,
this one is **tracked in git** (via an explicit `!/plugins/frozon/` exception in
`.gitignore`) because a mission config in this repo depends on it and it cannot
be re-fetched with `npm run plugins install`.

## Tools

### AgentChat — the MMGIS Copilot

A draggable, resizable floating chat overlay for querying and driving the map in
natural language: listing layers, toggling them, setting opacity, zooming,
computing layer means and differences, and drawing contour/threshold overlays.

Opened from the **Copilot** button in the top bar (the toolbar button is hidden
by `AgentChat.css`; see `ensureLauncherControl` in `AgentChatTool.js`).

| File | Role |
|------|------|
| `plugin.json` | Manifest. `separatedTool: "custom"` — the tool owns its own DOM |
| `AgentChatTool.js` | Tool lifecycle, overlay UI, agent request/response handling |
| `renderers.js` | One renderer per action the agent can return (see `RENDERERS`) |
| `AgentChat.css` | Top-bar launcher chrome |
| `tests/agentChat.spec.js` | `@unit` guards on the manifest, renderer surface, and ported APIs |

#### Requires a backend that is not in this repository

The tool talks to two endpoints:

- `POST /api/agent` — `{ message, context }` in, a reply plus an `actions[]` list out
- `GET  /api/agent/tools` — the action registry the agent may use

**Neither is implemented in MMGIS.** They were served by a separate
`Frozon-MMGIS-Plugin-Backend` repository that was wired in as a git submodule at
`API/Frozon-MMGIS-Plugin-Backend`. That submodule is gone (it was never recorded
in `.gitmodules`, and its commit `0664220b` is not present in this clone), so the
backend has to be supplied separately — as a backend plugin under
`plugins/<container>/backend/`, or by proxying an external service.

Until one is running the overlay opens and works normally, but sending a message
reports `Agent is unavailable` / `Error contacting the copilot service` in the
transcript. That is surfaced deliberately rather than swallowed.

#### Provenance

Ported from `src/essence/Tools/AgentChat/` as it stood on the retired `hl-797`
branch. The port is faithful apart from moving to the current plugin layout:

- imports use the `@basics` webpack alias instead of `../../Basics/...`
- `ToolController_.makeTool(moduleName, index)` → `ToolController_.openTool('AgentChat')`
- `ToolController_.closeActiveTool()` → `ToolController_.closeTool('AgentChat')`
- the launcher styles moved out of `src/css/mmgis.css` into `AgentChat.css`
- `made` is now tracked, which is what lets `ToolController_` auto-open the tool
  when a mission config has it `on`
- `destroy()` no longer throws if called before `make()`

## Enabling it in a mission

Add it to the mission config's `tools` array — `js` must be the module name:

```json
{ "on": true, "name": "AgentChat", "icon": "robot-outline", "js": "AgentChatTool" }
```

After adding or changing a plugin, regenerate the frontend registries:

```powershell
npm run plugins -- activate
```
