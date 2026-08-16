const CORE_PLUGIN = 'mmgis-core'
const registered = new WeakMap()
const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key)

function unavailable(reason) {
    return { available: false, reason }
}

function requireLayer(layers, layerName) {
    if (typeof layerName !== 'string' || layerName.trim() === '')
        throw new TypeError('A layer name is required.')
    const layerUUID = layers?.asLayerUUID?.(layerName.trim())
    if (
        layerUUID == null ||
        (!hasOwn(layers?.layers?.data || {}, layerUUID) &&
            !hasOwn(layers?.layers?.layer || {}, layerUUID))
    )
        throw new Error(
            'Layer "' +
                layerName +
                '" is not available in the current mission.'
        )
    return layerUUID
}

function mapAvailability(api, layers) {
    if (!api?.map) return unavailable('The MMGIS map is not initialized.')
    if (!Array.isArray(layers?.view) || layers.view.length < 2)
        return unavailable('The configured MMGIS home view is unavailable.')
    return true
}

function toolAvailability(tools) {
    return Array.isArray(tools?.tools) && tools.tools.length > 0
        ? true
        : unavailable('No MMGIS tools are configured for this mission.')
}

function timeAvailability(time) {
    return time?.enabled === true && time.timeUI
        ? true
        : unavailable('Time controls are not enabled for this mission.')
}

function selectionAvailability(layers) {
    const hasSelectableLayer = Object.values(layers?.layers?.layer || {}).some(
        (layer) => layer && typeof layer === 'object' && layer._layers
    )
    return hasSelectableLayer
        ? true
        : unavailable('No selectable feature layer is currently loaded.')
}

function filterAvailability(layers) {
    const hasFilterableLayer = Object.values(layers?.layers?.layer || {}).some(
        (layer) =>
            layer &&
            typeof layer === 'object' &&
            typeof layer.updateFilter === 'function'
    )
    return hasFilterableLayer
        ? true
        : unavailable(
              'No loaded layer currently supports visualization filters.'
          )
}

function reorderAvailability(layers) {
    return Array.isArray(layers?._layersOrdered) &&
        layers._layersOrdered.length >= 2
        ? true
        : unavailable('At least two ordered layers are required.')
}

function layerGroupAvailability(api, tools) {
    const hasLayersTool = (tools?.tools || []).some(
        (tool) =>
            String(tool?.name || '').toLowerCase() === 'layers' ||
            String(tool?.js || '').toLowerCase() === 'layerstool'
    )
    if (!hasLayersTool)
        return unavailable('The Layers tool is not configured for this mission.')
    if (typeof api?.getLayerGroups !== 'function')
        return unavailable('Layer group controls are unavailable.')
    try {
        const groups = api.getLayerGroups()
        return Array.isArray(groups) && groups.length > 0
            ? true
            : unavailable('No layer groups are configured for this mission.')
    } catch {
        return unavailable('Layer group controls are unavailable.')
    }
}

function facadeFailure(error, fallbackMessage, fallbackCode) {
    const message =
        typeof error?.publicMessage === 'string' && error.publicMessage.trim()
            ? error.publicMessage.trim()
            : fallbackMessage
    const code =
        typeof error?.code === 'string' &&
        /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
            ? error.code
            : fallbackCode
    return { ok: false, message, error: { code } }
}

function normalizeFeatureSelector(args, api) {
    const hasLatitude = args.latitude != null
    const hasLongitude = args.longitude != null
    if (hasLatitude !== hasLongitude)
        throw new TypeError(
            'Feature coordinate selection requires both latitude and longitude.'
        )

    const hasProperty = args.property != null
    const hasValue = args.value !== undefined && args.value !== null
    if (hasProperty !== hasValue)
        throw new TypeError(
            'Feature property selection requires both property and value.'
        )

    const hasLayerId = args.layer_id != null
    const selectorCount =
        Number(hasLatitude && hasLongitude) +
        Number(hasProperty && hasValue) +
        Number(hasLayerId)
    if (selectorCount !== 1)
        throw new TypeError(
            'Specify exactly one feature selector: coordinates, property/value, or layer_id.'
        )

    const options = {}
    if (hasLatitude) {
        const lat = Number(args.latitude)
        const lon = Number(args.longitude)
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            lat < -90 ||
            lat > 90 ||
            lon < -180 ||
            lon > 180
        )
            throw new RangeError(
                'Feature coordinates must be finite longitude/latitude values.'
            )
        options.lat = lat
        options.lon = lon
    } else if (hasProperty) {
        if (typeof args.property !== 'string' || args.property.trim() === '')
            throw new TypeError('Feature property must be a non-empty string.')
        options.key = args.property.trim()
        options.value = args.value
    } else {
        options.layerId = args.layer_id
    }

    if (args.go_to_feature === true) options.view = 'go'
    if (args.zoom != null) {
        if (args.go_to_feature !== true)
            throw new TypeError(
                'Feature zoom requires go_to_feature to be true.'
            )
        const zoom = Number(args.zoom)
        if (!Number.isFinite(zoom))
            throw new TypeError('Feature zoom must be a finite number.')
        const minZoom = api?.map?.getMinZoom?.()
        const maxZoom = api?.map?.getMaxZoom?.()
        if (Number.isFinite(minZoom) && zoom < minZoom)
            throw new RangeError(
                'Feature zoom cannot be less than ' + minZoom + '.'
            )
        if (Number.isFinite(maxZoom) && zoom > maxZoom)
            throw new RangeError(
                'Feature zoom cannot be greater than ' + maxZoom + '.'
            )
        options.zoom = zoom
    }
    return options
}

function definitions({ api, layers, tools, time }) {
    return [
        {
            descriptor: {
                name: 'reset_map_view',
                plugin: CORE_PLUGIN,
                category: 'map/navigation',
                description:
                    'Reset the map to the home center and zoom configured for the current MMGIS mission.',
                parameters: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                },
            },
            availability: () => mapAvailability(api, layers),
            handler: () => {
                const data = api.resetMapView()
                if (!data || !Number.isFinite(data.zoom))
                    return {
                        ok: false,
                        message:
                            'MMGIS could not verify that the home map view was restored.',
                        error: { code: 'MAP_RESET_NOT_VERIFIED' },
                    }
                return {
                    message:
                        'Reset the map to the configured home view at zoom level ' +
                        data.zoom +
                        '.',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'open_tool',
                plugin: CORE_PLUGIN,
                category: 'application/tools',
                description:
                    'Open a tool that is configured in the current MMGIS mission.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description:
                                'Configured public tool name, such as Layers, Info, or Measure.',
                        },
                    },
                    required: ['name'],
                    additionalProperties: false,
                },
            },
            availability: () => toolAvailability(tools),
            handler: ({ name }) => {
                const data = api.openTool(name)
                if (data?.open !== true)
                    return {
                        ok: false,
                        message:
                            'MMGIS could not verify that tool "' +
                            name +
                            '" opened.',
                        data: data || null,
                        error: { code: 'TOOL_OPEN_NOT_VERIFIED' },
                    }
                return {
                    message: 'Opened the ' + data.tool + ' tool.',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'close_tool',
                plugin: CORE_PLUGIN,
                category: 'application/tools',
                description:
                    'Close a tool that is configured in the current MMGIS mission.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Configured public tool name to close.',
                        },
                    },
                    required: ['name'],
                    additionalProperties: false,
                },
            },
            availability: () => toolAvailability(tools),
            handler: ({ name }) => {
                const data = api.closeTool(name)
                if (data?.open !== false)
                    return {
                        ok: false,
                        message:
                            'MMGIS could not verify that tool "' +
                            name +
                            '" closed.',
                        data: data || null,
                        error: { code: 'TOOL_CLOSE_NOT_VERIFIED' },
                    }
                return {
                    message: 'Closed the ' + data.tool + ' tool.',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'step_time',
                plugin: CORE_PLUGIN,
                category: 'temporal',
                description:
                    'Step the initialized MMGIS time control one interval forward or backward.',
                parameters: {
                    type: 'object',
                    properties: {
                        direction: {
                            type: 'string',
                            enum: ['forward', 'backward'],
                        },
                    },
                    required: ['direction'],
                    additionalProperties: false,
                },
            },
            availability: () => timeAvailability(time),
            handler: ({ direction }) => {
                const data = api.stepTime(direction)
                const timeText =
                    typeof data?.time === 'string' && data.time
                        ? ' Current time: ' + data.time + '.'
                        : ''
                return {
                    message:
                        'Stepped the map time ' +
                        data.direction +
                        '.' +
                        timeText,
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'set_time_playback',
                plugin: CORE_PLUGIN,
                category: 'temporal',
                description:
                    'Start or stop the initialized MMGIS time-control playback loop.',
                parameters: {
                    type: 'object',
                    properties: {
                        playing: { type: 'boolean' },
                    },
                    required: ['playing'],
                    additionalProperties: false,
                },
            },
            availability: () => timeAvailability(time),
            handler: ({ playing }) => {
                const data = api.setTimePlayback(playing)
                if (data?.playing !== playing)
                    return {
                        ok: false,
                        message:
                            'MMGIS could not verify the requested time playback state.',
                        data: data || null,
                        error: { code: 'TIME_PLAYBACK_NOT_VERIFIED' },
                    }
                return {
                    message: playing
                        ? 'Started time playback.'
                        : 'Stopped time playback.',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'select_feature',
                plugin: CORE_PLUGIN,
                category: 'feature/query',
                description:
                    'Select a loaded MMGIS feature by exact coordinates, a property/value pair, or its layer-local feature id.',
                parameters: {
                    type: 'object',
                    description:
                        'Provide exactly one selector: latitude and longitude together, property and value together, or layer_id.',
                    properties: {
                        layer_name: { type: 'string' },
                        latitude: { type: 'number', minimum: -90, maximum: 90 },
                        longitude: {
                            type: 'number',
                            minimum: -180,
                            maximum: 180,
                        },
                        property: { type: 'string' },
                        value: {
                            type: ['string', 'number', 'boolean'],
                        },
                        layer_id: { type: ['string', 'integer'] },
                        go_to_feature: { type: 'boolean', default: false },
                        zoom: { type: 'number' },
                    },
                    required: ['layer_name'],
                    additionalProperties: false,
                },
            },
            availability: () => selectionAvailability(layers),
            handler: (args) => {
                const layerUUID = requireLayer(layers, args.layer_name)
                const options = normalizeFeatureSelector(args, api)
                const selected = api.selectFeature(layerUUID, options)
                if (selected !== true)
                    return {
                        ok: false,
                        message:
                            'No matching feature was found in layer "' +
                            args.layer_name +
                            '".',
                        data: { layer: layerUUID },
                        error: { code: 'FEATURE_NOT_FOUND' },
                    }
                return {
                    message:
                        'Selected a feature in layer "' +
                        args.layer_name +
                        '".',
                    data: { layer: layerUUID, selected: true },
                }
            },
        },
        {
            descriptor: {
                name: 'set_layer_filter',
                plugin: CORE_PLUGIN,
                category: 'visualization',
                description:
                    'Change or clear a loaded layer visualization filter using the same brightness, contrast, saturation, and blend controls as the Layers tool.',
                parameters: {
                    type: 'object',
                    properties: {
                        layer_name: { type: 'string' },
                        filter: {
                            type: 'string',
                            enum: [
                                'brightness',
                                'contrast',
                                'saturate',
                                'mix-blend-mode',
                                'clear',
                            ],
                        },
                        value: { type: ['number', 'string'] },
                    },
                    required: ['layer_name', 'filter'],
                    additionalProperties: false,
                },
            },
            availability: () => filterAvailability(layers),
            handler: ({ layer_name: layerName, filter, value }) => {
                requireLayer(layers, layerName)
                const data = api.setLayerFilter(layerName, filter, value)
                return {
                    message:
                        filter === 'clear'
                            ? 'Cleared visualization filters for "' +
                              layerName +
                              '".'
                            : 'Set ' +
                              filter +
                              ' for "' +
                              layerName +
                              '" to ' +
                              data.value +
                              '.',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'set_layer_group_expanded',
                plugin: CORE_PLUGIN,
                category: 'layers',
                description:
                    'Expand or collapse one configured layer group in the Layers tool by its group name or id.',
                parameters: {
                    type: 'object',
                    properties: {
                        group_name: { type: 'string' },
                        expanded: { type: 'boolean' },
                    },
                    required: ['group_name', 'expanded'],
                    additionalProperties: false,
                },
            },
            availability: () => layerGroupAvailability(api, tools),
            handler: ({ group_name: groupName, expanded }) => {
                let data
                try {
                    data = api.setLayerGroupExpanded(groupName, expanded)
                } catch (error) {
                    return facadeFailure(
                        error,
                        'The requested layer group state could not be applied.',
                        'LAYER_GROUP_ACTION_FAILED'
                    )
                }
                if (data?.expanded !== expanded)
                    return {
                        ok: false,
                        message:
                            'MMGIS could not verify the requested layer group state.',
                        data: data || null,
                        error: { code: 'LAYER_GROUP_STATE_NOT_VERIFIED' },
                    }
                return {
                    message:
                        (expanded ? 'Expanded' : 'Collapsed') +
                        ' layer group "' +
                        (data.displayName || groupName) +
                        '".',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'set_all_layer_groups_expanded',
                plugin: CORE_PLUGIN,
                category: 'layers',
                description:
                    'Expand or collapse every configured layer group in the Layers tool.',
                parameters: {
                    type: 'object',
                    properties: {
                        expanded: { type: 'boolean' },
                    },
                    required: ['expanded'],
                    additionalProperties: false,
                },
            },
            availability: () => layerGroupAvailability(api, tools),
            handler: ({ expanded }) => {
                let data
                try {
                    data = api.setAllLayerGroupsExpanded(expanded)
                } catch (error) {
                    return facadeFailure(
                        error,
                        'The layer groups could not be updated.',
                        'LAYER_GROUP_ACTION_FAILED'
                    )
                }
                if (
                    data?.expanded !== expanded ||
                    !Array.isArray(data.groups) ||
                    data.groups.some((group) => group.expanded !== expanded)
                )
                    return {
                        ok: false,
                        message:
                            'MMGIS could not verify every requested layer group state.',
                        data: data || null,
                        error: { code: 'LAYER_GROUP_STATE_NOT_VERIFIED' },
                    }
                return {
                    message: expanded
                        ? 'Expanded all layer groups.'
                        : 'Collapsed all layer groups.',
                    data,
                }
            },
        },
        {
            descriptor: {
                name: 'reorder_layer',
                plugin: CORE_PLUGIN,
                category: 'layers',
                description:
                    'Move one layer in the MMGIS render stack to the top, bottom, before another layer, or after another layer.',
                parameters: {
                    type: 'object',
                    properties: {
                        layer_name: { type: 'string' },
                        position: {
                            type: 'string',
                            enum: ['top', 'bottom', 'before', 'after'],
                        },
                        relative_to: {
                            type: 'string',
                            description:
                                'Required when position is before or after.',
                        },
                    },
                    required: ['layer_name', 'position'],
                    additionalProperties: false,
                },
            },
            availability: () => reorderAvailability(layers),
            handler: ({ layer_name: layerName, position, relative_to }) => {
                const data = api.reorderLayer(
                    layerName,
                    position,
                    relative_to
                )
                return {
                    message:
                        position === 'before' || position === 'after'
                            ? 'Moved "' +
                              layerName +
                              '" ' +
                              position +
                              ' "' +
                              relative_to +
                              '".'
                            : 'Moved "' +
                              layerName +
                              '" to the ' +
                              position +
                              ' of the layer stack.',
                    data,
                }
            },
        },
    ]
}

/**
 * Register MMGIS-owned capabilities that complement (rather than duplicate)
 * the Agent plugin's static map/layer/time actions.
 */
export function registerCoreCopilotActions(registry, dependencies) {
    if (!registry || typeof registry.register !== 'function')
        throw new TypeError('A Copilot action registry is required.')
    if (registered.has(registry)) return [...registered.get(registry)]

    const ids = definitions(dependencies || {}).map(
        ({ descriptor, handler, availability }) =>
            registry.register(descriptor, handler, availability)
    )
    registered.set(registry, ids)
    return [...ids]
}

export { CORE_PLUGIN }
