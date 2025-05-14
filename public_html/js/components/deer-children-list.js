import { expand, httpsQueryArray } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue, getArrayFromObj } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerChildrenListTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Seeking children...</span>`
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

        const getChildren = async () => {
            const query = {
                $or: [
                    { "body.hasFather.value": httpsQueryArray(obj["@id"]) },
                    { "body.hasMother.value": httpsQueryArray(obj["@id"]) }
                ],
                "__rerum.history.next": { "$exists": true, "$size": 0 }
            }

            const annos = await fetch("https://tinydev.rerum.io/query", {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
            }).then(res => res.json()).catch(() => [])

            // Use the target property directly, since it's a string
            return annos.map(a => a.target).filter(Boolean)
        }

        const kIDs = await getChildren()
        this.innerHTML = ''
        if (kIDs.length) {
            const ul = document.createElement('ul')
            ul.textContent = 'Offspring'
            kIDs.forEach(id => {
                const li = document.createElement('li')
                const deerLabel = document.createElement('deer-label')
                deerLabel.setAttribute('deer-id', id)
                deerLabel.setAttribute('deer-template', 'label')
                deerLabel.setAttribute('title', 'Click to view')
                deerLabel.setAttribute('data-options', JSON.stringify({ link: '#' }))
                li.appendChild(deerLabel)
                ul.appendChild(li)
            })
            this.appendChild(ul)
        } else {
            this.textContent = '[ no child records ]'
        }
    }
}

customElements.define('deer-children-list', DeerChildrenListTemplate)
export default DeerChildrenListTemplate
