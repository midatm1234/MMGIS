import { test, expect } from '@playwright/test'
import {
    copilotActionId,
    createCopilotActionRegistry,
} from '../../src/essence/mmgisAPI/CopilotActionRegistry.js'

const descriptor = (overrides = {}) => ({
    name: 'summarize_layer',
    plugin: 'example/tools/Analysis',
    category: 'analytics',
    description: 'Summarize values in a configured data layer.',
    parameters: {
        type: 'object',
        properties: { layer: { type: 'string' } },
        required: ['layer'],
    },
    ...overrides,
})

function makeRegistry() {
    return createCopilotActionRegistry({
        logger: { error() {} },
    })
}

test.describe('CopilotActionRegistry', () => {
    test('discovers and invokes a plugin-provided action', async () => {
        const registry = makeRegistry()
        const id = registry.register(descriptor(), async (args, context) => ({
            message: `Summarized ${args.layer}.`,
            data: { count: 4, mission: context.mission },
        }))

        expect(id).toBe('example_tools_analysis__summarize_layer')
        const discovered = await registry.list()
        expect(discovered).toEqual([
            expect.objectContaining({
                id,
                name: 'summarize_layer',
                plugin: 'example/tools/Analysis',
                category: 'analytics',
                available: true,
            }),
        ])
        expect(discovered[0].handler).toBeUndefined()
        expect(discovered[0].availability).toBeUndefined()

        await expect(
            registry.execute(id, { layer: 'Temperature' }, { mission: 'Demo' })
        ).resolves.toEqual({
            ok: true,
            message: 'Summarized Temperature.',
            data: { count: 4, mission: 'Demo' },
            error: null,
        })
    })

    test('keeps same-named actions namespaced and rejects id collisions', async () => {
        const registry = makeRegistry()
        registry.register(descriptor({ plugin: 'plugin-one' }), () => 'one')
        registry.register(descriptor({ plugin: 'plugin-two' }), () => 'two')

        const discovered = await registry.list()
        expect(discovered.map((action) => action.id).sort()).toEqual([
            'plugin-one__summarize_layer',
            'plugin-two__summarize_layer',
        ])
        expect(() =>
            registry.register(descriptor({ plugin: 'plugin-one' }), () => 'new')
        ).toThrow(/already registered/)

        // Dots and slashes both normalize to an underscore. The second plugin
        // must not silently overwrite the first when that happens.
        const colliding = makeRegistry()
        colliding.register(descriptor({ plugin: 'org.plugin' }), () => 'one')
        expect(() =>
            colliding.register(descriptor({ plugin: 'org/plugin' }), () => 'two')
        ).toThrow(/owned by plugin "org\.plugin"/)
    })

    test('does not invoke an unavailable action', async () => {
        const registry = makeRegistry()
        let invoked = false
        const id = registry.register(
            descriptor(),
            () => {
                invoked = true
            },
            () => ({
                available: false,
                reason: 'No analyzable layer is visible.',
            })
        )

        const discovered = await registry.list()
        expect(discovered[0].available).toBe(false)
        expect(discovered[0].unavailableReason).toBe(
            'No analyzable layer is visible.'
        )
        await expect(registry.execute(id, {})).resolves.toEqual({
            ok: false,
            message: 'No analyzable layer is visible.',
            data: null,
            error: {
                code: 'ACTION_UNAVAILABLE',
                reason: 'No analyzable layer is visible.',
            },
        })
        expect(invoked).toBe(false)
    })

    test('catches handler exceptions and preserves a debuggable cause', async () => {
        const registry = makeRegistry()
        const id = registry.register(descriptor(), () => {
            const error = new Error('analytics endpoint timed out')
            error.code = 'ETIMEDOUT'
            throw error
        })

        const result = await registry.execute(id, {})
        expect(result.ok).toBe(false)
        expect(result.message).toBe('summarize layer could not be completed.')
        expect(result.data).toBeNull()
        expect(result.error).toEqual({
            code: 'ACTION_EXECUTION_FAILED',
            cause: {
                name: 'Error',
                message: 'analytics endpoint timed out',
                code: 'ETIMEDOUT',
            },
        })
    })

    test('normalizes successful primitive and empty handler results', async () => {
        const registry = makeRegistry()
        const numberId = registry.register(
            descriptor({ name: 'count_features' }),
            () => 7
        )
        const emptyId = registry.register(
            descriptor({ name: 'reset_highlight' }),
            () => undefined
        )

        await expect(registry.execute(numberId)).resolves.toEqual({
            ok: true,
            message: 'count features completed.',
            data: 7,
            error: null,
        })
        await expect(registry.execute(emptyId)).resolves.toEqual({
            ok: true,
            message: 'reset highlight completed.',
            data: null,
            error: null,
        })
    })

    test('strips functions from discovery and protects unregister ownership', async () => {
        const registry = makeRegistry()
        const id = registry.register(
            descriptor({
                parameters: {
                    type: 'object',
                    helper() {},
                    properties: {
                        layer: { type: 'string', transform() {} },
                        constructor: { type: 'string' },
                    },
                },
                privateHelper() {},
            }),
            () => 'done',
            () => true
        )

        const discovered = await registry.list()
        expect(discovered[0].parameters.helper).toBeUndefined()
        expect(
            discovered[0].parameters.properties.layer.transform
        ).toBeUndefined()
        expect(
            Object.hasOwn(
                discovered[0].parameters.properties,
                'constructor'
            )
        ).toBe(false)
        expect(discovered[0].privateHelper).toBeUndefined()
        expect(() => registry.unregister(id, 'another-plugin')).toThrow(
            /cannot unregister/
        )
        expect(registry.unregister(id, 'example/tools/Analysis')).toBe(true)
        expect(await registry.list()).toEqual([])
    })

    test('preserves bounded serializable analytics applicability metadata', async () => {
        const registry = makeRegistry()
        registry.register(
            descriptor({
                analytics: {
                    operations: ['statistics', ' mean ', 'mean'],
                    dataKinds: ['scalar-raster', 'time-series'],
                    requiresScalar: true,
                    supportCheck() {},
                },
            }),
            () => 'done'
        )

        const [discovered] = await registry.list()
        expect(discovered.analytics).toEqual({
            operations: ['statistics', 'mean'],
            dataKinds: ['scalar-raster', 'time-series'],
            requiresScalar: true,
        })
        expect(discovered.analytics.supportCheck).toBeUndefined()
    })

    test('rejects malformed or oversized analytics applicability metadata', () => {
        const registry = makeRegistry()
        let actionIndex = 0
        const registerAnalytics = (analytics) =>
            registry.register(
                descriptor({
                    name: `analytics_${(actionIndex += 1)}`,
                    analytics,
                }),
                () => 'done'
            )

        expect(() => registerAnalytics({ operations: 'mean' })).toThrow(
            /operations must be an array/
        )
        expect(() =>
            registerAnalytics({ dataKinds: Array(33).fill('scalar') })
        ).toThrow(/at most 32 values/)
        expect(() =>
            registerAnalytics({ operations: ['x'.repeat(65)] })
        ).toThrow(/1 to 64 safe characters/)
        expect(() =>
            registerAnalytics({ requiresScalar: 'yes' })
        ).toThrow(/requiresScalar must be a boolean/)
    })

    test('uses portable model-visible ids', () => {
        expect(copilotActionId('NASA/MMGIS.Plugin', 'Run Stats')).toBe(
            'nasa_mmgis_plugin__run_stats'
        )
        expect(copilotActionId('9-labs/tools/Analysis', 'mean')).toBe(
            'action_9-labs_tools_analysis__mean'
        )
        expect(
            copilotActionId(
                'very-long-plugin-name-that-needs-to-be-shortened-for-model-tools',
                'very-long-action-name-that-also-needs-to-be-shortened'
            )
        ).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
    })
})
