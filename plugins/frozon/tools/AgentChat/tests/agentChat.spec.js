/**
 * @unit coverage for the AgentChat (MMGIS Copilot) plugin.
 *
 * AgentChat was ported here from the pre-pluginization tree
 * (src/essence/Tools/AgentChat/ on the retired hl-797 branch). These checks are
 * static on purpose: the tool imports webpack aliases (@basics) and jQuery, so
 * importing it outside a bundle would fail. What they guard is the port itself —
 * the manifest shape the loader needs, the renderer action names the tool
 * dispatches on, and the ToolController_ APIs that replaced the removed ones.
 */
import { test, expect } from '@playwright/test'
const fs = require('fs')
const path = require('path')

const PLUGIN_DIR = path.resolve(__dirname, '..')
const readPlugin = (file) =>
    fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8')

test.describe('AgentChat plugin @unit', () => {
    test('manifest declares what the tool loader needs', () => {
        const manifest = JSON.parse(readPlugin('plugin.json'))

        expect(manifest.type).toBe('tool')
        // Must match the `name` used in a mission config's `tools` entry —
        // ToolController_.openTool/closeTool are keyed by it.
        expect(manifest.name).toBe('AgentChat')
        // The tool draws its own floating overlay, so it must not be wrapped in
        // a framed panel.
        expect(manifest.separatedTool).toBe('custom')
        // `js` in the mission config resolves through paths.
        expect(manifest.paths.AgentChatTool).toBe('./AgentChatTool')
        expect(manifest.uuid).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })

    test('every file the manifest and tool reference exists', () => {
        for (const file of [
            'AgentChatTool.js',
            'renderers.js',
            'AgentChat.css',
        ]) {
            expect(
                fs.existsSync(path.join(PLUGIN_DIR, file)),
                `${file} is missing`
            ).toBe(true)
        }
    })

    test('renderers exposes the action names the agent can return', () => {
        const source = readPlugin('renderers.js')
        const block = source.match(/export const RENDERERS = \{([\s\S]*?)\n\}/)
        expect(block, 'RENDERERS map not found').not.toBeNull()

        const keys = block[1]
            .split('\n')
            .map((line) => line.match(/^\s*([a-z_][a-z0-9_]*)\s*[:,]/i))
            .filter(Boolean)
            .map((m) => m[1])

        // The server names these actions in its responses; dropping one
        // silently degrades a reply to "unsupported action".
        for (const action of [
            'layers_line',
            'links_summary',
            'zoom_view',
            'set_opacity',
            'toggle_visibility',
            'layer_information',
            'layer_mean',
            'contour_overlay',
            'layer_difference',
        ]) {
            expect(keys, `RENDERERS.${action} is missing`).toContain(action)
        }
    })

    test('tool uses the current ToolController_ API, not the removed one', () => {
        const source = readPlugin('AgentChatTool.js')

        // makeTool(name, idx) and closeActiveTool() were the pre-pluginization
        // internals; openTool/closeTool are the documented name-keyed
        // replacements (see plugins/README.md).
        expect(source).not.toMatch(/ToolController_\.makeTool\(/)
        expect(source).not.toMatch(/closeActiveTool/)
        expect(source).toMatch(/ToolController_\.openTool\(/)
        expect(source).toMatch(/closeTool\?\.\(AGENT_TOOL_NAME\)/)

        // Relative src/essence imports do not resolve from plugins/.
        expect(source).not.toMatch(/from '\.\.\/\.\.\/Basics\//)
        expect(source).toMatch(/from '@basics\//)
    })

    test('separated-tool lifecycle flags are maintained', () => {
        const source = readPlugin('AgentChatTool.js')

        // ToolController_ auto-opens a separated tool only while made === false.
        expect(source).toMatch(/made:\s*false/)
        expect(source).toMatch(/this\.made = true/)
        expect(source).toMatch(/this\.made = false/)
    })
})
