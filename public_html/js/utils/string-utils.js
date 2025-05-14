// String utility functions for Genealogger

export function stringifyArray(arr, delim) {
    try {
        return (arr.length) ? arr.join(delim) : ""
    } catch (e) {
        console.error("There was a join error on '" + arr + "'' using delimeter '" + delim + "'.")
        return ""
    }
}

export function getLabel(obj, noLabel = "[ unlabeled ]", options = {}) {
    if (typeof obj === "string") return obj
    let label = obj[options.label] || obj.name || obj.label || obj.title
    if (Array.isArray(label)) {
        label = [...new Set(label.map(l => getValue(l)))]
    }
    if (typeof label === "object") {
        label = getValue(label)
    }
    return label || noLabel
}

// getValue is imported from data-utils.js to avoid circular dependency
import { getValue } from './data-utils.js'
