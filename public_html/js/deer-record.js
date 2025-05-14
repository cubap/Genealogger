/**
 * @module DEER Data Encoding and Exhibition for RERUM
 * @author Patrick Cuba <cubap@slu.edu>
 * @author Bryan Haberberger <bryan.j.haberberger@slu.edu>
 * @version 0.7
 * This code should serve as a basis for developers wishing to
 * use TinyThings as a RERUM proxy for an application for data entry,
 * especially within the Eventities model.
 * @see tiny.rerum.io
 */

import { default as config } from './deer-config.js'
import { expand, getValue, getArrayFromObj } from './utils/data-utils.js'
import { warning, broadcast, assertElementValue } from './utils/dom-utils.js'
import { stringifyArray } from './utils/string-utils.js'

const changeLoader = new MutationObserver(renderChange)
var DEER = config

/**
 * @description Iterates through mutations on an element and performs actions based
 * on the attribute name. It sets or retrieves JSON-formatted data from local storage
 * based on the attribute value, and adds a listener to handle click events on the element.
 * 
 * @param {array} mutationsList - list of mutations to apply to the DOM element, and
 * is used in an iteration to execute the logic for each mutation.
 * 
 * @returns {boolean} a mutated HTML element with updated data from local storage.
 */
async function renderChange(mutationsList) {
    for (var mutation of mutationsList) {
        switch (mutation.attributeName) {
            case DEER.ID:
                let id = mutation.target.getAttribute(DEER.ID)?.replace(/https?:/,'https:')
                if (id === "null") return
                let obj = {}
                try {
                    obj = JSON.parse(localStorage.getItem(id))
                } catch (err) { }
                if (!obj || !obj["@id"]) {
                    obj = await fetch(id).then(response => response.json()).catch(error => error)
                    if (obj) {
                        localStorage.setItem(obj["@id"] || obj.id, JSON.stringify(obj))
                    } else {
                        return false
                    }
                }
                new DeerReport(mutation.target, DEER)
                // TODO: This is too heavy. Create a "populateFormFields" method and call it instead.
                break
            case DEER.LISTENING:
                let listensTo = mutation.target.getAttribute(DEER.LISTENING)
                if (listensTo) {
                    mutation.target.addEventListener(DEER.EVENTS.CLICKED, e => {
                        let loadId = e.detail["@id"]
                        if (loadId === listensTo) { mutation.target.setAttribute("deer-id", loadId) }
                    })
                }
        }
    }
}

export default class DeerReport {
    /**
     * @description Defines a JavaScript class that sets up DEER (Declarative Event-Driven
     * Annotation Rendering) annotation handling for an HTML form. It listens to DOM
     * events, handles value retrieval and validation, and broadcasts form rendering events.
     * 
     * @param {object} elem - HTML element for which the script is checking and setting
     * the value of its annotation attribute.
     * 
     * @param {object} deer - Deer library's initialization object, which is used to
     * provide access to various utility functions and events for managing form and view
     * data.
     */
    constructor(elem, deer = {}) {
        for (let key in DEER) {
            if (typeof DEER[key] === "string") {
                DEER[key] = deer[key] || config[key]
            } else {
                DEER[key] = Object.assign(config[key], deer[key])
            }
        }
        this.$isDirty = false
        this.id = elem.getAttribute(DEER.ID)
        this.elem = elem
        this.evidence = elem.getAttribute(DEER.EVIDENCE) // inherited to inputs
        this.context = elem.getAttribute(DEER.CONTEXT) // inherited to inputs
        this.attribution = elem.getAttribute(DEER.ATTRIBUTION) // inherited to inputs
        this.motivation = elem.getAttribute(DEER.MOTIVATION) // inherited to inputs
        this.type = elem.getAttribute(DEER.TYPE)
        this.inputs = elem.querySelectorAll(DEER.INPUTS.map(s => s + "[" + DEER.KEY + "]").join(","))
        changeLoader.observe(elem, {
            attributes: true
        })
        elem.oninput = event => this.$isDirty = true
        elem.onsubmit = this.processRecord.bind(this)

        if (this.id) {
            expand({ "@id": this.id })
                .then((obj) => {
                    try {
                        for (let i = 0; i < inputElems.length; i++) {
                            if (deerKeyValue) {
                                if (obj.hasOwnProperty(deerKeyValue)) {
                                    if(obj[deerKeyValue].evidence)el.setAttribute(DEER.EVIDENCE, obj[deerKeyValue].evidence)
                                    if(obj[deerKeyValue].motivation)el.setAttribute(DEER.MOTIVATION, obj[deerKeyValue].motivation)
                                    if(obj[deerKeyValue].creator)el.setAttribute(DEER.ATTRIBUTION, obj[deerKeyValue].creator)

                                    assertedValue = getValue(obj[deerKeyValue])
                                    mapsToAnno = (typeof obj[deerKeyValue] === "object" && obj[deerKeyValue].hasOwnProperty("source"))
                                    if (mapsToAnno) {
                                        el.setAttribute(DEER.SOURCE, getValue(obj[deerKeyValue].source, "citationSource"))
                                    }
                                    let annoBodyObjectType = (typeof assertedValue === "object") ? assertedValue.type || assertedValue["@type"] || "" : ""
                                    let delim = el.getAttribute(DEER.ARRAYDELIMETER) || DEER.DELIMETERDEFAULT || ","
                                    let arrayOfValues = []
                                    if (Array.isArray(assertedValue)) {
                                        /**
                                         * This could mean multiple annotations of similar bodies exist so UTILS.expand() put them together.
                                         * This could mean that the key on the orignal object also had annotations existing for it so UTILS.expand() put them together.
                                         * This could mean that the key on the original object was an array already, and may not contain anything we can get a value from.
                                         * We will preference the first entry of the array that is an annotation.  
                                         * If no annotations are found, DEER will aribitrarily pick the last string or number encountered.   
                                         * DEER does not technically support this situation, but can make a best guess and help it along...
                                         */
                                        warning("There are multiple possible values for key '" + deerKeyValue + "'. See below. ", assertedValue)
                                        let arbitraryAssertedValue = ""
                                        for (let entry of assertedValue) {
                                            if (["string", "number"].indexOf(typeof entry) > -1) {
                                                //We found it and understand it, but we preference annotation objects so look at the rest of the entries.
                                                //Consequently, if no annotations are found, the last string/number entry will be the one DEER uses.
                                                mapsToAnno = false
                                                el.setAttribute(DEER.SOURCE, getValue(entry.source, "citationSource"))
                                                assertedValue = arbitraryAssertedValue = getValue(entry)
                                            } else if (typeof entry === "object") {
                                                if (entry.hasOwnProperty(deerKeyValue) && entry[deerKeyValue].hasOwnProperty("source")) {
                                                    //Then this is an object like {deerKeyValue:{value:"hopefully", source:"anno/123"}} and can be preferenced
                                                    mapsToAnno = true
                                                    el.setAttribute(DEER.SOURCE, getValue(entry.source, "citationSource"))
                                                    assertedValue = arbitraryAssertedValue = getValue(entry[deerKeyValue])
                                                    break
                                                } else if (entry.hasOwnProperty("source")) {
                                                    //Then this is an object like {value:"hopefully", source:"anno/123"} and can be preferenced
                                                    mapsToAnno = true
                                                    el.setAttribute(DEER.SOURCE, getValue(entry.source, "citationSource"))
                                                    assertedValue = arbitraryAssertedValue = getValue(entry)
                                                    break
                                                }
                                            }
                                        }
                                        if (arbitraryAssertedValue) { warning("DEER arbitrarily chose the value '" + arbitraryAssertedValue + "'.") } else {
                                            console.error("DEER did not understand any of these values.  Therefore, the value will be an empty string.")
                                            assertedValue = ""
                                        }
                                    } else if (typeof assertedValue === "object") {
                                        //getValue either returned an object because it could not find obj.value or because obj.value was an object.  
                                        if (mapsToAnno) {
                                            //Then getValue found an annotation DEER understood and the body.value was an object.
                                            if (el.getAttribute(DEER.INPUTTYPE)) {
                                                //Only an element noted as a DEER.INPUTTYPE would have this kind of annotation behind it.  For others, it is an error.  
                                                if (annoBodyObjectType === "" || el.getAttribute(DEER.INPUTTYPE) !== annoBodyObjectType) {
                                                    //The HTML input should note the same type of container as the annotation so helper functiions can determine if it is a supported in DEER.CONTAINERS
                                                    warning("Container type mismatch!.  See attribute '" + DEER.INPUTTYPE + "' on element " + el.outerHTML + "." +
                                                        " The element is now dirty and will overwrite the type noted in the annotation seen below upon form submission." +
                                                        " If the type of the annotation body is not a supported type then DEER will not be able to get the array of values.", obj[deerKeyValue])
                                                }
                                                if (el.getAttribute(DEER.INPUTTYPE) === "object") {
                                                    try {
                                                        assertedValue = JSON.stringify(assertedValue)
                                                    } catch (err) {
                                                        assertedValue = ""
                                                    }
                                                } else {
                                                    arrayOfValues = getArrayFromObj(assertedValue, el)
                                                    assertedValue = stringifyArray(arrayOfValues, delim)
                                                }
                                            } else {
                                                //This should have been a string or number.  We do not support whatever was meant to be here.  
                                                console.error("We do not support annotation body values that are objects, unless they are a supported container object and the element " + el.outerHTML + " notes '" + DEER.INPUTTYPE + "'.  Therefore, the value of annotation is being ignored.  See annotation below.")
                                                console.log(obj[deerKeyValue])
                                                assertedValue = ""
                                            }
                                        } else {
                                            //Then getValue returned an object and could not confirm it was an annotation.  We cannot find a value. 
                                            console.error("Could not find 'value' in the object body.  See below.")
                                            console.log(obj[deerKeyValue])
                                            assertedValue = ""
                                        }
                                    } else if ((["string", "number"].indexOf(typeof assertedValue) > -1)) {
                                        //getValue either found that obj[deerKeyValue] was a string or found that it was an object with a 'value' that was a string or number. 
                                        //The asserted value is already set and we know whether or not it mapsToAnno, so do nothing.  Keep this here for future handling. 
                                    } else {
                                        //An undefined situation perhaps?
                                        console.error("We do not support values of this type '" + typeof assertedValue + "'.  Therefore, the value of annotation is being ignored.  See annotation below.")
                                        console.log(obj[deerKeyValue])
                                        assertedValue = ""
                                    }
                                }
                                assertElementValue(el, assertedValue, mapsToAnno)
                            }
                        }
                    } catch (err) { console.log(err) }
                    setTimeout(function () {
                        /*
                         *  The difference between a view and a form is that a view does not need to know the annotation data of its sibling views.  
                         *  A form needs to know the annotation data of all its child views to populate values, but this hierarchy is not inherent.
                         *  
                         *  This event works because of deerInitializer.js.  It loads all views in a Promise that uses a timeout
                         *  in its resolve state, giving all innerHTML = `something` calls time to make it to the DOM before this event broadcasts.  
                         *  You will notice that the "deer-view-rendered" events all happen before this event is fired on respective HTML pages.
                         *  This lets the script know forms are open for dynamic rendering interaction, like pre-filling or pre-selecting values.
                         */
                        broadcast(undefined, DEER.EVENTS.FORM_RENDERED, elem, obj)
                    }, 0)
                    //Note this is deprecated for the "deer-form-rendered" event.
                    broadcast(undefined, DEER.EVENTS.LOADED, elem, obj)
                })
                .then(() => elem.click())
        } else {
            Array.from(this.inputs).forEach(inpt => {
                if (inpt.getAttribute(DEER.KEY)) { inpt.addEventListener('input', (e) => e.target.$isDirty = true) }
                if (inpt.type === "hidden") { inpt.$isDirty = true }
            })
        }
    }

    /**
     * @description Takes an input element and creates a new DEER annotation with its own
     * ID, based on the input's ID. It also sets the annotation's "value" field to the
     * input's value, and adds any additional fields specified in the input (such as
     * "title", "name", or "evidence"). The function then submits the new annotation to
     * the DEER server for storage.
     * 
     * @param {string} event - event or action that triggered the creation of the new
     * entity, and it is used to specify the URL for fetching the entity data from the
     * DEER API.
     * 
     * @returns {object} a new entity with the updated annotation information.
     */
    processRecord(event) {
        event.preventDefault()
        this.evidence = this.elem.getAttribute(DEER.EVIDENCE) // inherited to inputs
        this.context = this.elem.getAttribute(DEER.CONTEXT) // inherited to inputs
        this.attribution = this.elem.getAttribute(DEER.ATTRIBUTION) // inherited to inputs
        this.motivation = this.elem.getAttribute(DEER.MOTIVATION) // inherited to inputs
        this.type = this.elem.getAttribute(DEER.TYPE)

        if (!this.$isDirty) {
            warning(event.target.id + " form submitted unchanged.")
        }
        if (this.elem.getAttribute(DEER.ITEMTYPE) === "simple") {
            return this.simpleUpsert(event).then(entity => {
                //Notice that sipleUpsert may return {} in certain controlled situations, causing an undefined error here, on purpose.
                this.elem.setAttribute(DEER.ID, entity["@id"])
                new DeerReport(this.elem)
            })
        }
        let record = {
            "@type": this.type
        }
        if (this.context) { record["@context"] = this.context }
        for (let p of DEER.PRIMITIVES) {
            try {
                record[p] = this.elem.querySelector("[" + DEER.KEY + "='" + p + "']").value
            } catch (err) {
                warning(err, null)
            }
        }
        let formAction
        if (this.id) {
            record["@id"] = this.id
            formAction = Promise.resolve(record)
        } else {
            let self = this
            formAction = fetch(DEER.URLS.CREATE, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify(record)
            })
                .then(response => response.json())
                .then(data => {
                    broadcast(undefined, DEER.EVENTS.CREATED, self.elem, data.new_obj_state)
                    return data.new_obj_state
                })
                .catch(err => { })
        }

        formAction.then((function (entity) {
            let annotations = Array.from(this.elem.querySelectorAll(DEER.INPUTS.map(s => s + "[" + DEER.KEY + "]").join(","))).filter(el => Boolean(el.$isDirty))
            if (annotations.length === 0) {
                //May be worthwhile to call out the lack of descriptive information in this form submission.
            }
            let flatKeys = annotations.map(input => input.getAttribute(DEER.KEY))
            annotations = annotations.filter((el, i) => {
                //Throw a soft error if we detect duplicate deer-key entries, and only respect the first one.
                if (flatKeys.indexOf(el.getAttribute(DEER.KEY)) !== i) {
                    warning("Duplicate input " + DEER.KEY + " attribute value '" + el.getAttribute(DEER.KEY) + "' detected during submission.  This input will be ignored.  See duplicate below. ", el)
                }
                return flatKeys.indexOf(el.getAttribute(DEER.KEY)) === i
            })
                .map(input => {
                    let inputId = input.getAttribute(DEER.SOURCE)?.replace(/https?:/,'https:')
                    let creatorId = input.getAttribute(DEER.ATTRIBUTION) || this.attribution
                    let motivation = input.getAttribute(DEER.MOTIVATION) || this.motivation
                    let evidence = input.getAttribute(DEER.EVIDENCE) || this.evidence
                    let action = (inputId) ? "UPDATE" : "CREATE"
                    let annotation = {
                        type: "Annotation",
                        target: entity["@id"]?.replace(/https?:/,'https:'),
                        body: {}
                    }
                    if(creatorId) { annotation.creator = creatorId?.replace(/https?:/,'https:') }
                    if(motivation) { annotation.motivation = motivation }
                    if(evidence) { annotation.evidence = evidence }
                    let delim = (input.hasAttribute(DEER.ARRAYDELIMETER)) ? input.getAttribute(DEER.ARRAYDELIMETER) : (DEER.DELIMETERDEFAULT) ? DEER.DELIMETERDEFAULT : ","
                    let val = input.value
                    let inputType = input.getAttribute(DEER.INPUTTYPE)
                    let arrKey = (input.hasAttribute(DEER.LIST)) ? input.getAttribute(DEER.LIST) : ""
                    if (input.hasAttribute(DEER.INPUTTYPE)) {
                        switch (inputType) {
                            case "List":
                            case "Set":
                            case "set":
                            case "list":
                            case "@set":
                            case "@list":
                                if (arrKey === "") {
                                    arrKey = "items"
                                    warning("Found input with '" + DEER.INPUTTYPE + "' attribute but no '" + DEER.LIST + "' attribute during submission.  DEER will use the default schema '" + arrKey + "' to save the array values for this " + inputType + ".", input)
                                }
                                annotation.body[input.getAttribute(DEER.KEY)] = { "@type": inputType }
                                annotation.body[input.getAttribute(DEER.KEY)][arrKey] = val.split(delim)
                                break
                            case "ItemList":
                                if (arrKey === "") {
                                    arrKey = "itemListElement"
                                    warning("Found input with '" + DEER.INPUTTYPE + "' attribute but no '" + DEER.LIST + "' attribute during submission.  DEER will use the default schema '" + arrKey + "' to save the array values for this " + inputType + ".", input)
                                }
                                annotation.body[input.getAttribute(DEER.KEY)] = { "@type": inputType }
                                annotation.body[input.getAttribute(DEER.KEY)][arrKey] = val.split(delim)
                                break
                            case "object":
                                let body = {
                                    profile: "http://www.w3.org/ns/anno.jsonld",
                                    value: val
                                }
                                try {
                                    body = JSON.parse(val)
                                } catch (err) { }
                                annotation.body[input.getAttribute(DEER.KEY)] = body
                                break
                            default:
                                warning("Cannot save value of unsupported type '" + inputType + "'.  This annotation will not be saved or updated.", input)
                                return false
                        }
                    } else {
                        annotation.body[input.getAttribute(DEER.KEY)] = {
                            "value": val
                        }
                    }

                    if (inputId) { annotation["@id"] = inputId }
                    // TODO: maybe we need a deer-value to assign things here... or some option...
                    if (input.getAttribute(DEER.KEY) === "targetCollection") {
                        annotation.body.targetCollection = input.value
                    }
                    let name = input.getAttribute("title")
                    if (name) { annotation.body[input.getAttribute(DEER.KEY)].name = name }
                    return fetch(DEER.URLS[action], {
                        method: (inputId) ? "PUT" : "POST",
                        headers: {
                            "Content-Type": "application/json; charset=utf-8"
                        },
                        body: JSON.stringify(annotation)
                    })
                        .then(response => response.json())
                        .then(anno => {
                            input.setAttribute(DEER.SOURCE, anno.new_obj_state["@id"])
                            if(anno.new_obj_state.evidence)input.setAttribute(DEER.EVIDENCE, anno.new_obj_state.evidence)
                            if(anno.new_obj_state.motivation)input.setAttribute(DEER.MOTIVATION, anno.new_obj_state.motivation)
                            if(anno.new_obj_state.creator)input.setAttribute(DEER.ATTRIBUTION, anno.new_obj_state.creator)
                    })
                })
            return Promise.all(annotations).then(() => entity)
        }).bind(this))
            .then(entity => {
                this.elem.setAttribute(DEER.ID, entity["@id"])
                new DeerReport(this.elem)
            })
    }

    /**
     * @description Upserts a simple JSON object to a specified URL, based on the values
     * of form inputs. It checks for required fields, supports array inputs, and returns
     * the result of the HTTP request.
     * 
     * @param {object} event - annotation event for which the function is generating
     * documentation, and it is not used in the provided code.
     * 
     * @returns {object} a JSON-formatted object representing the submitted form data,
     * ready to be saved or updated.
     */
    simpleUpsert(event) {
        let record = {}
        //Since this is simple, we don't need to filter around $isDirty.
        Array.from(this.elem.querySelectorAll(DEER.INPUTS.map(s => s + "[" + DEER.KEY + "]").join(","))).map(input => {
            let key = input.getAttribute(DEER.KEY)
            record[key] = {}
            let val = input.value
            let title = input.getAttribute("title")
            let evidence = input.getAttribute(DEER.EVIDENCE)
            if (title) record[key].name = title
            if (evidence) record[key].evidence = evidence
            let inputType = input.getAttribute(DEER.INPUTTYPE)
            let arrKey = (input.hasAttribute(DEER.LIST)) ? input.getAttribute(DEER.LIST) : ""
            let delim = (input.hasAttribute(DEER.ARRAYDELIMETER)) ? input.getAttribute(DEER.ARRAYDELIMETER) : (DEER.DELIMETERDEFAULT) ? DEER.DELIMETERDEFAULT : ","
            if (input.hasAttribute(DEER.INPUTTYPE)) {
                switch (inputType) {
                    case "List":
                    case "Set":
                    case "set":
                    case "list":
                    case "@set":
                    case "@list":
                        if (arrKey === "") {
                            arrKey = "items"
                            warning("Found input with '" + DEER.INPUTTYPE + "' attribute but no '" + DEER.LIST + "' attribute during submission.  DEER will use the default schema '" + arrKey + "' to save the array values for this " + inputType + ".", input)
                        }
                        record[key]["@type"] = inputType
                        record[key][arrKey] = val.split(delim)
                        break
                    case "ItemList":
                        if (arrKey === "") {
                            arrKey = "itemListElement"
                            warning("Found input with '" + DEER.INPUTTYPE + "' attribute but no '" + DEER.LIST + "' attribute during submission.  DEER will use the default schema '" + arrKey + "' to save the array values for this " + inputType + ".", input)
                        }
                        record[key] = { "@type": inputType }
                        record[key][arrKey] = val.split(delim)
                        break
                    case "object":
                        let body = {
                            profile: "http://www.w3.org/ns/anno.jsonld",
                            value: val
                        }
                        try {
                            body = JSON.parse(val)
                        } catch (err) { }
                        record[key] = body
                        break
                    default:
                        warning("Cannot save value of unsupported type '" + inputType + "'.  This annotation will not be saved or updated.", input)
                        return false
                }
            } else {
                //Assuming that a simple object doesn't want the values of key:value pairs to be objects unless it has to, so we won't wrap like key:{value:{}}
                record[key] = val
            }
        })
        if (Object.keys(record).length === 0) {
            //There is no good reason for this, but DEER allows it.  However, there better a type otherwise it is completely undescribed.
            warning("The form submitted does not contain any inputs. The resulting entity will not have any descriptive encoding.", this.elem)
            if (!this.type) {
                //DEER does not abide.  A completely undescribed object, even if we were to find evidence and context, is useless, especially in this 'simple' context. 
                warning("Form submission should not result in a completely undescribed object.  At least a 'type' property must be present.  Please add information to submit this simple form.", this.elem)
                //Deny outright and send an empty object upstream (see processRecord).
                return {}
            }
        }
        if (this.type) { record.type = this.type }
        if (this.context) { record["@context"] = this.context }
        if (this.evidence) { record.evidence = this.evidence }
        let formId = this.elem.getAttribute(DEER.ID)
        let action = "CREATE"
        if (formId) {
            action = "OVERWRITE"
            record["@id"] = formId
        }
        return fetch(DEER.URLS[action], {
            method: (formId) ? "PUT" : "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify(record)
        })
            .then(response => response.json())
            .then(obj => { return obj.new_obj_state })
    }
}

/**
 * @description Creates a new resource by sending an HTTP POST request to the
 * `CREATE_URL` endpoint, passing in the JSON representation of the resource as the
 * request body. If the request is successful, it updates the list of resources stored
 * locally and returns the newly created resource.
 * 
 * @param {object} obj - JSON object containing information about a resource, which
 * is used to generate high-quality documentation for that resource.
 * 
 * @param {object} attribution - entity responsible for creating the new object, and
 * is used to set the value of the `creator` property in the generated resource.
 * 
 * @param {array} evidence - evidence associated with the created object, which is
 * optional and can be provided for further attribution or authentication purposes.
 * 
 * @returns {object} a JSON object containing information about the newly created
 * object, including its ID, context, type, and name.
 */
async function create(obj, attribution, evidence) {
    let mint = {
        "@context": obj["@context"] || this.default.context,
        "@type": obj["@type"] || this.default.type,
        "name": this.getValue(obj.name || obj.label) || this.default.name,
        "creator": attribution || this.default.creator
    }
    if (evidence) {
        mint.evidence = evidence
    }
    const newObj = await fetch(CREATE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(mint)
    })
        .then(this.handleHTTPError)
        .then(response => response.json())
    const listID = localStorage.getItem("CURRENT_LIST_ID") || this.DEFAULT_LIST_ID
    let list = await get(listID)
    const objID = newObj.new_obj_state["@id"]
    list.resources.push({
        "@id": objID,
        "label": newObj.new_obj_state.name
    })
    try {
        list = await fetch(UPDATE_URL, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify(list)
        })
            .then(this.handleHTTPError)
            .then(response => response.json().new_obj_state)
            .catch(err => Promise.reject(err))
    } catch (err) { }
    localStorage.setItem(list["@id"], JSON.stringify(list))
    localStorage.setItem("CURRENT_LIST_ID", list["@id"])
    let annotations = []
    for (var key of Object.keys(obj)) {
        if (["@context", "@type", "name"].indexOf(key) > -1) {
            continue
        }
        let annotation = {
            "@context": "",
            "@type": "Annotation",
            "motivation": "describing",
            "target": objID,
            "body": {}
        }
        annotation.body[key] = obj[key]
        if (attribution) {
            annotation.creator = attribution
        }
        if (evidence) {
            annotation.evidence = evidence
        }
        annotations.push(annotation)
    }
    // just enforcing the delay
    let temp = await Promise.all(annotations.map(upsert))
    return newObj.new_obj_state
}

/**
 * @description Iterates over select elements with a class of "deer-form" and creates
 * a `DeerReport` instance for each one. Additionally, it listens for new forms to
 * be added via the `DEER.EVENTS.NEW_FORM` event and creates instances for those as
 * well.
 * 
 * @param {object} config - configuration for the DeerForms library, which includes
 * settings such as the forms to be processed, the event listeners, and other
 * customization options.
 */
export function initializeDeerForms(config) {
    const forms = document.querySelectorAll(config.FORM)
    Array.from(forms).forEach(elem => new DeerReport(elem, config))
    document.addEventListener(DEER.EVENTS.NEW_FORM, e => Array.from(e.detail.set).forEach(elem => new DeerReport(elem, config)))
}
