const ACTION_IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/
const PLUGIN_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/
const CATEGORY_IDENTIFIER = /^[A-Za-z][A-Za-z0-9._/-]{0,63}$/
const MAX_ANALYTICS_VALUES = 32
const MAX_ANALYTICS_VALUE_LENGTH = 64
const OMIT = Symbol('omit')
const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key)

function isPlainObject(value) {
    if (value == null || typeof value !== 'object') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function assertIdentifier(value, field, pattern) {
    if (typeof value !== 'string' || !pattern.test(value.trim())) {
        throw new TypeError(`Copilot action descriptor.${field} is invalid.`)
    }
    return value.trim()
}

function hasUnsafeMetadataText(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        if (code <= 31 || code === 127) return true
    }
    return false
}

function validateAnalyticsList(value, field) {
    if (value === undefined) return undefined
    if (!Array.isArray(value))
        throw new TypeError(
            `Copilot action descriptor.analytics.${field} must be an array.`
        )
    if (value.length > MAX_ANALYTICS_VALUES)
        throw new RangeError(
            `Copilot action descriptor.analytics.${field} may contain at most ${MAX_ANALYTICS_VALUES} values.`
        )

    const output = []
    const seen = new Set()
    value.forEach((entry) => {
        if (typeof entry !== 'string')
            throw new TypeError(
                `Copilot action descriptor.analytics.${field} values must be strings.`
            )
        const normalized = entry.trim()
        if (
            normalized.length === 0 ||
            normalized.length > MAX_ANALYTICS_VALUE_LENGTH ||
            hasUnsafeMetadataText(normalized)
        )
            throw new TypeError(
                `Copilot action descriptor.analytics.${field} values must be 1 to ${MAX_ANALYTICS_VALUE_LENGTH} safe characters.`
            )
        if (!seen.has(normalized)) {
            seen.add(normalized)
            output.push(normalized)
        }
    })
    return Object.freeze(output)
}

function validateAnalyticsMetadata(value) {
    if (value === undefined) return undefined
    if (!isPlainObject(value))
        throw new TypeError(
            'Copilot action descriptor.analytics must be a plain object.'
        )

    const analytics = {}
    const operations = validateAnalyticsList(value.operations, 'operations')
    const dataKinds = validateAnalyticsList(value.dataKinds, 'dataKinds')
    if (operations !== undefined) analytics.operations = operations
    if (dataKinds !== undefined) analytics.dataKinds = dataKinds
    if (hasOwn(value, 'requiresScalar')) {
        if (typeof value.requiresScalar !== 'boolean')
            throw new TypeError(
                'Copilot action descriptor.analytics.requiresScalar must be a boolean.'
            )
        analytics.requiresScalar = value.requiresScalar
    }
    return Object.freeze(analytics)
}

function copySerializable(value, seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (
        typeof value === 'function' ||
        typeof value === 'undefined' ||
        typeof value === 'symbol' ||
        typeof value === 'bigint'
    )
        return OMIT
    if (value instanceof Error) {
        const copiedError = {
            name: value.name || 'Error',
            message: value.message || 'Unknown error',
        }
        if (value.code != null) copiedError.code = String(value.code)
        return copiedError
    }
    if (typeof value !== 'object') return OMIT
    if (seen.has(value)) return OMIT
    seen.add(value)

    if (Array.isArray(value)) {
        const copied = []
        value.forEach((item) => {
            const result = copySerializable(item, seen)
            if (result !== OMIT) copied.push(result)
        })
        seen.delete(value)
        return copied
    }

    if (!isPlainObject(value)) {
        seen.delete(value)
        return OMIT
    }

    const copied = {}
    Object.keys(value).forEach((key) => {
        // These keys are not useful in a tool schema/result and can mutate an
        // object's prototype when copied by less defensive consumers.
        if (
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor'
        )
            return
        const result = copySerializable(value[key], seen)
        if (result !== OMIT) copied[key] = result
    })
    seen.delete(value)
    return copied
}

function hashIdentifier(value) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36).padStart(7, '0').slice(-7)
}

function safeIdentifierPart(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

/**
 * Return the portable, model-visible id for a plugin capability. Tool-call
 * names accepted by OpenAI-compatible APIs are deliberately more restrictive
 * than MMGIS plugin ids, so slashes and dots are normalized here.
 */
export function copilotActionId(plugin, name) {
    let raw = `${safeIdentifierPart(plugin)}__${safeIdentifierPart(name)}`
    if (!/^[a-z]/.test(raw)) raw = `action_${raw}`
    if (raw.length <= 64) return raw
    return `${raw.slice(0, 56)}_${hashIdentifier(raw)}`
}

function validateDescriptor(input) {
    if (!isPlainObject(input))
        throw new TypeError('Copilot action descriptor must be a plain object.')

    const name = assertIdentifier(input.name, 'name', ACTION_IDENTIFIER)
    const plugin = assertIdentifier(input.plugin, 'plugin', PLUGIN_IDENTIFIER)
    const category = assertIdentifier(
        input.category,
        'category',
        CATEGORY_IDENTIFIER
    )
    if (
        plugin.includes('..') ||
        plugin.endsWith('/') ||
        category.includes('..') ||
        category.endsWith('/')
    )
        throw new TypeError('Copilot action descriptor contains an invalid path.')
    if (
        typeof input.description !== 'string' ||
        input.description.trim().length === 0 ||
        input.description.trim().length > 4096
    )
        throw new TypeError(
            'Copilot action descriptor.description must be a non-empty string no longer than 4096 characters.'
        )
    if (!isPlainObject(input.parameters))
        throw new TypeError(
            'Copilot action descriptor.parameters must be a plain JSON-schema object.'
        )

    const parameters = copySerializable(input.parameters)
    if (!isPlainObject(parameters))
        throw new TypeError(
            'Copilot action descriptor.parameters could not be serialized.'
        )
    const analytics = validateAnalyticsMetadata(input.analytics)

    return Object.freeze({
        id: copilotActionId(plugin, name),
        name,
        plugin,
        category,
        description: input.description.trim(),
        parameters,
        ...(analytics === undefined ? {} : { analytics }),
    })
}

function availabilityResult(value) {
    if (value == null || value === true)
        return { available: true, reason: null }
    if (value === false)
        return { available: false, reason: 'Capability is not available.' }
    if (typeof value === 'string')
        return { available: false, reason: value.trim() || 'Unavailable.' }
    if (isPlainObject(value)) {
        return {
            available: value.available !== false,
            reason:
                typeof value.reason === 'string' && value.reason.trim()
                    ? value.reason.trim()
                    : null,
        }
    }
    return { available: Boolean(value), reason: null }
}

function normalizedError(error) {
    const copied = copySerializable(error)
    if (copied !== OMIT && copied != null) return copied
    return typeof error === 'string' ? error : 'Unknown error'
}

function defaultSuccessMessage(descriptor) {
    return `${descriptor.name.replace(/[._-]+/g, ' ')} completed.`
}

function normalizeResult(descriptor, value) {
    if (typeof value === 'string') {
        return { ok: true, message: value, data: null, error: null }
    }

    if (isPlainObject(value)) {
        const ok = value.ok !== false
        const error = value.error == null ? null : normalizedError(value.error)
        const copiedData = copySerializable(value.data)
        let message =
            typeof value.message === 'string' ? value.message.trim() : ''
        if (!message && !ok && typeof error === 'string') message = error
        if (!message && !ok && isPlainObject(error)) message = error.message || ''
        if (!message)
            message = ok
                ? defaultSuccessMessage(descriptor)
                : `${descriptor.name.replace(/[._-]+/g, ' ')} could not be completed.`
        return {
            ok,
            message,
            data: copiedData === OMIT ? null : copiedData,
            error,
        }
    }

    const copiedData = copySerializable(value)
    return {
        ok: true,
        message: defaultSuccessMessage(descriptor),
        data: copiedData === OMIT ? null : copiedData,
        error: null,
    }
}

/**
 * Create an isolated capability registry. The default singleton exported below
 * is wired into window.mmgisAPI; creating instances keeps unit tests and hosts
 * with more than one MMGIS application independent.
 */
export function createCopilotActionRegistry(options = {}) {
    const actions = new Map()
    const logger = options.logger || console

    async function checkAvailability(entry, args, context) {
        try {
            const value =
                typeof entry.availability === 'function'
                    ? await entry.availability({
                          args,
                          context,
                          descriptor: { ...entry.descriptor },
                      })
                    : entry.availability
            return availabilityResult(value)
        } catch (error) {
            logger?.error?.(
                `[CopilotActionRegistry] Availability check failed for "${entry.descriptor.id}".`,
                error
            )
            return {
                available: false,
                reason: 'Capability availability could not be determined.',
            }
        }
    }

    function register(descriptor, handler, availability) {
        const validated = validateDescriptor(descriptor)
        const resolvedHandler = handler || descriptor.handler
        const resolvedAvailability =
            availability !== undefined
                ? availability
                : descriptor.availability === undefined
                  ? true
                  : descriptor.availability

        if (typeof resolvedHandler !== 'function')
            throw new TypeError('A Copilot action handler function is required.')
        if (
            typeof resolvedAvailability !== 'function' &&
            typeof resolvedAvailability !== 'boolean'
        )
            throw new TypeError(
                'Copilot action availability must be a function or boolean.'
            )

        const existing = actions.get(validated.id)
        if (existing) {
            const owner = existing.descriptor.plugin
            if (owner !== validated.plugin)
                throw new Error(
                    `Copilot action id collision: "${validated.id}" is owned by plugin "${owner}".`
                )
            throw new Error(
                `Copilot action "${validated.id}" is already registered by plugin "${owner}".`
            )
        }

        actions.set(validated.id, {
            descriptor: validated,
            handler: resolvedHandler,
            availability: resolvedAvailability,
        })
        return validated.id
    }

    function unregister(actionId, plugin) {
        if (typeof actionId !== 'string' || actionId.trim() === '')
            throw new TypeError('A Copilot action id is required.')
        if (typeof plugin !== 'string' || plugin.trim() === '')
            throw new TypeError(
                'The registering plugin id is required to unregister a Copilot action.'
            )
        const resolvedId = actions.has(actionId)
            ? actionId
            : copilotActionId(plugin, actionId)
        const entry = actions.get(resolvedId)
        if (!entry) return false
        if (entry.descriptor.plugin !== plugin.trim())
            throw new Error(
                `Plugin "${plugin}" cannot unregister Copilot action "${resolvedId}" owned by "${entry.descriptor.plugin}".`
            )
        return actions.delete(resolvedId)
    }

    async function list(options = {}) {
        const output = []
        for (const entry of actions.values()) {
            if (options.plugin && entry.descriptor.plugin !== options.plugin)
                continue
            if (
                options.category &&
                entry.descriptor.category !== options.category
            )
                continue
            const state = await checkAvailability(
                entry,
                null,
                options.context || null
            )
            if (options.availableOnly === true && !state.available) continue
            output.push({
                ...copySerializable(entry.descriptor),
                available: state.available,
                unavailableReason: state.available ? null : state.reason,
            })
        }
        return output
    }

    async function execute(actionId, args = {}, context = null) {
        if (typeof actionId !== 'string' || actionId.trim() === '') {
            return {
                ok: false,
                message: 'A Copilot action id is required.',
                data: null,
                error: { code: 'INVALID_ACTION_ID' },
            }
        }
        const entry = actions.get(actionId)
        if (!entry) {
            return {
                ok: false,
                message: `Copilot action "${actionId}" is not registered.`,
                data: null,
                error: { code: 'ACTION_NOT_FOUND' },
            }
        }

        if (!isPlainObject(args)) {
            return {
                ok: false,
                message: 'Copilot action arguments must be an object.',
                data: null,
                error: { code: 'INVALID_ACTION_ARGUMENTS' },
            }
        }
        const safeArgs = copySerializable(args)

        const state = await checkAvailability(entry, safeArgs, context)
        if (!state.available) {
            return {
                ok: false,
                message: state.reason || 'This capability is currently unavailable.',
                data: null,
                error: {
                    code: 'ACTION_UNAVAILABLE',
                    reason: state.reason || null,
                },
            }
        }

        try {
            const result = await entry.handler(safeArgs, context)
            return normalizeResult(entry.descriptor, result)
        } catch (error) {
            logger?.error?.(
                `[CopilotActionRegistry] Action "${actionId}" failed.`,
                error
            )
            return {
                ok: false,
                message: `${entry.descriptor.name.replace(/[._-]+/g, ' ')} could not be completed.`,
                data: null,
                error: {
                    code: 'ACTION_EXECUTION_FAILED',
                    cause: normalizedError(error),
                },
            }
        }
    }

    return Object.freeze({ register, unregister, list, execute })
}

export const copilotActionRegistry = createCopilotActionRegistry()
