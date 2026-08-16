import L_ from '../Basics/Layers_/Layers_'
import F_ from '../Basics/Formulae_/Formulae_'
import ToolController_ from '../Basics/ToolController_/ToolController_'
import QueryURL from '../services/QueryURL'
import TimeControl from '../Basics/TimeControl_/TimeControl'
import Login from '../Basics/UserInterface_/components/Login/Login'
import LegendTool from '../../../plugins/core/tools/Legend/LegendTool.js'
import { copilotActionRegistry } from './CopilotActionRegistry'
import { registerCoreCopilotActions } from './CoreCopilotActions'

import $ from 'jquery'

let L = window.L

var mmgisAPI_ = {
    // Exposes Leaflet map object
    map: null,
    // Retains the MMGIS map controller so facade calls use the same handlers as
    // first-party UI controls instead of reproducing their state transitions.
    mapController: null,
    // Initialize the map variable
    fina: function (map_) {
        mmgisAPI_.mapController = map_
        mmgisAPI_.map = map_.map
        mmgisAPI.map = map_.map
        if (typeof mmgisAPI_.onLoadCallback === 'function') {
            mmgisAPI_.onLoadCallback()
            mmgisAPI_.onLoadCallback = null
        }
    },
    setConfiguration: function (configuration) {
        if (window.mmgisglobal.setConfiguration)
            window.mmgisglobal.setConfiguration(configuration)
    },
    // Adds a layer to the map. For a more "temporary" layer, use Leaflet directly through `mmgisAPI.map`
    addLayer: function (layerObj, placement) {
        return new Promise(async (resolve, reject) => {
            if (layerObj == null) {
                reject('Missing parameter: layerObj')
                return
            }
            if (layerObj.name == null) {
                reject('Missing parameter: layerObj.name')
                return
            }
            if (layerObj.type == null) {
                reject('Missing parameter: layerObj.type')
                return
            }

            if (
                (layerObj.uuid || layerObj.name) &&
                L_.layers.data[layerObj.uuid || layerObj.name] != null
            ) {
                reject(
                    `Layer uuid/name already in use: '${
                        layerObj.uuid || layerObj.name
                    }'`
                )
            }

            // Inject new layer into configData
            let placementPath = placement?.path
            let placementIndex = placement?.index

            const configData = JSON.parse(JSON.stringify(L_.configData))

            if (placementPath && typeof placementPath === 'string') {
                placementPath = placementPath
                    .split('.')
                    .map((p) => {
                        return L_.asLayerUUID(p)
                    })
                    .join('.')
                placementPath = placementPath
                    .replace(/\./g, '.sublayers.')
                    .split('.')
                    .concat('sublayers')
                    .join('.')

                const level = F_.getIn4Layers(
                    configData.layers,
                    placementPath,
                    null,
                    true
                )
                if (level == null) {
                    reject(
                        `Path specified in 'placement.path' not found in 'layers': ${placementPath}.`
                    )
                    return
                }
                if (placementIndex == null) placementIndex = level.length
                placementIndex = Math.max(
                    0,
                    Math.min(placementIndex, level.length)
                )

                placementPath += '.'
            } else {
                placementPath = ''
                if (placementIndex == null)
                    placementIndex = configData.layers.length
                placementIndex = Math.max(
                    0,
                    Math.min(placementIndex, configData.layers.length)
                )
            }

            const didSet = F_.setIn4Layers(
                configData.layers,
                `${placementPath}${placementIndex}`,
                layerObj,
                true,
                true
            )

            // Then add
            if (didSet)
                await L_.modifyLayer(configData, layerObj.name, 'addLayer')
            else {
                reject('Failed to add layer.')
                return
            }
            resolve()
        })
    },
    removeLayer: function (layerUUID) {
        const configData = JSON.parse(JSON.stringify(L_.configData))

        layerUUID = L_.asLayerUUID(layerUUID)
        let didRemove = false
        F_.traverseLayers(configData.layers, (layer, path, index) => {
            if (layer.uuid === layerUUID) {
                didRemove = true
                return 'remove'
            }
        })
        if (didRemove) {
            L_.modifyLayer(configData, layerUUID, 'removeLayer')
            return true
        }
        return false
    },
    // Returns an array of all features in a given extent
    featuresContained: function () {
        if (!mmgisAPI_.map) {
            console.warn(
                'Warning: Unable to find features contained as the Leaflet map object is not initialized'
            )
        }

        const extent = mmgisAPI_.map.getBounds()
        let features = {}

        // For all MMGIS layers
        for (let key in L_.layers.layer) {
            if (L_.layers.layer[key] === false || L_.layers.layer[key] == null)
                continue

            if (L_.layers.layer[key].hasOwnProperty('_layers')) {
                // For normal layers
                const foundFeatures = findFeaturesInLayer(
                    extent,
                    L_.layers.layer[key]
                )
                features[key] = foundFeatures
            } else if (
                key.startsWith('DrawTool_') &&
                Array.isArray(L_.layers.layer[key])
            ) {
                // If layer is a DrawTool array of layers
                for (let layer in L_.layers.layer[key]) {
                    let foundFeatures
                    if (layer && L_.layers.layer[key][layer]) {
                        if ('getLayers' in L_.layers.layer[key][layer]) {
                            if (
                                L_.layers.layer[key][layer]?.feature?.properties
                                    ?.arrow
                            ) {
                                // If the DrawTool sublayer is an arrow
                                foundFeatures = findFeaturesInLayer(
                                    extent,
                                    L_.layers.layer[key][layer]
                                )

                                // As long as one of the layers of the arrow layer is in the current Map bounds,
                                // return the parent arrow layer's feature
                                if (foundFeatures && foundFeatures.length > 0) {
                                    foundFeatures =
                                        L_.layers.layer[key][layer].feature
                                }
                            } else {
                                // If the DrawTool sublayer is Polygon or Line
                                foundFeatures = findFeaturesInLayer(
                                    extent,
                                    L_.layers.layer[key][layer]
                                )
                            }
                        } else if ('getLatLng' in L_.layers.layer[key][layer]) {
                            // If the DrawTool sublayer is a Point
                            if (isLayerInBounds(L_.layers.layer[key][layer])) {
                                foundFeatures = [
                                    L_.layers.layer[key][layer].feature,
                                ]
                            }
                        }
                    }

                    if (foundFeatures) {
                        features[key] =
                            key in features
                                ? features[key].concat(foundFeatures)
                                : foundFeatures
                    }
                }
            }
        }

        return features

        function isLayerInBounds(layer) {
            // Use the pixel coordinates instead of latlong as latlong does not work well with polar projections
            const { x: xMapSize, y: yMapSize } = mmgisAPI_.map.getSize()

            const epsilon = 1e-6
            const nw = mmgisAPI_.map.project(extent.getNorthWest())
            const se = mmgisAPI_.map.project(extent.getSouthEast())
            const ne = mmgisAPI_.map.project(extent.getNorthEast())
            const sw = mmgisAPI_.map.project(extent.getSouthWest())

            let _extent
            if (
                Math.abs(Math.abs(nw.x - se.x) - xMapSize) < epsilon &&
                Math.abs(Math.abs(nw.y - se.y) - yMapSize) < epsilon
            ) {
                _extent = L.bounds(nw, se)
            } else {
                _extent = L.bounds(ne, sw)
            }

            let found = false
            if ('getBounds' in layer) {
                const layerBounds = layer.getBounds()
                const nwLayer = mmgisAPI_.map.project(
                    layerBounds.getNorthEast()
                )
                const seLayer = mmgisAPI_.map.project(
                    layerBounds.getSouthWest()
                )
                const _bounds = L.bounds(nwLayer, seLayer)

                if (_extent.intersects(_bounds)) {
                    found = true
                }
            } else if ('getLatLng' in layer) {
                const _latLng = mmgisAPI_.map.project(layer.getLatLng())

                if (_extent.contains(_latLng)) {
                    found = true
                }
            }

            return found
        }

        function findFeaturesInLayer(extent, layer) {
            let features = []
            const layers = layer.getLayers()

            layers.forEach((layer) => {
                const found = isLayerInBounds(layer)

                if (found) {
                    features.push(layer.feature)
                }
            })

            return features
        }
    },
    // Returns the currently active feature (i.e. feature thats clicked and displayed in the InfoTool)
    getActiveFeature: function () {
        const infoTool = ToolController_.getTool('InfoTool')

        if (infoTool.currentLayer && infoTool.currentLayer.feature) {
            const activeFeature = {}
            activeFeature[infoTool.currentLayerName] = [
                infoTool.currentLayer.feature,
            ]
            return activeFeature
        }

        return null
    },
    selectFeature: function (layerUUID, options) {
        return L_.selectPoint({
            ...{
                layerUUID: layerUUID,
            },
            ...options,
        })
    },
    getActiveTool: function () {
        if (ToolController_) {
            return {
                activeTool: ToolController_.activeTool,
                activeToolName: ToolController_.activeToolName,
            }
        }
        return null
    },
    getActiveTools: function () {
        if (ToolController_) {
            const activeTool = mmgisAPI_.getActiveTool()
            return {
                activeToolNames: [ToolController_.activeToolName]
                    .concat(ToolController_.activeSeparatedTools)
                    .filter(Boolean),
                activeTools: [activeTool.activeTool != null ? activeTool : null]
                    .concat(
                        ToolController_.activeSeparatedTools.map((a) => {
                            return {
                                activeTool: ToolController_.getTool(a),
                                activeToolName: a,
                            }
                        })
                    )
                    .filter(Boolean),
            }
        }
        return null
    },
    getLayerConfigs: function (match) {
        if (match) {
            const matchedLayers = {}
            Object.keys(L_.layers.data).forEach((name) => {
                const layer = L_.layers.data[name]
                let matched = false
                Object.keys(match).forEach((key) => {
                    const value = F_.getIn(layer, key)
                    if (typeof value === 'string' && match[key] === value)
                        matched = true
                    else if (Array.isArray(value) && value.includes(match[key]))
                        matched = true
                })

                if (matched)
                    matchedLayers[name] = JSON.parse(JSON.stringify(layer))
            })
            return matchedLayers
        } else return L_.layers.data
    },
    getLayers: function () {
        return L_.layers.layer
    },
    // Returns an object with the visibility state of all layers
    getVisibleLayers: function () {
        // Also return the visibility of the DrawTool layers
        var drawToolVisibility = {}
        for (let l in L_.layers.layer) {
            if (!(l in L_.layers.on)) {
                var s = l.split('_')
                var onId = s[1] != 'master' ? parseInt(s[1]) : s[1]
                if (s[0] == 'DrawTool') {
                    drawToolVisibility[l] =
                        ToolController_.getTool('DrawTool').filesOn.indexOf(
                            onId
                        ) != -1
                }
            }
        }

        return { ...L_.layers.on, ...drawToolVisibility }
    },
    //customListeners: {},
    // Adds map event listener
    addEventListener: function (eventName, functionReference) {
        const listener = mmgisAPI_.getLeafletMapEvent(eventName)
        const mmgisListener = mmgisAPI_.checkMMGISEvent(eventName)
        if (listener) {
            mmgisAPI_.map.addEventListener(listener, functionReference)
        } else if (mmgisListener) {
            document.addEventListener(eventName, functionReference)
        } else {
            //mmgisAPI_.customListeners[eventName] = mmgisAPI_.customListeners[eventName] || []
            //mmgisAPI_.customListeners[eventName].push(functionReference)
            console.warn(
                'Warning: Unable to add event listener for ' + eventName
            )
        }
    },
    // Removes map event listener added using the MMGIS API
    removeEventListener: function (eventName, functionReference) {
        const listener = mmgisAPI_.getLeafletMapEvent(eventName)
        const mmgisListener = mmgisAPI_.checkMMGISEvent(eventName)
        if (listener) {
            console.log('Remove listener:', listener)
            mmgisAPI_.map.removeEventListener(listener, functionReference)
        } else if (mmgisListener) {
            console.log('Remove listener', eventName)
            document.removeEventListener(eventName, functionReference)
        } else {
            //if(mmgisAPI_.customListeners[eventName]) {
            //    mmgisAPI_.customListeners[eventName] = mmgisAPI_.customListeners[eventName].filter(f => f !== functionReference)
            //}
            console.warn(
                'Warning: Unable to remove event listener for ' + eventName
            )
        }
    },
    getLeafletMapEvent: function (eventName) {
        if (eventName === 'onPan') {
            return 'dragend'
        } else if (eventName === 'onZoom') {
            return 'zoomend'
        } else if (eventName === 'onClick') {
            return 'click'
        }
        return null
    },
    checkMMGISEvent: function (eventName) {
        const validEvents = [
            'toolChange',
            'layerVisibilityChange',
            'websocketChange',
            'toggleSeparatedTool',
            'newActiveFeature',
            'layersToolHeaderStateChange',
            'madeLegendTool',
        ]
        return validEvents.includes(eventName)
    },
    writeCoordinateURL: function () {
        return QueryURL.writeCoordinateURL(false)
    },
    onLoadCallback: null,
    onLoaded: function (onLoadCallback) {
        mmgisAPI_.onLoadCallback = onLoadCallback
    },
    // Convert {lng: , lat:} to x, y
    project: function (lnglat) {
        return window.mmgisglobal.customCRS.project(lnglat)
    },
    // Convert {x: , y: } to lng, lat
    unproject: function (xy) {
        return window.mmgisglobal.customCRS.unproject(xy)
    },
    toggleLayer: async function (layerName, on) {
        if (layerName in L_.layers.data) {
            if (on === undefined || on === null) {
                // If on is not defined, switch the visibility state of the layer
                await L_.toggleLayer(L_.layers.data[layerName])
            } else {
                let state = !on
                await L_.toggleLayerHelper(L_.layers.data[layerName], state)
            }

            if (ToolController_.activeToolName === 'LayersTool') {
                const id = `#layerstart${F_.getSafeName(layerName)} .checkbox`

                if (L_.layers.on[layerName]) {
                    $(id).addClass('on')
                } else {
                    $(id).removeClass('on')
                }
            }
        } else {
            console.warn(`'Warning: Unable to find layer named ${layerName}`)
            return
        }
    },
    setLayerOpacity: function (layerName, opacity) {
        const layerUUID = L_.asLayerUUID(layerName)
        if (layerUUID == null)
            throw new Error(`Unable to find layer "${layerName}".`)
        const normalizedOpacity = Number(opacity)
        if (
            !Number.isFinite(normalizedOpacity) ||
            normalizedOpacity < 0 ||
            normalizedOpacity > 1
        )
            throw new TypeError('Layer opacity must be a number from 0 to 1.')
        L_.setLayerOpacity(layerUUID, normalizedOpacity)
        return {
            layer: layerUUID,
            opacity: L_.layers.opacity[layerUUID],
        }
    },
    setLayerFilter: function (layerName, filter, value) {
        const layerUUID = L_.asLayerUUID(layerName)
        const liveLayer = L_.layers.layer[layerUUID]
        if (layerUUID == null || !liveLayer || typeof liveLayer !== 'object')
            throw new Error(
                'Layer "' + layerName + '" is not loaded and cannot be filtered.'
            )
        if (typeof liveLayer.updateFilter !== 'function')
            throw new Error(
                'Layer "' +
                    layerName +
                    '" does not expose visualization filter controls.'
            )

        const normalizedFilter = String(filter || '').toLowerCase()
        const numericRanges = {
            brightness: [0, 3],
            contrast: [0, 4],
            saturate: [0, 4],
        }
        let normalizedValue = value
        if (
            Object.prototype.hasOwnProperty.call(
                numericRanges,
                normalizedFilter
            )
        ) {
            normalizedValue = Number(value)
            const [minimum, maximum] = numericRanges[normalizedFilter]
            if (
                !Number.isFinite(normalizedValue) ||
                normalizedValue < minimum ||
                normalizedValue > maximum
            )
                throw new RangeError(
                    normalizedFilter +
                        ' must be between ' +
                        minimum +
                        ' and ' +
                        maximum +
                        '.'
                )
        } else if (normalizedFilter === 'mix-blend-mode') {
            normalizedValue = String(value || '').toLowerCase()
            if (
                !['unset', 'none', 'color', 'overlay'].includes(normalizedValue)
            )
                throw new TypeError(
                    'Layer blend mode must be unset, none, color, or overlay.'
                )
        } else if (normalizedFilter === 'clear') {
            normalizedValue = null
        } else {
            throw new TypeError(
                'Layer filter must be brightness, contrast, saturate, mix-blend-mode, or clear.'
            )
        }

        L_.setLayerFilter(layerUUID, normalizedFilter, normalizedValue)
        const filters = { ...(L_.layers.filters[layerUUID] || {}) }
        return {
            layer: layerUUID,
            filter: normalizedFilter,
            value:
                normalizedFilter === 'clear'
                    ? null
                    : filters[normalizedFilter] ?? normalizedValue,
            filters,
        }
    },
    setMapView: function (latitude, longitude, zoom) {
        if (latitude && typeof latitude === 'object') {
            const view = latitude
            latitude = view.latitude ?? view.lat
            longitude = view.longitude ?? view.lng ?? view.lon
            zoom = view.zoom
        }
        const lat = Number(latitude)
        const lng = Number(longitude)
        const nextZoom =
            zoom == null ? mmgisAPI_.map?.getZoom?.() : Number(zoom)
        if (!Number.isFinite(lat) || !Number.isFinite(lng))
            throw new TypeError('Map latitude and longitude must be finite numbers.')
        if (!Number.isFinite(nextZoom))
            throw new TypeError('Map zoom must be a finite number.')
        if (!mmgisAPI_.map)
            throw new Error('The MMGIS map is not initialized.')

        const minZoom = mmgisAPI_.map.getMinZoom?.()
        const maxZoom = mmgisAPI_.map.getMaxZoom?.()
        if (Number.isFinite(minZoom) && nextZoom < minZoom)
            throw new RangeError(`Map zoom cannot be less than ${minZoom}.`)
        if (Number.isFinite(maxZoom) && nextZoom > maxZoom)
            throw new RangeError(`Map zoom cannot be greater than ${maxZoom}.`)

        if (typeof mmgisAPI_.mapController?.resetView === 'function')
            mmgisAPI_.mapController.resetView([lat, lng, nextZoom])
        else mmgisAPI_.map.setView([lat, lng], nextZoom)
        return { latitude: lat, longitude: lng, zoom: nextZoom }
    },
    fitMapBounds: function (bounds, options = {}) {
        if (!mmgisAPI_.map)
            throw new Error('The MMGIS map is not initialized.')
        if (options == null || typeof options !== 'object') options = {}
        let normalizedBounds
        if (
            Array.isArray(bounds) &&
            bounds.length === 4 &&
            bounds.every((value) => Number.isFinite(Number(value)))
        ) {
            const [west, south, east, north] = bounds.map(Number)
            if (west >= east || south >= north)
                throw new RangeError(
                    'Flat map bounds must be [west, south, east, north].'
                )
            normalizedBounds = [
                [south, west],
                [north, east],
            ]
        } else if (
            Array.isArray(bounds) &&
            bounds.length === 2 &&
            bounds.every(
                (corner) =>
                    Array.isArray(corner) &&
                    corner.length === 2 &&
                    corner.every((value) => Number.isFinite(Number(value)))
            )
        ) {
            normalizedBounds = bounds.map((corner) => corner.map(Number))
        } else {
            throw new TypeError(
                'Map bounds must be [west, south, east, north] or [[south, west], [north, east]].'
            )
        }

        const safeOptions = {}
        if (typeof options.animate === 'boolean')
            safeOptions.animate = options.animate
        if (Number.isFinite(Number(options.duration)))
            safeOptions.duration = Math.max(0, Number(options.duration))
        if (Number.isFinite(Number(options.maxZoom)))
            safeOptions.maxZoom = Number(options.maxZoom)
        if (
            Array.isArray(options.padding) &&
            options.padding.length === 2 &&
            options.padding.every(
                (value) =>
                    Number.isFinite(Number(value)) && Number(value) >= 0
            )
        )
            safeOptions.padding = options.padding.map(Number)

        mmgisAPI_.map.fitBounds(normalizedBounds, safeOptions)
        return { bounds: normalizedBounds }
    },
    setMapZoom: function (zoom) {
        if (!mmgisAPI_.map)
            throw new Error('The MMGIS map is not initialized.')
        const center = mmgisAPI_.map.getCenter()
        return mmgisAPI_.setMapView(center.lat, center.lng, zoom)
    },
    resetMapView: function () {
        if (!Array.isArray(L_.view) || L_.view.length < 2)
            throw new Error('The configured MMGIS home view is unavailable.')
        return mmgisAPI_.setMapView(L_.view[0], L_.view[1], L_.view[2])
    },
    openTool: function (name) {
        const toolName = mmgisAPI_.resolveToolName(name)
        if (mmgisAPI_.isToolOpen(toolName))
            return { tool: toolName, open: true, alreadyOpen: true }
        ToolController_.openTool(toolName)
        if (!mmgisAPI_.isToolOpen(toolName))
            throw new Error('Tool "' + toolName + '" did not open.')
        return { tool: toolName, open: true, alreadyOpen: false }
    },
    closeTool: function (name) {
        const toolName = mmgisAPI_.resolveToolName(name)
        if (!mmgisAPI_.isToolOpen(toolName))
            return { tool: toolName, open: false, alreadyClosed: true }
        ToolController_.closeTool(toolName)
        if (mmgisAPI_.isToolOpen(toolName))
            throw new Error('Tool "' + toolName + '" did not close.')
        return { tool: toolName, open: false, alreadyClosed: false }
    },
    resolveToolName: function (name) {
        if (typeof name !== 'string' || name.trim() === '')
            throw new TypeError('A tool name is required.')
        const requested = name.trim().toLowerCase()
        const withoutSuffix = requested.endsWith('tool')
            ? requested.slice(0, -4)
            : requested
        const configured = (ToolController_.tools || []).find((tool) => {
            const publicName = String(tool.name || '').toLowerCase()
            const moduleName = String(tool.js || '').toLowerCase()
            return (
                publicName === requested ||
                publicName === withoutSuffix ||
                moduleName === requested
            )
        })
        if (!configured)
            throw new Error(`Tool "${name}" is not available in this mission.`)
        return configured.name
    },
    isToolOpen: function (name) {
        const toolName = mmgisAPI_.resolveToolName(name)
        const index = (ToolController_.tools || []).findIndex(
            (tool) => tool.name === toolName
        )
        const moduleName =
            ToolController_.toolModuleNames?.[index] ||
            ToolController_.tools?.[index]?.js ||
            toolName + 'Tool'
        return (
            ToolController_.activeToolName === moduleName ||
            (ToolController_.activeSeparatedTools || []).includes(moduleName) ||
            (ToolController_.activeSeparatedTools || []).includes(
                toolName + 'Tool'
            )
        )
    },
    getConfiguredToolModule: function (name) {
        const toolName = mmgisAPI_.resolveToolName(name)
        const index = (ToolController_.tools || []).findIndex(
            (tool) => tool.name === toolName
        )
        const moduleName = ToolController_.toolModuleNames?.[index]
        const toolModule = ToolController_.toolModules?.[moduleName]
        if (!moduleName || !toolModule)
            throw new Error(
                'The configured "' + toolName + '" tool module is unavailable.'
            )
        return { name: toolName, moduleName, toolModule }
    },
    getLayerGroups: function () {
        const { toolModule } = mmgisAPI_.getConfiguredToolModule('Layers')
        if (typeof toolModule.getHeaderGroups !== 'function')
            throw new Error(
                'The configured Layers tool does not expose layer group controls.'
            )
        return toolModule.getHeaderGroups()
    },
    setLayerGroupExpanded: function (groupName, expanded) {
        if (typeof expanded !== 'boolean')
            throw new TypeError(
                'Layer group expanded state must be a boolean.'
            )
        const { name, toolModule } =
            mmgisAPI_.getConfiguredToolModule('Layers')
        if (typeof toolModule.setHeaderExpanded !== 'function')
            throw new Error(
                'The configured Layers tool does not expose layer group controls.'
            )
        mmgisAPI_.openTool(name)
        return toolModule.setHeaderExpanded(groupName, expanded)
    },
    setAllLayerGroupsExpanded: function (expanded) {
        if (typeof expanded !== 'boolean')
            throw new TypeError(
                'Layer group expanded state must be a boolean.'
            )
        const { name, toolModule } =
            mmgisAPI_.getConfiguredToolModule('Layers')
        if (typeof toolModule.setAllHeadersExpanded !== 'function')
            throw new Error(
                'The configured Layers tool does not expose layer group controls.'
            )
        mmgisAPI_.openTool(name)
        return toolModule.setAllHeadersExpanded(expanded)
    },
    stepTime: function (direction = 'forward') {
        if (!TimeControl.enabled || !TimeControl.timeUI)
            throw new Error('Time controls are not enabled for this mission.')
        const normalized = String(direction).toLowerCase()
        let resolvedDirection
        if (['forward', 'next', '1'].includes(normalized)) {
            TimeControl.timeUI.stepNext()
            resolvedDirection = 'forward'
        } else if (
            ['backward', 'previous', 'prev', '-1'].includes(normalized)
        ) {
            TimeControl.timeUI.stepPrevious()
            resolvedDirection = 'backward'
        } else
            throw new TypeError(
                'Time step direction must be forward/next or backward/previous.'
            )
        return { direction: resolvedDirection, time: TimeControl.getTime() }
    },
    setTimePlayback: function (playing) {
        if (!TimeControl.enabled || !TimeControl.timeUI)
            throw new Error('Time controls are not enabled for this mission.')
        if (typeof playing !== 'boolean')
            throw new TypeError('Time playback state must be a boolean.')
        if (TimeControl.timeUI.play !== playing)
            TimeControl.timeUI.togglePlay(playing)
        const actual = TimeControl.timeUI.play === true
        if (actual !== playing)
            throw new Error('The requested time playback state was not applied.')
        return { playing: actual }
    },
    reorderLayer: function (layerName, position, relativeTo) {
        const layerUUID = L_.asLayerUUID(layerName)
        const ordered = Array.isArray(L_._layersOrdered)
            ? [...L_._layersOrdered]
            : []
        const currentIndex = ordered.indexOf(layerUUID)
        if (layerUUID == null || currentIndex < 0)
            throw new Error(
                'Layer "' +
                    layerName +
                    '" is not in the current render stack.'
            )

        const normalizedPosition = String(position || '').toLowerCase()
        if (!['top', 'bottom', 'before', 'after'].includes(normalizedPosition))
            throw new TypeError(
                'Layer position must be top, bottom, before, or after.'
            )

        ordered.splice(currentIndex, 1)
        let relativeUUID = null
        if (
            normalizedPosition === 'before' ||
            normalizedPosition === 'after'
        ) {
            relativeUUID = L_.asLayerUUID(relativeTo)
            if (relativeUUID == null || relativeUUID === layerUUID)
                throw new Error(
                    'A different, ordered relative layer is required.'
                )
            const relativeIndex = ordered.indexOf(relativeUUID)
            if (relativeIndex < 0)
                throw new Error(
                    'Relative layer "' +
                        relativeTo +
                        '" is not in the current render stack.'
                )
            ordered.splice(
                relativeIndex + (normalizedPosition === 'after' ? 1 : 0),
                0,
                layerUUID
            )
        } else if (normalizedPosition === 'top') {
            ordered.unshift(layerUUID)
        } else {
            ordered.push(layerUUID)
        }

        L_.reorderLayers(ordered)
        if (
            !Array.isArray(L_._layersOrdered) ||
            L_._layersOrdered.length !== ordered.length ||
            L_._layersOrdered.some((layer, index) => layer !== ordered[index])
        )
            throw new Error('The requested layer order was not applied.')
        return {
            layer: layerUUID,
            position: normalizedPosition,
            relativeTo: relativeUUID,
            order: [...L_._layersOrdered],
        }
    },
}

var mmgisAPI = {
    /**
     * Sets a new configuration object for MMGIS to use
     * @param {object} configurationObj - The new configuration JSON object (what the configuration CMS creates)
     */
    setConfiguration: mmgisAPI_.setConfiguration,
    /**
     * Adds a layer to the map. For a more "temporary" layer, use Leaflet directly through `mmgisAPI.map`
     * @param {object} layerObj - See schema in configData
     * @param {object} placement - Position to place layer relative to other layers - {path: , index: }
     * @returns {Promise}
     */
    addLayer: mmgisAPI_.addLayer,
    /**
     * Removes a layer from the map.
     * @params {string} layerUUID - layer name/uuid to remove
     * @returns {boolean} - true if found and removed, otherwise false
     */
    removeLayer: mmgisAPI_.removeLayer,
    /**
     * Clears a layer with a specified name
     * @param {string} - layerName - name of layer to clear
     */
    clearVectorLayer: L_.clearVectorLayer,
    /**
     * Updates a specified layer with GeoJSON data
     * @param {string} - layerName - name of layer to update
     * @param {GeoJSON} - inputData - valid GeoJSON data
     */
    updateVectorLayer: L_.updateVectorLayer,
    /**
     * Remove features on a specified layer before a specified time
     * @param {string} - layerName - name of layer to update
     * @param {string} - keepAfterTime - absolute time in the format of YYYY-MM-DDThh:mm:ssZ; will keep all features after this time
     * @param {number} - timePropPath - name of time property to compare with the time specified by keepAfterTime
     */
    trimVectorLayerKeepAfterTime: L_.trimVectorLayerKeepAfterTime,
    /**
     * Remove features on a specified layer after a specified time
     * @param {string} - layerName - name of layer to update
     * @param {string} - keepBeforeTime - absolute time in the format of YYYY-MM-DDThh:mm:ssZ; will keep all features before this time
     * @param {number} - timePropPath - name of time property to compare with the time specified by keepAfterTime
     */
    trimVectorLayerKeepBeforeTime: L_.trimVectorLayerKeepBeforeTime,
    /**
     * Number of features to keep on a specified layer. Keeps from the tail end of the feature list.
     * @param {string} - layerName - name of layer to update
     * @param {keepLastN} - keepN - number of features to keep from the tail end of the feature list. A value less than or equal to 0 keeps all previous features
     */
    keepLastN: L_.keepLastN,
    /**
     * Number of features to keep on a specified layer. Keeps features from the beginning of the feature list.
     * @param {string} - layerName - name of layer to update
     * @param {keepFirstN} - keepN - number of features to keep from the beginning of the feature list. A value less than or equal to 0 keeps all previous features
     */
    keepFirstN: L_.keepFirstN,
    /**
     * This function is used to trim a specified number of vertices on a specified layer containing GeoJson LineString features.
     * @param {string} - layerName - name of layer to update
     * @param {string} - time - absolute time in the format of YYYY-MM-DDThh:mm:ssZ; represents start time if trimming from the beginning, otherwise represents the end time
     * @param {number} - trimN - number of vertices to trim
     * @param {string} - startOrEnd - direction to trim from; value can only be one of the following options: start, end
     */
    trimLineString: L_.trimLineString,
    /**
     * This function is used to append new LineString data to the last feature (with LineString geometry) in a layer
     * @param {string} - layerName - name of layer to update
     * @param {object} - inputData - a GeoJson Feature object containing geometry that is a LineString
     * @param {string} - timeProp - name of time property in each feature in the layer and in the inputData
     */
    appendLineString: L_.appendLineString,

    // Time Control API functions

    /**
     * This function toggles the visibility of ancillary Time Control User Interface.
     * It is useful in situations where time functions are controlled by an external application.
     * @param {boolean} - Whether to turn the TimeUI on or off. If true, makes visible.
     * @returns {boolean} - Whether the TimeUI is now on or off
     */
    toggleTimeUI: function (isOn) {
        const Coordinates = require('../Basics/UserInterface_/components/Coordinates/Coordinates').default
        Coordinates.toggleTimeUI(isOn)
    },

    /**
     * This function sets the global time properties for all of MMGIS.
     * All time enabled layers that are configured to use the `Global` time type will be updated by this function.
     * @param {string} [startTime] - Can be either YYYY-MM-DDThh:mm:ssZ if absolute or hh:mm:ss or seconds if relative
     * @param {string} [endTime] - Can be either YYYY-MM-DDThh:mm:ssZ if absolute or hh:mm:ss or seconds if relative
     * @param {boolean} [isRelative=false] - If true, startTime and endTime are relative to currentTime
     * @param {string} [timeOffset=0] - Offset of currentTime; Can be either hh:mm:ss or seconds
     * @returns {boolean} - Whether the time was successfully set
     */
    setTime: TimeControl.setTime,

    /** This function sets the start and end time for a single layer.
     * It will override the global time for that layer.
     * @param {string} [layerName]
     * @param {string} [startTime] - YYYY-MM-DDThh:mm:ssZ
     * @param {string} [endTime] - YYYY-MM-DDThh:mm:ssZ
     * @returns {boolean} - Whether the time was successfully set
     */
    setLayerTime: TimeControl.setLayerTime,

    /**
     * @returns {string} - The current time on the map with offset included
     */
    getTime: TimeControl.getTime,

    /**
     * @returns {string} - The start time on the map with offset included
     */
    getStartTime: TimeControl.getStartTime,

    /**
     * @returns {string} - The end time on the map with offset included
     */
    getEndTime: TimeControl.getEndTime,

    /**
     * @param {string} [layerName]
     * @returns {string} - The start time for an individual layer
     */
    getLayerStartTime: TimeControl.getLayerStartTime,

    /**
     * @param {string} [layerName]
     * @returns {string} - The end time for an individual layer
     */
    getLayerEndTime: TimeControl.getLayerEndTime,

    /** reloadTimeLayers will reload every time-enabled layer.
     * Now async: awaits every per-layer reload (via Promise.allSettled)
     * before resolving, so the active-feature restoration and follow-pan
     * logic run after layers are actually refreshed.
     * @returns {Promise<string[]>} - Resolves to a list of layer names
     *   that were reloaded. Callers must await the returned promise to
     *   access the array.
     */
    reloadTimeLayers: TimeControl.reloadTimeLayers,

    /** reloadLayer will reload a given time enabled layer
     * @param {string} [layerName]
     * @returns {boolean} - Whether the layer was successfully reloaded
     */
    reloadLayer: TimeControl.reloadLayer,

    /** reloadLayers will reload multiple time-enabled layers concurrently.
     * Each layer is reloaded via TimeControl.reloadLayer() and the returned
     * array preserves the same order as the input layerNames. Uses
     * Promise.allSettled internally so a single failing layer reload
     * does not reject the whole batch — the failing entry is reported as
     * false in the returned array.
     * @param {string[]} layerNames - Array of layer name strings (or UUIDs).
     * @param {boolean} [evenIfOff] - Reload layers even if they are toggled off.
     * @param {boolean} [evenIfControlled] - Reload layers even if they are controlled.
     * @param {boolean} [forceRequery] - Force a requery of the layer data.
     * @param {boolean} [skipOrderedBringToFront] - Skip ordered bring-to-front after reload.
     * @returns {Promise<boolean[]>} - Per-layer reload results in input order;
     *   each entry is the truthy return value from TimeControl.reloadLayer()
     *   for successful reloads, or false for layers that threw / rejected.
     */
    reloadLayers: async function (layerNames, evenIfOff, evenIfControlled, forceRequery, skipOrderedBringToFront) {
        if (!Array.isArray(layerNames)) return []
        const settled = await Promise.allSettled(
            layerNames.map((name) =>
                TimeControl.reloadLayer(
                    name,
                    evenIfOff,
                    evenIfControlled,
                    forceRequery,
                    skipOrderedBringToFront
                )
            )
        )
        return settled.map((r) =>
            r.status === 'fulfilled' ? r.value : false
        )
    },

    /** Sets layer UUIDs and layer Names to UUIDs
     * @param {string} [uuid]
     * @returns {string} - Best UUID, else null
     */
    asLayerUUID: L_.asLayerUUID,

    /** setLayersTimeStatus - will set the status color for all global time enabled layers
     * @param {string} [color]
     * @returns {array} - A list of layers that were set
     */
    setLayersTimeStatus: TimeControl.setLayersTimeStatus,

    /** setLayerTimeStatus - will set the status color for the given layer
     * @param {string} [layerName]
     * @param {string} [color]
     * @returns {boolean} - True if time status was successfully set
     */
    setLayerTimeStatus: TimeControl.setLayerTimeStatus,

    /** updateLayersTime - will synchronize every global time enabled layer with global times.
     * Probably should be a private function, but could be useful for edge cases when things
     * may need to be re-synchronized.
     * @returns {array} - A list of layers that were reloaded
     */
    updateLayersTime: TimeControl.updateLayersTime,

    /** map - exposes Leaflet map object.
     * @returns {object} - The Leaflet map object
     */
    map: null,

    /** featuresContained - returns an array of all features in the current map view.
     * @returns {object} - An object containing layer names as keys and values as arrays with all features (as GeoJson Feature objects) contained in the current map view
     */
    featuresContained: mmgisAPI_.featuresContained,

    /** getActiveFeature - returns the currently active feature (i.e. feature thats clicked and displayed in the InfoTool)
     * @returns {object} - The currently selected active feature as an object with the layer name as key and value as an array containing the GeoJson Feature object (MMGIS only allows the section of a single feature).
     */
    getActiveFeature: mmgisAPI_.getActiveFeature,

    /** Selects a feature based on latlng, key:value, or layerId
     * @param {string} [layerName]
     * @param {object} [options]
     * options: {
        lat: num,
        lon: num,
        ||
        key: 'props.dot.notation',
        value: '',
        ||
        layerId: num,

        view: 'go' || null,
        zoom: 'zoomLevel' || 'map_scale_if_view_is_go',
        }
     *
     * @returns {boolean} - true if found and selected a feature, otherwise false
     */
    selectFeature: mmgisAPI_.selectFeature,

    /** getActiveTool - returns the currently active tool
     * @returns {object} - The currently active tool and the name of the active tool as an object.
     */
    getActiveTool: mmgisAPI_.getActiveTool,

    /** getActiveTools - returns the currently active tool
     * @returns {object} - The currently active tool and the name of the active tool as an object.
     */
    getActiveTools: mmgisAPI_.getActiveTools,

    /** getLayerConfigs - returns an object with the visibility state of all layers
     * @returns {object} - an object containing the visibility state of each layer
     */
    getLayerConfigs: mmgisAPI_.getLayerConfigs,
    /** getLayers - returns an object with the visibility state of all layers
     * @returns {object} - an object containing the visibility state of each layer
     */
    getLayers: mmgisAPI_.getLayers,

    /** getVisibleLayers - returns an object with the visibility state of all layers
     * @returns {object} - an object containing the visibility state of each layer
     */
    getVisibleLayers: mmgisAPI_.getVisibleLayers,

    /** addEventListener - adds map event or MMGIS action listener.
     * @param {string} - eventName - name of event to add listener to. Available events: onPan, onZoom, onClick, toolChange, layerVisibilityChange, toggleSeparatedTool, newActiveFeature, layersToolHeaderStateChange, madeLegendTool

     * @param {function} - functionReference - function reference to listener event callback function. null value removes all functions for a given eventName

     */
    addEventListener: mmgisAPI_.addEventListener,

    /** removeEventListener - removes map event or MMGIS action listener added using the MMGIS API.
     * @param {string} - eventName - name of event to add listener to. Available events: onPan, onZoom, onClick, toolChange, layerVisibilityChange, toggleSeparatedTool, newActiveFeature
     * @param {function} - functionReference - function reference to listener event callback function. null value removes all functions for a given eventName
     */
    removeEventListener: mmgisAPI_.removeEventListener,

    /** writeCoordinateURL - writes out the current view as a url. This returns the long form of
     * the 'Copy Link' feature and does not save a short url to the database.
     * @returns {string} - a string containing the current view as a url
     */
    writeCoordinateURL: mmgisAPI_.writeCoordinateURL,

    /** onLoaded - calls onLoadCallback as a function once MMGIS has finished loading.
     * @param {function} - onLoadCallback - function reference to function that is called when MMGIS is finished loading
     */
    onLoaded: mmgisAPI_.onLoaded,

    /** initialLogin: performs the initial login call to relogin returning users. Pairable with the ENV `SKIP_CLIENT_INITIAL_LOGIN=`.
     */
    initialLogin: Login.initialLogin,

    /** project - converts a lnglat into xy coordinates with the current (custom or default web mercator) proj4 definition
     * @param {object} {lng: 0, lat: 0} - lnglat to convert
     * @returns {object} {x: 0, y: 0} - converted easting northing xy
     */
    project: mmgisAPI_.project,

    /** unproject - converts an xy into lnglat coordinates with the current (custom or default web mercator) proj4 definition
     * @returns {object} {x: 0, y: 0} - easting northing xy to convert
     * @param {object} {lng: 0, lat: 0} - converted lnglat
     */
    unproject: mmgisAPI_.unproject,

    /** toggleLayer - set the visibility state for a named layer
     * @param {string} - layerName - name of layer to set visibility
     * @param {boolean} - on - (optional) Set true if the visibility should be on or false if visibility should be off. If not set, the current visibility state will switch to the opposite state.
     */
    toggleLayer: mmgisAPI_.toggleLayer,

    /** Set a layer's opacity through the same layer-type interface used by the Layers tool. */
    setLayerOpacity: mmgisAPI_.setLayerOpacity,

    /** Set or clear a loaded layer's supported visualization filters. */
    setLayerFilter: mmgisAPI_.setLayerFilter,

    /** Set the map center and zoom through the MMGIS map controller. */
    setMapView: mmgisAPI_.setMapView,

    /** Fit the map to a flat bbox or Leaflet-style bounds array. */
    fitMapBounds: mmgisAPI_.fitMapBounds,

    /** Change only the current map zoom level. */
    setMapZoom: mmgisAPI_.setMapZoom,

    /** Restore the configured mission/site map view. */
    resetMapView: mmgisAPI_.resetMapView,

    /** Open a configured tool through ToolController_. */
    openTool: mmgisAPI_.openTool,

    /** Close a configured tool through ToolController_. */
    closeTool: mmgisAPI_.closeTool,

    /** Report whether a configured tool is currently open. */
    isToolOpen: mmgisAPI_.isToolOpen,

    /** List configured layer groups and their rendered expanded state, if open. */
    getLayerGroups: mmgisAPI_.getLayerGroups,

    /** Expand or collapse one named layer group through the Layers tool. */
    setLayerGroupExpanded: mmgisAPI_.setLayerGroupExpanded,

    /** Expand or collapse every configured layer group through the Layers tool. */
    setAllLayerGroupsExpanded: mmgisAPI_.setAllLayerGroupsExpanded,

    /** Step the initialized time controller forward or backward. */
    stepTime: mmgisAPI_.stepTime,

    /** Start or stop the initialized time controller playback loop. */
    setTimePlayback: mmgisAPI_.setTimePlayback,

    /** Move one layer within the controller-owned render stack. */
    reorderLayer: mmgisAPI_.reorderLayer,

    /** Register a namespaced, discoverable Copilot/plugin action. */
    registerCopilotAction: copilotActionRegistry.register,

    /** Remove an action owned by the registering plugin. */
    unregisterCopilotAction: copilotActionRegistry.unregister,

    /** List serializable descriptors and current availability. */
    listCopilotActions: copilotActionRegistry.list,

    /** Execute a registered action and receive {ok, message, data, error}. */
    executeCopilotAction: copilotActionRegistry.execute,

    /**
     * setLayerAttachmentConfig - retunes one of a layer's attachments (labels,
     * pairings, a path gradient, …) while it is live. The attachment reacts
     * itself if it implements `onConfigChange`; otherwise the layer is rebuilt.
     * @param {string} layerName - name of the host layer
     * @param {string} attachmentId - the attachment's id (e.g. 'path_gradient')
     * @param {object} config - the attachment's new settings
     */
    setLayerAttachmentConfig: L_.setAttachmentConfig,

    /** overwriteLegends - overwrite the contents displayed in the LegendTool; useful when used with `toggleSeparatedTool` event listener in mmgisAPI
     * @param {array} - legends - an array of objects, where each object must contain the following keys: legend, layerUUID, display_name, opacity. The value for the legend key should be in the same format as what is stored in the layers data under the `_legend` key (i.e. `L_.layers.data[layerName]._legend`). layerUUID and display_name should be strings and opacity should be a number between 0 and 1.
     */
    overwriteLegends: LegendTool.overwriteLegends,

    // Formulae_
    utils: { ...F_ },
}

registerCoreCopilotActions(copilotActionRegistry, {
    api: mmgisAPI_,
    layers: L_,
    tools: ToolController_,
    time: TimeControl,
})

window.mmgisAPI = mmgisAPI

export { mmgisAPI_, mmgisAPI }
