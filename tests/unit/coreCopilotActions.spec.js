import { test, expect } from '@playwright/test'
import {
    copilotActionId,
    createCopilotActionRegistry,
} from '../../src/essence/mmgisAPI/CopilotActionRegistry.js'
import { registerCoreCopilotActions } from '../../src/essence/mmgisAPI/CoreCopilotActions.js'

function makeHarness() {
    const calls = []
    const layers = {
        view: [71, -150, 4],
        _layersOrdered: ['ice', 'land', 'places'],
        layers: {
            dataFlat: [
                {
                    name: 'science',
                    display_name: 'Science Layers',
                    type: 'header',
                },
                { name: 'ice', type: 'data' },
            ],
            data: {
                ice: { name: 'Ice' },
                land: { name: 'Land' },
                places: { name: 'Places' },
            },
            layer: {
                ice: { _layers: {} },
                land: { updateFilter() {} },
                places: { _layers: {} },
            },
        },
        asLayerUUID(name) {
            const aliases = {
                Ice: 'ice',
                Land: 'land',
                Places: 'places',
            }
            return aliases[name] || (this.layers.data[name] ? name : null)
        },
    }
    const tools = {
        tools: [{ name: 'Layers' }, { name: 'Info' }],
    }
    const time = {
        enabled: true,
        timeUI: {},
    }
    let selectionResult = true
    const api = {
        map: {
            getMinZoom: () => 0,
            getMaxZoom: () => 18,
        },
        resetMapView() {
            calls.push(['resetMapView'])
            return { latitude: 71, longitude: -150, zoom: 4 }
        },
        openTool(name) {
            calls.push(['openTool', name])
            return { tool: name, open: true }
        },
        closeTool(name) {
            calls.push(['closeTool', name])
            return { tool: name, open: false }
        },
        stepTime(direction) {
            calls.push(['stepTime', direction])
            return { direction, time: '2026-08-15T00:00:00Z' }
        },
        setTimePlayback(playing) {
            calls.push(['setTimePlayback', playing])
            return { playing }
        },
        selectFeature(layer, options) {
            calls.push(['selectFeature', layer, options])
            return selectionResult
        },
        setLayerFilter(layer, filter, value) {
            calls.push(['setLayerFilter', layer, filter, value])
            return { layer, filter, value, filters: { [filter]: value } }
        },
        getLayerGroups() {
            return layers.layers.dataFlat
                .filter((layer) => layer.type === 'header')
                .map((layer) => ({
                    name: layer.name,
                    displayName: layer.display_name || layer.name,
                    expanded: null,
                }))
        },
        setLayerGroupExpanded(group, expanded) {
            calls.push(['setLayerGroupExpanded', group, expanded])
            return {
                name: 'science',
                displayName: 'Science Layers',
                expanded,
                changed: true,
            }
        },
        setAllLayerGroupsExpanded(expanded) {
            calls.push(['setAllLayerGroupsExpanded', expanded])
            return {
                expanded,
                changed: 1,
                groups: [
                    {
                        name: 'science',
                        displayName: 'Science Layers',
                        expanded,
                    },
                ],
            }
        },
        reorderLayer(layer, position, relativeTo) {
            calls.push(['reorderLayer', layer, position, relativeTo])
            return {
                layer,
                position,
                relativeTo,
                order: ['land', 'ice', 'places'],
            }
        },
    }
    const registry = createCopilotActionRegistry({
        logger: { error() {} },
    })
    return {
        api,
        calls,
        layers,
        registry,
        time,
        tools,
        setSelectionResult(value) {
            selectionResult = value
        },
    }
}

function register(harness) {
    return registerCoreCopilotActions(harness.registry, harness)
}

test.describe('core Copilot actions', () => {
    test('registers the non-duplicative built-ins once with portable ids', async () => {
        const harness = makeHarness()
        const first = register(harness)
        const second = register(harness)
        const actions = await harness.registry.list()

        expect(second).toEqual(first)
        expect(actions).toHaveLength(10)
        expect(actions.every((action) => action.available)).toBe(true)
        expect(actions.map((action) => action.id)).toEqual(first)
        expect(
            actions.every((action) =>
                /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(action.id)
            )
        ).toBe(true)
        expect(actions.map((action) => action.name)).not.toEqual(
            expect.arrayContaining([
                'toggle_layer',
                'set_layer_opacity',
                'zoom_to',
                'set_time',
            ])
        )
        const selectFeature = actions.find(
            (action) => action.name === 'select_feature'
        )
        expect(selectFeature.parameters.description).toContain(
            'exactly one selector'
        )
        expect(selectFeature.parameters.oneOf).toBeUndefined()
    })

    test('delegates map, tool, and temporal actions with useful responses', async () => {
        const harness = makeHarness()
        register(harness)

        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'reset_map_view')
            )
        ).resolves.toEqual({
            ok: true,
            message:
                'Reset the map to the configured home view at zoom level 4.',
            data: { latitude: 71, longitude: -150, zoom: 4 },
            error: null,
        })
        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'open_tool'),
                { name: 'Layers' }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Opened the Layers tool.',
        })
        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'close_tool'),
                { name: 'Layers' }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Closed the Layers tool.',
        })
        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'step_time'),
                { direction: 'forward' }
            )
        ).resolves.toMatchObject({
            ok: true,
            message:
                'Stepped the map time forward. Current time: 2026-08-15T00:00:00Z.',
        })
        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'set_time_playback'),
                { playing: true }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Started time playback.',
        })
        expect(harness.calls).toEqual([
            ['resetMapView'],
            ['openTool', 'Layers'],
            ['closeTool', 'Layers'],
            ['stepTime', 'forward'],
            ['setTimePlayback', true],
        ])
    })

    test('evaluates time availability dynamically and blocks execution', async () => {
        const harness = makeHarness()
        register(harness)
        harness.time.enabled = false

        const available = await harness.registry.list({ availableOnly: true })
        expect(available.map((action) => action.name)).not.toContain('step_time')
        expect(available.map((action) => action.name)).not.toContain(
            'set_time_playback'
        )
        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'step_time'),
                { direction: 'backward' }
            )
        ).resolves.toEqual({
            ok: false,
            message: 'Time controls are not enabled for this mission.',
            data: null,
            error: {
                code: 'ACTION_UNAVAILABLE',
                reason: 'Time controls are not enabled for this mission.',
            },
        })
        expect(harness.calls).toEqual([])
    })

    test('selects features through the facade and reports no-match safely', async () => {
        const harness = makeHarness()
        register(harness)
        const actionId = copilotActionId('mmgis-core', 'select_feature')

        await expect(
            harness.registry.execute(actionId, {
                layer_name: 'Ice',
                property: 'status',
                value: false,
                go_to_feature: true,
                zoom: 6,
            })
        ).resolves.toMatchObject({
            ok: true,
            message: 'Selected a feature in layer "Ice".',
            data: { layer: 'ice', selected: true },
        })
        expect(harness.calls[0]).toEqual([
            'selectFeature',
            'ice',
            {
                key: 'status',
                value: false,
                view: 'go',
                zoom: 6,
            },
        ])

        harness.setSelectionResult(false)
        await expect(
            harness.registry.execute(actionId, {
                layer_name: 'Ice',
                layer_id: 9,
            })
        ).resolves.toMatchObject({
            ok: false,
            message: 'No matching feature was found in layer "Ice".',
            error: { code: 'FEATURE_NOT_FOUND' },
        })
    })

    test('delegates validated filter and model-level reorder actions', async () => {
        const harness = makeHarness()
        register(harness)

        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'set_layer_filter'),
                {
                    layer_name: 'Land',
                    filter: 'contrast',
                    value: 1.5,
                }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Set contrast for "Land" to 1.5.',
        })
        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'reorder_layer'),
                {
                    layer_name: 'Ice',
                    position: 'before',
                    relative_to: 'Land',
                }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Moved "Ice" before "Land".',
            data: {
                layer: 'Ice',
                position: 'before',
                relativeTo: 'Land',
            },
        })
        expect(harness.calls).toEqual([
            ['setLayerFilter', 'Land', 'contrast', 1.5],
            ['reorderLayer', 'Ice', 'before', 'Land'],
        ])
    })

    test('delegates verified single and all layer-group state changes', async () => {
        const harness = makeHarness()
        register(harness)

        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'set_layer_group_expanded'),
                { group_name: 'Science Layers', expanded: false }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Collapsed layer group "Science Layers".',
            data: { expanded: false, changed: true },
        })
        await expect(
            harness.registry.execute(
                copilotActionId(
                    'mmgis-core',
                    'set_all_layer_groups_expanded'
                ),
                { expanded: true }
            )
        ).resolves.toMatchObject({
            ok: true,
            message: 'Expanded all layer groups.',
            data: { expanded: true, changed: 1 },
        })
        expect(harness.calls).toEqual([
            ['setLayerGroupExpanded', 'Science Layers', false],
            ['setAllLayerGroupsExpanded', true],
        ])
    })

    test('hides layer-group actions when no groups are configured', async () => {
        const harness = makeHarness()
        register(harness)
        harness.layers.layers.dataFlat = harness.layers.layers.dataFlat.filter(
            (layer) => layer.type !== 'header'
        )

        const available = await harness.registry.list({ availableOnly: true })
        expect(available.map((action) => action.name)).not.toContain(
            'set_layer_group_expanded'
        )
        expect(available.map((action) => action.name)).not.toContain(
            'set_all_layer_groups_expanded'
        )
    })

    test('does not claim success for an unverified layer-group change', async () => {
        const harness = makeHarness()
        harness.api.setLayerGroupExpanded = () => ({
            name: 'science',
            displayName: 'Science Layers',
            expanded: true,
        })
        register(harness)

        await expect(
            harness.registry.execute(
                copilotActionId('mmgis-core', 'set_layer_group_expanded'),
                { group_name: 'Science Layers', expanded: false }
            )
        ).resolves.toMatchObject({
            ok: false,
            message: 'MMGIS could not verify the requested layer group state.',
            error: { code: 'LAYER_GROUP_STATE_NOT_VERIFIED' },
        })
    })
})
