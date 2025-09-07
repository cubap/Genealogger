// DOM utility functions for Genealogger

export function assertElementValue(elem, val, mapsToAnno, DEER) {
    if (elem.type === "hidden") {
        if (elem.hasAttribute("value") && elem.value !== undefined) {
            if (!mapsToAnno || elem.value !== val) {
                elem.$isDirty = true
                if (elem.value !== val && elem.hasAttribute(DEER.INPUTTYPE)) {
                    warning("Hidden element with a hard coded 'value' also contains attributes '" + DEER.KEY + "' and '" + DEER.INPUTTYPE + "'.  ...", elem)
                }
            }
        }
    } else {
        if (elem.hasAttribute("value") && elem.value !== undefined) {
            warning("Element value is already set.  The element value should not be hard coded and will be overwritten by the annotation value '" + val + "'.  See below.", elem)
        }
        if (elem.hasAttribute(DEER.INPUTTYPE)) {
            warning("This input element also has attribute '" + DEER.INPUTTYPE + "'.  This attribute is only for hidden inputs only.  The attribute is being removed to avoid errors.")
            elem.removeAttribute(DEER.INPUTTYPE)
        }
        elem.value = val
        elem.setAttribute("value", val)
    }
}

export function broadcast(event = {}, type, element, obj = {}) {
    let e = new CustomEvent(type, { detail: Object.assign(obj, { target: event.target }), bubbles: true })
    element.dispatchEvent(e)
}

export function warning(msg, logMe) {
    if (msg) {
        console.warn(msg)
        if (logMe) {
            console.log(logMe)
        }
    }
}
