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

import { default as config } from './deer-config.js'
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'
import DeerJsonTemplate from './components/deer-json.js'
import DeerPropTemplate from './components/deer-prop.js'
import DeerLabelTemplate from './components/deer-label.js'
import DeerEntityTemplate from './components/deer-entity.js'
import DeerListTemplate from './components/deer-list.js'
import DeerPersonTemplate from './components/deer-person.js'
import DeerEventTemplate from './components/deer-event.js'
import DeerChildrenListTemplate from './components/deer-children-list.js'
import DeerTimelineTemplate from './components/deer-timeline.js'
import DeerTreeTemplate from './components/deer-tree.js'
import DeerSvgTree from './components/deer-svg-tree.js'
import { getValue, getArrayFromObj, cleanArray, httpsIdLinks, httpsQueryArray, expand } from './utils/data-utils.js'
import { assertElementValue, broadcast, warning } from './utils/dom-utils.js'
import { stringifyArray, getLabel } from './utils/string-utils.js'

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
                } catch (err) {}
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
    return expand(obj).then(obj => {
        // Only use custom elements for rendering, legacy template logic removed
        // Determine which custom element to use based on element attributes
        let customTag = elem.tagName.toLowerCase()
        let customElem
        switch (customTag) {
            case 'deer-json':
                customElem = document.createElement('deer-json')
                break
            case 'deer-prop':
                customElem = document.createElement('deer-prop')
                break
            case 'deer-label':
                customElem = document.createElement('deer-label')
                break
            case 'deer-entity':
                customElem = document.createElement('deer-entity')
                break
            case 'deer-list':
                customElem = document.createElement('deer-list')
                break
            case 'deer-person':
                customElem = document.createElement('deer-person')
                break
            case 'deer-event':
                customElem = document.createElement('deer-event')
                break
            case 'deer-children-list':
                customElem = document.createElement('deer-children-list')
                break
            case 'deer-timeline':
                customElem = document.createElement('deer-timeline')
                break
            case 'deer-tree':
                customElem = document.createElement('deer-tree')
                break
            case 'deer-svg-tree':
                customElem = document.createElement('deer-svg-tree')
                break
            default:
                customElem = document.createElement('deer-json')
        }
        customElem.setAttribute('data-obj', JSON.stringify(obj))
        Array.from(elem.attributes).forEach(attr => customElem.setAttribute(attr.name, attr.value))
        elem.replaceWith(customElem)
        setTimeout(() => {
            let newViews = (customElem.querySelectorAll(config.VIEW).length) ? customElem.querySelectorAll(config.VIEW) : []
            let newForms = (customElem.querySelectorAll(config.FORM).length) ? customElem.querySelectorAll(config.VIEW) : []
            if (newForms.length) {
                broadcast(undefined, DEER.EVENTS.NEW_FORM, customElem, { set: newForms })
            }
            if (newViews.length) {
                broadcast(undefined, DEER.EVENTS.NEW_VIEW, customElem, { set: newViews })
            }
            broadcast(undefined, DEER.EVENTS.VIEW_RENDERED, customElem, obj)
        }, 0)
        broadcast(undefined, DEER.EVENTS.LOADED, customElem, obj)
    })
}

/**
 * Removed all redundant class definitions for DeerJsonTemplate, DeerPropTemplate, DeerLabelTemplate, DeerEntityTemplate, DeerListTemplate, DeerPersonTemplate, DeerEventTemplate, DeerChildrenListTemplate, DeerTimelineTemplate, DeerTreeTemplate, and DeerSvgTree. These are now imported from js/components/.
 */

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
        this.id = elem.getAttribute(DEER.ID)?.replace(/https?:/, 'https:')
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
                    fetch(DEER.URLS.QUERY + '?limit=100', {
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
                                tid = tid?.replace(/https?:/, 'https:')
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
                            } catch (err) {}
                            const deerList = document.createElement('deer-list')
                            deerList.setAttribute('data-obj', JSON.stringify(listObj))
                            deerList.setAttribute('data-options', JSON.stringify({ list: this.elem.getAttribute(DEER.LIST), link: this.elem.getAttribute(DEER.LINK) }))
                            Array.from(this.elem.attributes).forEach(attr => deerList.setAttribute(attr.name, attr.value))
                            this.elem.replaceWith(deerList)
                            this.elem = deerList
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
                } catch (err) {}
            })
            try {
                window[listensTo].addEventListener("click", e => broadcast(e, DEER.EVENTS.CLICKED, elem))
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
