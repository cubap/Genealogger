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
        const showall = true || params.get("showall") // always show all details
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
                    .tree-detail > a {
                        display: inline-block;
                        min-width: 10em;
                        background: linear-gradient(135deg, #1976d2, #42a5f5);
                        color: white !important;
                        padding: 0.8rem 1.2rem;
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(25, 118, 210, 0.3);
                        text-decoration: none;
                        font-weight: 500;
                        border: 2px solid #fff;
                        transition: all 0.2s ease;
                    }
                    .tree-detail > a:hover {
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(25, 118, 210, 0.4);
                        background: linear-gradient(135deg, #0d47a1, #1976d2);
                    }
                    .parents {
                        flex-direction: column;
                    }
                    .tree-detail > deer-tree {
                        min-width: 10rem;
                        text-align: center;
                    }
                    .parents > deer-tree {
                        background: linear-gradient(135deg, #f5f5f5, #e0e0e0);
                        margin: .2rem;
                        font-size: .68rem;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        box-shadow: 0 1px 4px rgba(0,0,0,0.1);
                    }
                    .parents > deer-tree:hover {
                        background: linear-gradient(135deg, #e3f2fd, #bbdefb);
                        border-color: #90caf9;
                        transform: translateY(-1px);
                        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    }
                    .parents > deer-tree[data-uri]:not([deer-id]) {
                        border-style: solid;
                        cursor: pointer;
                    }
                    .parents > deer-tree[data-uri]:not([deer-id])::after {
                        content: ' 🔍';
                        opacity: 0.7;
                        font-size: 0.8em;
                    }
                    .parents > deer-tree[data-uri]:not([deer-id]):hover::after {
                        opacity: 1;
                    }
                    .void-parent {
                        background: #f9f9f9;
                        border: 2px dashed #ccc;
                        border-radius: 6px;
                        padding: 0.6rem 0.8rem;
                        margin: .2rem;
                        text-align: center;
                        color: #666;
                        font-style: italic;
                        font-size: .68rem;
                        transition: all 0.2s ease;
                        min-width: 10rem;
                        box-sizing: border-box;
                    }
                    .void-parent:hover {
                        background: #f0f7ff;
                        border-color: #1976d2;
                        color: #1976d2;
                    }
                    .void-parent a {
                        color: #1976d2;
                        text-decoration: none;
                        font-weight: 500;
                    }
                    .void-parent a:hover {
                        text-decoration: underline;
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
                node.onclick = ev => ev.target.closest("deer-tree").setAttribute(config.ID, ev.target.closest("deer-tree").getAttribute("data-uri"))
            })
        } catch (err) {
            this.innerHTML = `<span>Error loading tree</span>`
        }
    }
}

customElements.define('deer-tree', DeerTreeTemplate)
export default DeerTreeTemplate
