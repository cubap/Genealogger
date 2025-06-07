import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerTreeTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>`
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === config.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(config.ID)
            if (id) {
                obj = await expand(id)
            }
        }

        const params = new URLSearchParams(location.search)
        const showall = params.get("showall")
        if (showall) {
            config.showall = true
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
                        <deer-label deer-template="personDates" deer-id="${obj['@id']}">${getLabel(obj)}</deer-label>
                    </a>
                    <div class="parents">
                        ${obj.hasFather
                    ? `<deer-tree ${config.showall ? `deer-id` : `data-uri`}="${getValue(obj.hasFather)}">loading father...</deer-tree>`
                    : `<div class="void-parent">[ <a href="parents.html?#${obj['@id']}">add father</a> ]</div>`}
                        ${obj.hasMother
                    ? `<deer-tree ${config.showall ? `deer-id` : `data-uri`}="${getValue(obj.hasMother)}">loading mother...</deer-tree>`
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

customElements.define('deer-tree', DeerTreeTemplate)
export default DeerTreeTemplate
