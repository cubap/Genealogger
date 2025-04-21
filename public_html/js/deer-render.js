/* global fetch */

/**
 * @module DeerRender Data Encoding and Exhibition for RERUM
 * @author Patrick Cuba <cubap@slu.edu>
 * @author Bryan Haberberger <bryan.j.haberberger@slu.edu>
 * @version 0.7
 
 
 * This code should serve as a basis for developers wishing to
 * use TinyThings as a RERUM proxy for an application for data entry,
 * especially within the Eventities model.
 * @see tiny.rerum.io
 */

import { default as UTILS } from './deer-utils.js'
import { default as config } from './deer-config.js'

const changeLoader = new MutationObserver(renderChange)
var DEER = config

/**
 * Observer callback for rendering newly loaded objects. Checks the
 * mutationsList for "deep-object" attribute changes.
 * @param {Array} mutationsList of MutationRecord objects
 */
async function renderChange(mutationsList) {
    for (var mutation of mutationsList) {
        switch (mutation.attributeName) {
            case DEER.ID:
            case DEER.KEY:
            case DEER.LINK:
            case DEER.LIST:
                let id = mutation.target.getAttribute(DEER.ID)
                if (id === "null" || mutation.target.getAttribute(DEER.COLLECTION))
                    return null
                let obj = {}
                try {
                    obj = JSON.parse(localStorage.getItem(id))
                } catch (err) {
                }
                if (!obj || !obj["@id"]) {
                    obj = await fetch(id).then(response => response.json()).catch(error => error)
                    if (obj) {
                        localStorage.setItem(obj["@id"] || obj.id, JSON.stringify(obj))
                    } else {
                        return false
                    }
                }
                RENDER.element(mutation.target, obj)
                break
            case DEER.LISTENING:
                let listensTo = mutation.target.getAttribute(DEER.LISTENING)
                if (listensTo) {
                    mutation.target.addEventListener(DEER.EVENTS.CLICKED, e => {
                        let loadId = e.detail["@id"]
                        if (loadId === listensTo) {
                            mutation.target.setAttribute("deer-id", loadId)
                        }
                    })
                }
        }
    }
}

const RENDER = {}

RENDER.element = function (elem, obj) {

    return UTILS.expand(obj).then(obj => {
        let tmplName = elem.getAttribute(DEER.TEMPLATE) || (elem.getAttribute(DEER.COLLECTION) ? "list" : "json")
        let template = DEER.TEMPLATES[tmplName] || DEER.TEMPLATES.json
        let options = {
            list: elem.getAttribute(DEER.LIST),
            link: elem.getAttribute(DEER.LINK),
            collection: elem.getAttribute(DEER.COLLECTION),
            key: elem.getAttribute(DEER.KEY),
            label: elem.getAttribute(DEER.LABEL),
            config: DEER
        }
        let templateResponse = template(obj, options)
        elem.innerHTML = (typeof templateResponse.html === "string") ? templateResponse.html : templateResponse
        //innerHTML may need a little time to finish to actually populate the template to the DOM, so do the timeout trick here.
        /**
         * A streamlined approach would treat each of these as a Promise-like node and the return of RENDER.element
         * would be a Promise.  That way, something that looped and did may of these could do something like
         * Promise.all() before firing a completion/failure event (or something).  
         */
        setTimeout(function () {
            let newViews = (elem.querySelectorAll(config.VIEW).length) ? elem.querySelectorAll(config.VIEW) : []
            let newForms = (elem.querySelectorAll(config.FORM).length) ? elem.querySelectorAll(config.VIEW) : []
            if (newForms.length) {
                UTILS.broadcast(undefined, DEER.EVENTS.NEW_FORM, elem, { set: newForms })
            }
            if (newViews.length) {
                UTILS.broadcast(undefined, DEER.EVENTS.NEW_VIEW, elem, { set: newViews })
            }
            UTILS.broadcast(undefined, DEER.EVENTS.VIEW_RENDERED, elem, obj)
        }, 0)

        if (typeof templateResponse.then === "function") {
            templateResponse.then(elem, obj, options)
        }
        //Note this is deprecated for the "deer-view-rendered" event.  above.  
        UTILS.broadcast(undefined, DEER.EVENTS.LOADED, elem, obj)
    })
}

/**
 * The TEMPLATED renderer to draw JSON to the screen
 * @param {Object} obj some json to be drawn as JSON
 * @param {Object} options additional properties to draw with the JSON
 */
class DeerJsonTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const indent = options.indent || 4
        const replacer = (k, v) => {
            if (DEER.SUPPRESS.indexOf(k) !== -1) return null
            return v
        }
        try {
            this.innerHTML = `<pre>${JSON.stringify(obj, replacer, indent)}</pre>`
        } catch (err) {
            this.innerHTML = null
        }
    }
}

customElements.define('deer-json', DeerJsonTemplate)

/**
 * Get a certain property from an object and return it formatted as HTML to be drawn.  
 * @param {Object} obj some obj containing a key that needs to be drawn
 * @param {String} key the name of the key in the obj we are looking for
 * @param {String} label The label to be displayed when drawn
 */
class DeerPropTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const key = options.key || "@id"
        const prop = obj[key] || "[ undefined ]"
        const label = options.label || UTILS.getLabel(obj, prop)
        try {
            this.innerHTML = `<span class="${prop}">${label}: ${UTILS.getValue(prop) || "[ undefined ]"}</span>`
        } catch (err) {
            this.innerHTML = null
        }
    }
}

customElements.define('deer-prop', DeerPropTemplate)

/**
 * Get a certain property from an object and return it formatted as HTML to be drawn.  
 * @param {Object} obj some obj containing a key that needs to be drawn
 * @param {String} key the name of the key in the obj we are looking for
 * @param {String} label The label to be displayed when drawn
 */
class DeerLabelTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const key = options.key || "@id"
        const prop = obj[key] || "[ undefined ]"
        const label = UTILS.getLabel(obj, prop)
        try {
            this.innerHTML = options.link 
                ? `<a href="${options.link + obj['@id']}">${label}</a>` 
                : `${label}`
        } catch (err) {
            this.innerHTML = null
        }
    }
}

customElements.define('deer-label', DeerLabelTemplate)

/**
 * The TEMPLATED renderer to draw an JSON to the screen as some HTML template
 * @param {Object} obj some json of type Entity to be drawn
 * @param {Object} options additional properties to draw with the Entity
 */
class DeerEntityTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        let tmpl = `<h2>${UTILS.getLabel(obj)}</h2>`
        let list = ''

        for (let key in obj) {
            if (DEER.SUPPRESS.includes(key)) continue

            let label = key
            let value = UTILS.getValue(obj[key], key)
            try {
                if ((value.image || value.trim()).length > 0) {
                    list += (label === "depiction") 
                        ? `<img title="${label}" src="${value.image || value}" ${DEER.SOURCE}="${UTILS.getValue(obj[key].source, 'citationSource')}">`
                        : `<dt deer-source="${UTILS.getValue(obj[key].source, 'citationSource')}">${label}</dt><dd>${value.image || value}</dd>`
                }
            } catch {
                list += `<dt>${label}</dt>`
                if (Array.isArray(value)) {
                    value.forEach((v, index) => {
                        let name = UTILS.getLabel(v, (v.type || v['@type'] || label + '' + index))
                        list += (v["@id"])
                            ? `<dd><a href="#${v["@id"]}">${name}</a></dd>`
                            : `<dd ${DEER.SOURCE}="${UTILS.getValue(v.source, 'citationSource')}">${UTILS.getValue(v)}</dd>`
                    })
                } else {
                    if (typeof value === "string") {
                        value = {
                            value: value,
                            source: {
                                citationSource: obj['@id'] || obj.id || "",
                                citationNote: "Primitive object from DEER",
                                comment: "Learn about the assembler for this object at https://github.com/CenterForDigitalHumanities/deer"
                            }
                        }
                    }
                    let v = UTILS.getValue(value)
                    if (typeof v === "object") v = UTILS.getLabel(v)
                    if (v === "[ unlabeled ]") v = v['@id'] || v.id || "[ complex value unknown ]"
                    list += (value['@id'])
                        ? `<dd ${DEER.SOURCE}="${UTILS.getValue(value.source, 'citationSource')}"><a href="${options.link || ''}#${value['@id']}">${v}</a></dd>`
                        : `<dd ${DEER.SOURCE}="${UTILS.getValue(value, 'citationSource')}">${v}</dd>`
                }
            }
        }
        tmpl += (list.includes("</dd>")) ? `<dl>${list}</dl>` : ''
        this.innerHTML = tmpl
    }
}

class DeerListTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        let tmpl = `<h2>${UTILS.getLabel(obj)}</h2>`
        if (options.list) {
            tmpl += `<ul>`
            obj[options.list].forEach((val, index) => {
                let name = UTILS.getLabel(val, (val.type || val['@type'] || index))
                tmpl += (val["@id"] && options.link)
                    ? `<li ${DEER.ID}="${val["@id"]}"><a href="${options.link}${val["@id"]}">${name}</a></li>`
                    : `<li ${DEER.ID}="${val["@id"]}">${name}</li>`
            })
            tmpl += `</ul>`
        }
        this.innerHTML = tmpl
    }
}

class DeerPersonTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        let tmpl = `<h2>${UTILS.getLabel(obj)}</h2>`
        let dob = `<deer-prop-template data-obj='${JSON.stringify(obj)}' data-options='{"key": "birthDate", "label": "Birth Date"}'></deer-prop-template>`
        let dod = `<deer-prop-template data-obj='${JSON.stringify(obj)}' data-options='{"key": "deathDate", "label": "Death Date"}'></deer-prop-template>`
        let famName = (obj.familyName && UTILS.getValue(obj.familyName)) || "[ unknown ]"
        let givenName = (obj.givenName && UTILS.getValue(obj.givenName)) || ""
        tmpl += (obj.familyName || obj.givenName) ? `<div>Name: ${famName}, ${givenName}</div>` : ''
        tmpl += dob + dod
        tmpl += `<a href="#${obj["@id"]}">${UTILS.getLabel(obj)}</a>`
        this.innerHTML = tmpl
    }
}

customElements.define('deer-entity', DeerEntityTemplate)
customElements.define('deer-list', DeerListTemplate)
customElements.define('deer-person', DeerPersonTemplate)

class DeerEventTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        this.innerHTML = `<h1>${UTILS.getLabel(obj)}</h1>`
    }
}

class DeerChildrenListTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const options = JSON.parse(this.getAttribute('data-options') || '{}')

        const getChildren = async () => {
            const query = {
                $or: [
                    { "body.hasFather.value": UTILS.httpsQueryArray(obj["@id"]) },
                    { "body.hasMother.value": UTILS.httpsQueryArray(obj["@id"]) }
                ],
                "__rerum.history.next": { "$exists": true, "$size": 0 }
            }

            const response = await fetch("https://tinydev.rerum.io/query", {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
            })

            const annos = await response.json().catch(() => [])
            return annos.map(a => UTILS.getValue(a.target))
        }

        this.innerHTML = `<ul> Seeking children...</ul>`

        getChildren().then(kIDs => {
            this.innerHTML = kIDs.length
                ? `<ul>Offspring
                    ${kIDs.reduce((b, a) => b += `<li><deer-view deer-id="${a}" deer-template="label" deer-link="#" title="Click to view"></deer-view></li>`, ``)}
                   </ul>`
                : `[ no child records ]`

            setTimeout(() => UTILS.broadcast(undefined, DEER.EVENTS.NEW_VIEW, this, { set: this.querySelectorAll("[deer-template]") }), 0)
        })
    }
}

class DeerTimelineTemplate extends HTMLElement {
    connectedCallback() {
        const obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        let tmpl = `<ul>`
        for (const item of obj.itemListElement) {
            tmpl += `<li><deer-view deer-template="personDates" deer-id="${item['@id']}"></deer-view></li>`
        }
        tmpl += `</ul>`
        this.innerHTML = tmpl
    }
}

customElements.define('deer-event', DeerEventTemplate)
customElements.define('deer-children-list', DeerChildrenListTemplate)
customElements.define('deer-timeline', DeerTimelineTemplate)

export default class DeerRender {
    constructor(elem, deer = {}) {
        for (let key in DEER) {
            if (typeof DEER[key] === "string") {
                DEER[key] = deer[key] || config[key]
            } else {
                DEER[key] = Object.assign(config[key], deer[key])
            }
        }
        changeLoader.observe(elem, {
            attributes: true
        })
        this.$dirty = false
        this.id = elem.getAttribute(DEER.ID)?.replace(/https?:/,'https:')
        this.collection = elem.getAttribute(DEER.COLLECTION)
        this.elem = elem

        try {
            if (!(this.id || this.collection)) {
                let err = new Error(this.id + " is not a valid id.")
                err.code = "NO_ID"
                throw err
            } else {
                if (this.id) {
                    fetch(this.id).then(response => response.json()).then(obj => RENDER.element(this.elem, obj)).catch(err => err)
                } else if (this.collection) {
                    // Look not only for direct objects, but also collection annotations
                    // Only the most recent, do not consider history parent or children history nodes
                    let historyWildcard = { "$exists": true, "$size": 0 }
                    let queryObj = {
                        $or: [{
                            "targetCollection": this.collection
                        }, {
                            "body.targetCollection": this.collection
                        }],
                        "__rerum.history.next": historyWildcard
                    }
                    fetch(DEER.URLS.QUERY+'?limit=100', {
                        method: "POST",
                        mode: "cors",
                        headers: new Headers({
                            'Content-Type': 'application/json; charset=utf-8'
                        }),
                        body: JSON.stringify(queryObj)
                    }).then(response => response.json())
                        .then(pointers => {
                            let list = []
                            pointers.map(tc => {
                                let tid = tc.target || tc["@id"] || tc.id
                                tid = tid?.replace(/https?:/,'https:')
                                return list.push(fetch(tid)
                                .then(response => response.json())
                                .catch(err => {
                                    __deleted: console.log(err)
                                }))
                            })
                            return Promise.all(list).then(l => l.filter(i => !i.hasOwnProperty("__deleted")))
                        })
                        .then(list => {
                            let listObj = {
                                name: this.collection,
                                itemListElement: list
                            }
                            this.elem.setAttribute(DEER.LIST, "itemListElement")
                            try {
                                listObj["@type"] = list[0]["@type"] || list[0].type || "ItemList"
                            } catch (err) {
                            }
                            RENDER.element(this.elem, listObj)
                        })
                }
            }
        } catch (err) {
            let message = err
            switch (err.code) {
                case "NO_ID":
                    message = elem.innerHTML // No DEER.ID, so do not change
            }
            elem.innerHTML = message
        }

        let listensTo = elem.getAttribute(DEER.LISTENING)
        if (listensTo) {
            elem.addEventListener(DEER.EVENTS.CLICKED, e => {
                try {
                    if (e.detail.target.closest(DEER.VIEW + "," + DEER.FORM).getAttribute("id") === listensTo)
                        elem.setAttribute(DEER.ID, e.detail.target.closest('[' + DEER.ID + ']').getAttribute(DEER.ID))
                } catch (err) {
                }
            })
            try {
                window[listensTo].addEventListener("click", e => UTILS.broadcast(e, DEER.EVENTS.CLICKED, elem))
            } catch (err) {
                console.error("There is no HTML element with id " + listensTo + " to attach an event to")
            }
        }

    }
}

/**
 * Go over each listed <deer-view> marked HTMLElement and process the UI requirements to draw and render to the DOM.
 * These views will not contain annotation information.  
 * 
 * Note that the resolution of this promise enforses a 200ms delay.  That is for the deerInitializer.js.  It allows
 * initializeDeerViews to be treated as an asyncronous event before initializeDeerForms interacts with the DOM from
 * resulting rendered <deer-view> marked HTMLElements.  We plan to streamline this process in the near future.  
 * @param {type} config A DEER configuration from deer-config.js
 * @return {Promise} A promise confirming all views were visited and rendered.
 */
export function initializeDeerViews(config) {
    return new Promise((res) => {
        const views = document.querySelectorAll(config.VIEW)
        Array.from(views).forEach(elem => new DeerRender(elem, config))
        document.addEventListener(DEER.EVENTS.NEW_VIEW, e => Array.from(e.detail.set).forEach(elem => new DeerRender(elem, config)))
        /**
         * Really each render should be a promise and we should return a Promise.all() here of some kind.
         * That would only work if DeerRender resulted in a Promise where we could return Promise.all(renderPromises).
         */
        setTimeout(res, 200) //A small hack to ensure all the HTML generated by processing the views enters the DOM before this says it has resolved.
        //Failed 5 times at 100
        //Failed 0 times at 200
    })
}
