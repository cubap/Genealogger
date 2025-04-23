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
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'

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
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const indent = options.indent || 4
        const replacer = (k, v) => (DEER.SUPPRESS.includes(k) ? null : v)
        try {
            this.innerHTML = `<pre>${JSON.stringify(obj, replacer, indent)}</pre>`
        } catch (err) {
            this.innerHTML = `<span>Error rendering JSON</span>`
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
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const key = options.key || "@id"
        const prop = obj[key] || "[ undefined ]"
        const label = options.label || UTILS.getLabel(obj, prop)
        try {
            this.innerHTML = `<span class="${prop}">${label}: ${UTILS.getValue(prop) || "[ undefined ]"}</span>`
        } catch (err) {
            this.innerHTML = `<span>Error loading data</span>`
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
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const key = options.key || "@id"
        const prop = obj[key] || "[ undefined ]"
        const label = UTILS.getLabel(obj, prop)
        try {
            this.innerHTML = options.link
                ? `<a href="${options.link + obj['@id']}">${label}</a>`
                : `${label}`
        } catch (err) {
            this.innerHTML = `<span>Error loading data</span>`
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
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<div>Loading...</div>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }
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
    link = this.getAttribute(DEER.LINK) ?? ''
    static get observedAttributes() {
        return ['data-obj', DEER.COLLECTION]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if ((name === 'data-obj' || name === DEER.COLLECTION) && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') ?? '{}')
        const collection = this.getAttribute(DEER.COLLECTION)

        if (!Object.keys(obj).length && collection) {
            const historyWildcard = { "$exists": true, "$size": 0 }
            const queryObj = {
                $or: [
                    { "targetCollection": collection },
                    { "body.targetCollection": collection }
                ],
                "__rerum.history.next": historyWildcard
            }

            const pointers = await fetch(`${DEER.URLS.QUERY}?limit=100`, {
                method: "POST",
                mode: "cors",
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(queryObj)
            }).then(res => res.json()).catch(() => [])

            const list = await Promise.all(
                pointers.map(({ target, "@id": id, id: fallbackId }) => {
                    const tid = (target || id || fallbackId)?.replace(/https?:/, 'https:')
                    return fetch(tid).then(res => res.json()).catch(() => ({ __deleted: true }))
                })
            ).then(results => results.filter(item => !item.__deleted))

            if (!list.length) {
                this.innerHTML = `<span>No items found in the collection</span>`
                return
            }

            obj = {
                name: collection,
                itemListElement: list,
                "@type": list[0]?.["@type"] ?? list[0]?.type ?? "ItemList"
            }
        }

        const { list: listKey = '', link = '' } = JSON.parse(this.getAttribute('data-options') ?? '{}')
        const itemList = obj.itemListElement ?? []

        if (!itemList.length) {
            this.innerHTML = `<span>No items to display</span>`
            return
        }

        let tmpl = `<h2>${UTILS.getLabel(obj)}</h2><ul>`
        itemList.forEach((val, index) => {
            const name = UTILS.getLabel(val, val.type ?? val['@type'] ?? index)
            tmpl += val["@id"] && this.link
                ? `<li ${DEER.ID}="${val["@id"]}"><a href="${this.link}${val["@id"]}">${name}</a></li>`
                : `<li ${DEER.ID}="${val["@id"]}">${name}</li>`
        })
        tmpl += `</ul>`

        this.innerHTML = tmpl
    }
}

class DeerPersonTemplate extends HTMLElement {
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') ?? '{}')
        if (!Object.keys(obj).length) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }

        const { key: birthKey = "birthDate", label: birthLabel = "Birth Date" } = {}
        const { key: deathKey = "deathDate", label: deathLabel = "Death Date" } = {}
        const dob = `<deer-prop-template data-obj='${JSON.stringify(obj)}' data-options='{"key": "${birthKey}", "label": "${birthLabel}"}'></deer-prop-template>`
        const dod = `<deer-prop-template data-obj='${JSON.stringify(obj)}' data-options='{"key": "${deathKey}", "label": "${deathLabel}"}'></deer-prop-template>`

        const famName = obj.familyName ? UTILS.getValue(obj.familyName) : "[ unknown ]"
        const givenName = obj.givenName ? UTILS.getValue(obj.givenName) : ""
        let tmpl = `<h2>${UTILS.getLabel(obj)}</h2>`
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
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }
        try {
            this.innerHTML = `<h1>${UTILS.getLabel(obj)}</h1>`
        } catch (err) {
            this.innerHTML = `<span>Error loading event</span>`
        }
    }
}

class DeerChildrenListTemplate extends HTMLElement {
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Seeking children...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }

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

        const kIDs = await getChildren()
        this.innerHTML = kIDs.length
            ? `<ul>Offspring
                ${kIDs.reduce((b, a) => b += `<li><deer-view deer-id="${a}" deer-template="label" deer-link="#" title="Click to view"></deer-view></li>`, ``)}
               </ul>`
            : `[ no child records ]`

        setTimeout(() => UTILS.broadcast(undefined, DEER.EVENTS.NEW_VIEW, this, { set: this.querySelectorAll("[deer-template]") }), 0)
    }
}

class DeerTimelineTemplate extends HTMLElement {
    static get observedAttributes() {
        return [DEER.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading timeline...</span>` // Placeholder HTML
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }

        let tmpl = `<ul>`
        for (const item of obj.itemListElement || []) {
            tmpl += `<li><deer-view deer-template="personDates" deer-id="${item['@id']}"></deer-view></li>`
        }
        tmpl += `</ul>`

        this.innerHTML = tmpl
    }
}

class DeerTreeTemplate extends HTMLElement {
    static get observedAttributes() {
        return [DEER.ID]
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === DEER.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (!Object.keys(obj).length) {
            const id = this.getAttribute(DEER.ID)
            if (id) {
                obj = await fetch(id).then(res => res.json()).catch(() => ({}))
            }
            obj = await UTILS.expand(obj)
        }

        const params = new URLSearchParams(location.search)
        const showall = params.get("showall")
        if (showall) {
            DEER.showall = true
        }

        try {
            const tmpl = `
                <style>
                    .tree-detail {
                        display: flex;
                        align-items: center;
                        padding: 0 0 0 1.5rem;
                        background: linear-gradient(90deg, rgba(0, 0, 0, .1), transparent);
                        white-space: nowrap;
                        overflow: visible;
                        margin-bottom: 1rem;
                    }
                    .tree-detail a {
                        display: inline-block;
                        min-width: 10em;
                    }
                    .parents {
                        flex-direction: column;
                    }
                    .tree-detail > deer-tree {
                        min-width: 10rem;
                        text-align: center;
                    }
                    .parents > deer-tree[data-uri]:not([deer-id]) {
                        border: outset medium;
                        margin: .2rem;
                        font-size: .68rem;
                        cursor: pointer;
                    }
                </style>
                <div class="tree-detail">
                    <a href="#${obj["@id"]}" title="Click to View">
                        <deer-view deer-template="personDates" deer-id="${obj['@id']}">${UTILS.getLabel(obj)}</deer-view>
                    </a>
                    <div class="parents">
                        ${obj.hasFather
                    ? `<deer-tree ${DEER.showall ? `deer-id` : `data-uri`}="${UTILS.getValue(obj.hasFather)}">loading father...</deer-tree>`
                    : `<div class="void-parent">[ <a href="parents.html?#${obj['@id']}">add father</a> ]</div>`}
                        ${obj.hasMother
                    ? `<deer-tree ${DEER.showall ? `deer-id` : `data-uri`}="${UTILS.getValue(obj.hasMother)}">loading mother...</deer-tree>`
                    : `<div class="void-parent">[ <a href="parents.html?#${obj['@id']}">add mother</a> ]</div>`}
                    </div>
                </div>
            `
            this.innerHTML = tmpl

            Array.from(this.querySelectorAll(".parents > [data-uri]")).forEach(node => {
                node.onclick = ev => ev.target.setAttribute("deer-id", ev.target.getAttribute("data-uri"))
            })
        } catch (err) {
            this.innerHTML = `<span>Error loading tree</span>`
        }
    }
}

class DeerSvgTree extends HTMLElement {
    static get observedAttributes() {
        return ['deer-id']
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'deer-id' && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        const id = this.getAttribute('deer-id')
        if (!id) {
            this.innerHTML = `<span>Error: Missing deer-id</span>`
            return
        }

        let obj = await fetch(id).then(res => res.json()).catch(() => ({}))
        obj = await UTILS.expand(obj)

        const data = await this.transformData(obj)
        if (!data) {
            this.innerHTML = `<span>Error: Unable to load tree data</span>`
            return
        }

        this.innerHTML = '' // Clear any existing content
        const svg = d3.select(this).append('svg')
            .attr('width', 800)
            .attr('height', 600)
            .attr('viewBox', [-400, -300, 800, 600])
            .style('cursor', 'grab')

        const g = svg.append('g')

        const root = d3.hierarchy(data)
        const treeLayout = d3.tree().nodeSize([150, 50]) // Adjust for vertical layout
        treeLayout(root)

        // Links
        g.selectAll('.link')
            .data(root.links())
            .join('line')
            .attr('class', 'link')
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y)
            .attr('stroke', '#555')
            .attr('stroke-width', 1.5)

        // Nodes
        const nodes = g.selectAll('.node')
            .data(root.descendants())
            .join('g')
            .attr('class', 'node')
            .attr('transform', d => `translate(${d.x},${d.y})`)
            .call(d3.drag()
                .on('start', (event) => {
                    svg.style('cursor', 'grabbing')
                    event.subject.fx = event.subject.x
                    event.subject.fy = event.subject.y
                })
                .on('end', () => {
                    svg.style('cursor', 'grab')
                })
            )

        nodes.each(function (d) {
            d.data.name
                ? d3.select(this)
                    .append('rect') // Append rectangle for the node
                    .attr('width', 100)
                    .attr('height', 30)
                    .attr('x', -50)
                    .attr('y', -15)
                    .attr('fill', '#999')
                    .attr('stroke', '#555')
                    .attr('stroke-width', 2) &&
                d3.select(this)
                    .append('text') // Append text for nodes with names
                    .attr('text-anchor', 'middle')
                    .attr('alignment-baseline', 'middle')
                    .text(d.data.name)
                    .style('font-size', '12px')
                    .style('font-family', 'Arial, sans-serif')
                    .style('fill', '#fff')
                : d3.select(this)
                    .append('foreignObject') // Append foreignObject for nodes without names
                    .attr('width', 200)
                    .attr('height', 50)
                    .attr('x', -100)
                    .attr('y', -15)
                    .append('xhtml:div')
                    .attr('class', 'void-parent')
                    .html(d => {
                        let buttons = ''
                        if (!d.data.hasFather) {
                            buttons += `[ <a href="parents.html?#${d.data.id}">add father</a> ] `
                        }
                        if (!d.data.hasMother) {
                            buttons += `[ <a href="parents.html?#${d.data.id}">add mother</a> ]`
                        }
                        return buttons
                    })
        })

        // Add zoom and pan functionality
        svg.call(d3.zoom()
            .scaleExtent([0.5, 2])
            .on('zoom', (event) => {
                g.attr('transform', event.transform)
            }))
    }

    async transformData(obj) {
        if (!obj || !obj['@id']) return null

        const buildTree = async (node) => {
            if (!node) return null
            const name = UTILS.getLabel(node)
            const ancestors = []
            const addAncestor = async (relation, label) => {
                ancestors.push(node[relation]
                    ? await buildTree(await UTILS.expand(node[relation]?.value).catch(() => null))
                    : { id: node['@id'], [relation]: false })
            }

            await addAncestor('hasFather', 'Father')
            await addAncestor('hasMother', 'Mother')

            return { name, children: ancestors, id: node['@id'], hasFather: node.hasFather, hasMother: node.hasMother }
        }
        return await buildTree(obj)
    }
}

customElements.define('deer-event', DeerEventTemplate)
customElements.define('deer-children-list', DeerChildrenListTemplate)
customElements.define('deer-timeline', DeerTimelineTemplate)
customElements.define('deer-tree', DeerTreeTemplate)
customElements.define('deer-svg-tree', DeerSvgTree)

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
                            } catch (err) {
                            }
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
