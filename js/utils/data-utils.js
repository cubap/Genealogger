// Data utility functions for Genealogger
import DEER from '../deer-config.js'

export function httpsIdLinks(id) {
    return [id.replace(/^https?:/, 'https:'), id.replace(/^https?:/, 'http:')]
}

export function httpsQueryArray(id) {
    return { $in: httpsIdLinks(id) }
}

/**
 * Robustly extract a value from a property, handling DEER-style value objects, arrays, and primitives.
 * @param {*} property - The property to extract a value from (can be primitive, array, or object)
 * @param {Array<string>} alsoPeek - Additional keys to check inside objects (default: common value keys)
 * @param {string} asType - Optionally coerce the value to a type ('STRING', 'NUMBER', etc)
 * @returns {*} The extracted value, or array of values if input was an array
 */
export function getValue(property, alsoPeek = [], asType) {
    let prop
    if (property === undefined || property === "") {
        console.error("Value of property to lookup is missing!")
        return undefined
    }
    if (Array.isArray(property)) {
        return property.map(p => getValue(p, alsoPeek, asType))
    } else {
        if (typeof property === "object") {
            if (!Array.isArray(alsoPeek)) alsoPeek = [alsoPeek]
            alsoPeek = alsoPeek.concat(["@value", "value", "$value", "val"])
            for (let k of alsoPeek) {
                if (property.hasOwnProperty(k)) {
                    prop = property[k]
                    break
                } else {
                    prop = property
                }
            }
        } else {
            prop = property
        }
    }
    try {
        switch (asType?.toUpperCase?.()) {
            case "STRING":
                prop = prop.toString()
                break
            case "NUMBER":
                prop = parseFloat(prop)
                break
            case "INTEGER":
                prop = parseInt(prop)
                break
            case "BOOLEAN":
                prop = !Boolean(["false", "no", "0", "", "undefined", "null"].indexOf(String(prop).toLowerCase().trim()))
                break
            default:
        }
    } catch (err) {
        if (asType) throw new Error("asType: '" + asType + "' is not possible.\n" + err.message)
    } finally {
        return (Array.isArray(prop) && prop.length === 1) ? prop[0] : prop
    }
}

/**
 * Given a person object, extract the birth/death date from related eventities (birth/death events).
 * @param {object} personObj - The person object (already expanded)
 * @param {Array<object>} allEvents - Array of all event objects (already expanded)
 * @returns {{birthDate: string|undefined, deathDate: string|undefined}}
 */
export function getEventDates(personObj, allEvents = []) {
    let birthDate, deathDate
    for (const event of allEvents) {
        if (event.additionalType === 'Birth' && event.hasAgent === personObj['@id']) {
            birthDate = event.birthDate || event.date || event.startDate
        }
        if (event.additionalType === 'Death' && event.hasAgent === personObj['@id']) {
            deathDate = event.deathDate || event.date || event.startDate
        }
    }
    return { birthDate, deathDate }
}

export function cleanArray(arr) {
    return arr.filter(arrItem => ["string", "number"].includes(typeof arrItem))
}

export function getArrayFromObj(containerObj, inputElem, DEER) {
    let cleanArrayResult = []
    let alsoPeek = ["@value", "value", "$value", "val"]
    for (let k of alsoPeek) {
        if (containerObj.hasOwnProperty(k)) {
            containerObj = containerObj[k]
            break
        }
    }
    let objType = containerObj.type || containerObj["@type"] || ""
    let arrKey = (inputElem !== null && inputElem.hasAttribute(DEER.LIST)) ? inputElem.getAttribute(DEER.LIST) : ""
    if (Array.isArray(objType)) {
        for (let t of objType) {
            if (DEER.CONTAINERS.includes(t)) {
                objType = t
                break
            }
        }
    }
    if (DEER.CONTAINERS.includes(objType)) {
        if (["Set", "List", "set", "list", "@set", "@list"].includes(objType)) {
            if (arrKey === "") {
                arrKey = "items"
            }
            if (containerObj.hasOwnProperty(arrKey)) {
                cleanArrayResult = cleanArray(containerObj[arrKey])
            }
        } else if (["ItemList"].includes(objType)) {
            if (arrKey === "") {
                arrKey = "itemListElement"
            }
            if (containerObj.hasOwnProperty(arrKey)) {
                cleanArrayResult = cleanArray(containerObj[arrKey])
            }
        }
    }
    return cleanArrayResult
}

/**
 * Fetch a document by @id, using localStorage as a cache for devstore.rerum.io and tinydev.rerum.io.
 * @param {string} id - The @id of the document to fetch.
 * @param {boolean} forceRefresh - If true, always fetch from network and update cache.
 * @returns {Promise<object>} The fetched document.
 */
export async function fetchWithCache(id, forceRefresh = false) {
    const isCacheable =
        typeof id === 'string' &&
        (id.includes('devstore.rerum.io') || id.includes('tinydev.rerum.io'))
    if (!isCacheable) {
        // Not a cacheable domain, always fetch
        return fetch(id).then(r => r.json())
    }
    if (!forceRefresh) {
        const cached = localStorage.getItem(id)
        if (cached) {
            try {
                return JSON.parse(cached)
            } catch (e) {
                // Corrupt cache, ignore
            }
        }
    }
    // Fetch and cache
    const doc = await fetch(id).then(r => r.json())
    try {
        localStorage.setItem(id, JSON.stringify(doc))
    } catch (e) {
        // Storage quota exceeded or other error
    }
    return doc
}

/**
 * Expand an entity by fetching its @id (with caching) and merging in annotation data.
 * @param {object|string} entity - The entity or @id to expand.
 * @param {Array<string>} matchOn - Properties to match for annotation merging.
 * @param {boolean} forceRefresh - If true, bypass cache for the main entity fetch.
 * @returns {Promise<object>} The expanded object.
 */
export async function expand(entity, matchOn = ["__rerum.generatedBy", "creator"], forceRefresh = false) {
    let findId = entity["@id"] || entity.id || entity
    if (typeof findId !== "string") {
        console.warn("Unable to find URI in object:", entity)
        return entity
    }
    findId = findId.replace(/https?:/, 'https:')
    const obj = await fetchWithCache(findId, forceRefresh)

    try {
        const annos = await findByTargetId(findId, matchOn, forceRefresh)
        for (const anno of annos) {
            let body = anno.body
            if (!body) continue
            if (body.evidence) {
                obj.evidence = typeof body.evidence === "object" ? body.evidence["@id"] : body.evidence
            }
            const bodies = Array.isArray(body) ? body : [body]
            for (const assertion of bodies) {
                const keys = Object.keys(assertion)
                if (keys.length !== 1) {
                    console.warn("This assertion is not as expected and may not have been interpreted correctly.", assertion)
                }
                for (const k of keys) {
                    const val = assertion[k]
                    if (obj.hasOwnProperty(k)) {
                        if (typeof obj[k] === "string") {
                            obj[k] = val
                        } else if (Array.isArray(obj[k])) {
                            obj[k].push(val)
                        } else {
                            obj[k] = [obj[k], val]
                        }
                    } else {
                        obj[k] = val
                    }
                }
            }
        }
    } catch (err) {
        // If annotation fetch fails, just return the base object
    }
    return obj
}

/**
 * Query for all items in a collection by collectionId.
 * @param {string} collectionId
 * @returns {Promise<Array<object>>}
 */
export async function listFromCollection(collectionId) {
    const queryObj = {
        body: {
            targetCollection: collectionId
        }
    }
    const pointers = await fetch(DEER.URLS.QUERY, {
        method: 'POST',
        mode: 'cors',
        headers: new Headers({
            'Content-Type': 'application/json; charset=utf-8'
        }),
        body: JSON.stringify(queryObj)
    }).then(response => response.json())
    const list = await Promise.all(
        pointers.map(tc => fetch(tc.target?.replace(/https?:/, 'https:')).then(response => response.json()))
    )
    return list
}

/**
 * Find all annotations in RERUM which target the given id, with localStorage caching.
 * @param {string} id
 * @param {Array<string>} targetStyle
 * @param {boolean} forceRefresh
 * @returns {Promise<Array<object>>}
 */
export async function findByTargetId(id, targetStyle = [], forceRefresh = false) {
    const cacheKey = `annos:${id}`
    if (!forceRefresh) {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
            try {
                return JSON.parse(cached)
            } catch (e) {
                // Corrupt cache, ignore
            }
        }
    }
    const everything = Object.keys(localStorage)
        .filter(entry => entry.startsWith('http'))
        .map(k => JSON.parse(localStorage.getItem(k)))
    if (!Array.isArray(targetStyle)) {
        targetStyle = [targetStyle]
    }
    targetStyle = targetStyle.concat(['target', 'target.@id', 'target.id'])
    const historyWildcard = { '$exists': true, '$size': 0 }
    const obj = { '$or': [], '__rerum.history.next': historyWildcard }
    const uris = httpsQueryArray(id)
    for (const target of targetStyle) {
        if (typeof target === 'string') {
            const altQuery = {}
            altQuery[target] = uris
            obj.$or.push(altQuery)
        }
    }
    let matches = await fetch(DEER.URLS.QUERY, {
        method: 'POST',
        mode: 'cors',
        headers: new Headers({
            'Content-Type': 'application/json; charset=utf-8'
        }),
        body: JSON.stringify(obj)
    })
        .then(async response => {
            if (!response.ok) return []
            try {
                return await response.json()
            } catch (e) {
                return []
            }
        })
        .catch(err => {
            console.error(err)
            return []
        })
    const local_matches = everything.filter(o => o.target === id)
    matches = local_matches.concat(matches)
    try {
        localStorage.setItem(cacheKey, JSON.stringify(matches))
    } catch (e) {
        // Storage quota exceeded or other error
    }
    return matches
}

/**
 * Handle HTTP errors for fetch responses.
 * @param {Response} response
 * @returns {Response}
 * @throws {Error}
 */
export function handleHTTPError(response) {
    if (!response.ok) {
        const status = response.status
        switch (status) {
            case 400:
                console.warn('Bad Request')
                break
            case 401:
                console.warn('Request was unauthorized')
                break
            case 403:
                console.warn('Forbidden to make request')
                break
            case 404:
                console.warn('Not found')
                break
            case 500:
                console.warn('Internal server error')
                break
            case 503:
                console.warn('Server down time')
                break
            default:
                console.warn('Unhandled HTTP ERROR')
        }
        throw Error('HTTP Error: ' + response.statusText)
    }
    return response
}
