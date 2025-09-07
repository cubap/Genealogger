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
                    .tree-container {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 1rem;
                        background: #fff;
                        border-radius: 12px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                        margin: 1rem;
                        position: relative;
                    }
                    
                    .tree-person {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        position: relative;
                        z-index: 2;
                    }
                    
                    .person-card {
                        background: linear-gradient(135deg, #1976d2, #42a5f5);
                        color: white;
                        padding: 1rem 1.5rem;
                        border-radius: 12px;
                        box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
                        text-align: center;
                        min-width: 200px;
                        position: relative;
                        z-index: 3;
                        border: 3px solid #fff;
                        margin-bottom: 2rem;
                    }
                    
                    .person-card a {
                        color: white;
                        text-decoration: none;
                        font-weight: 600;
                        font-size: 1.1rem;
                        display: block;
                    }
                    
                    .person-card:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 6px 20px rgba(25, 118, 210, 0.4);
                        transition: all 0.3s ease;
                    }
                    
                    .parents-container {
                        display: flex;
                        justify-content: space-around;
                        align-items: flex-start;
                        width: 100%;
                        max-width: 600px;
                        position: relative;
                        gap: 2rem;
                    }
                    
                    .parent-branch {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        flex: 1;
                        position: relative;
                    }
                    
                    /* Connection lines */
                    .tree-person::before {
                        content: '';
                        position: absolute;
                        top: -2rem;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 2px;
                        height: 2rem;
                        background: #ccc;
                        z-index: 1;
                    }
                    
                    .parents-container::before {
                        content: '';
                        position: absolute;
                        top: -2rem;
                        left: 25%;
                        right: 25%;
                        height: 2px;
                        background: #ccc;
                        z-index: 1;
                    }
                    
                    .parent-branch::after {
                        content: '';
                        position: absolute;
                        top: -2rem;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 2px;
                        height: 2rem;
                        background: #ccc;
                        z-index: 1;
                    }
                    
                    .parent-card {
                        background: linear-gradient(135deg, #f5f5f5, #e0e0e0);
                        color: #333;
                        padding: 0.8rem 1.2rem;
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                        text-align: center;
                        min-width: 160px;
                        border: 2px solid #ddd;
                        position: relative;
                        z-index: 2;
                    }
                    
                    .parent-card.father {
                        background: linear-gradient(135deg, #e3f2fd, #bbdefb);
                        border-color: #90caf9;
                    }
                    
                    .parent-card.mother {
                        background: linear-gradient(135deg, #fce4ec, #f8bbd9);
                        border-color: #f48fb1;
                    }
                    
                    .parent-card a {
                        color: #333;
                        text-decoration: none;
                        font-weight: 500;
                        font-size: 0.95rem;
                        display: block;
                    }
                    
                    .parent-card:hover {
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                        transition: all 0.2s ease;
                    }
                    
                    .void-parent {
                        background: #f9f9f9;
                        border: 2px dashed #ccc;
                        padding: 0.8rem 1.2rem;
                        border-radius: 8px;
                        text-align: center;
                        min-width: 160px;
                        color: #666;
                        font-style: italic;
                        position: relative;
                        z-index: 2;
                    }
                    
                    .void-parent a {
                        color: #1976d2;
                        text-decoration: none;
                        font-weight: 500;
                    }
                    
                    .void-parent:hover {
                        background: #f0f7ff;
                        border-color: #1976d2;
                        transition: all 0.2s ease;
                    }
                    
                    /* Nested tree styling */
                    deer-tree deer-tree .tree-container {
                        margin: 0.5rem;
                        padding: 0.5rem;
                        background: #fafafa;
                        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
                    }
                    
                    deer-tree deer-tree .person-card {
                        min-width: 140px;
                        padding: 0.6rem 1rem;
                        font-size: 0.9rem;
                    }
                    
                    deer-tree deer-tree .parent-card {
                        min-width: 120px;
                        padding: 0.5rem 0.8rem;
                        font-size: 0.8rem;
                    }
                    
                    /* Click to expand styling */
                    .expandable {
                        cursor: pointer;
                        transition: all 0.2s ease;
                    }
                    
                    .expandable::after {
                        content: ' 🔍';
                        font-size: 0.8rem;
                        opacity: 0.7;
                    }
                    
                    .expandable:hover::after {
                        opacity: 1;
                    }
                    
                    /* Responsive adjustments */
                    @media (max-width: 600px) {
                        .parents-container {
                            flex-direction: column;
                            gap: 1rem;
                            align-items: center;
                        }
                        
                        .parents-container::before {
                            display: none;
                        }
                        
                        .parent-branch::after {
                            display: none;
                        }
                        
                        .tree-person::before {
                            display: none;
                        }
                        
                        .person-card, .parent-card {
                            min-width: 180px;
                        }
                    }
                </style>
                <div class="tree-container">
                    <div class="tree-person">
                        <div class="person-card">
                            <a href="#${obj["@id"]}" title="Click to View">
                                <deer-label deer-template="personDates" deer-id="${obj['@id']}">${getLabel(obj)}</deer-label>
                            </a>
                        </div>
                    </div>
                    <div class="parents-container">
                        <div class="parent-branch">
                            ${obj.hasFather
                    ? `<deer-tree class="expandable" ${config.showall ? `deer-id` : `data-uri`}="${getValue(obj.hasFather)}">
                                           <div class="parent-card father">loading father...</div>
                                       </deer-tree>`
                    : `<div class="void-parent">[ <a href="parents.html?#${obj['@id']}">add father</a> ]</div>`}
                        </div>
                        <div class="parent-branch">
                            ${obj.hasMother
                    ? `<deer-tree class="expandable" ${config.showall ? `deer-id` : `data-uri`}="${getValue(obj.hasMother)}">
                                           <div class="parent-card mother">loading mother...</div>
                                       </deer-tree>`
                    : `<div class="void-parent">[ <a href="parents.html?#${obj['@id']}">add mother</a> ]</div>`}
                        </div>
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
