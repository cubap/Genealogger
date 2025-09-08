import { expand, httpsQueryArray } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue, getArrayFromObj } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'
import './person-chip.js'

class DeerChildrenListTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Seeking children...</span>`
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name !== config.ID || oldValue === newValue) return
        await this.render()
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (!Object.keys(obj).length) {
            const id = this.getAttribute(config.ID)
            if (!id) {
                this.textContent = '[ no child records ]'
                return
            }
            obj = await expand(id)
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
            return annos.map(a => a.target).filter(Boolean)
        }

        const kIDs = await getChildren()
        this.innerHTML = ''
        if (!kIDs.length) {
            this.textContent = '[ no child records ]'
            return
        }

        const container = document.createElement('div')
        container.className = 'children-chips'
        for (const id of kIDs) {
            const childObj = await expand(id)
            const chip = document.createElement('person-chip')
            chip.setAttribute('label', getLabel(childObj) || childObj.name || 'Unknown')
            if (childObj.birthDate) chip.setAttribute('birth', childObj.birthDate)
            if (childObj.deathDate) chip.setAttribute('death', childObj.deathDate)
            if (childObj.gender) chip.setAttribute('gender', childObj.gender)
            if (childObj.maritalStatus) chip.setAttribute('marital', childObj.maritalStatus)
            chip.setAttribute('deer-id', id)
            container.appendChild(chip)
        }
        this.appendChild(container)
    }
}

customElements.define('deer-children-list', DeerChildrenListTemplate)
export default DeerChildrenListTemplate
