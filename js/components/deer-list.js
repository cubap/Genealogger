import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue, getArrayFromObj } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerListTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID, config.COLLECTION]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>`
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        const collection = this.getAttribute('deer-collection')
        if (!Object.keys(obj).length && collection) {
            const historyWildcard = { "$exists": true, "$size": 0 }
            const queryObj = {
                $or: [
                    { "targetCollection": collection },
                    { "body.targetCollection": collection }
                ],
                "__rerum.history.next": historyWildcard
            }
            const pointers = await fetch(`${config.URLS.QUERY}?limit=100`, {
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

        const id = this.getAttribute(config.ID)
        if (id) {
            obj = await expand(id)
        }

        const { list: listKey = '', link = '' } = JSON.parse(this.getAttribute('data-options') ?? '{}')
        const itemList = obj.itemListElement ?? []

        if (!itemList.length) {
            this.innerHTML = `<span>No items to display</span>`
            // Dispatch event even when no items
            this.dispatchEvent(new CustomEvent('deer-list-rendered', {
                detail: { 
                    items: [],
                    element: this 
                },
                bubbles: true
            }))
            return
        }

        const options = JSON.parse(this.getAttribute('data-options') ?? '{}')
        // Use deer-link attribute if present, fallback to data-options
        let resolvedLink = this.getAttribute('deer-link')
        if (!resolvedLink) {
            resolvedLink = options.link || ''
        }
        let tmpl = `<h2>${getLabel(obj)}</h2><ul>`
        itemList.forEach((val, index) => {
            const name = getLabel(val, val.type ?? val['@type'] ?? index)
            tmpl += (val["@id"] ?? val.id) && resolvedLink
                ? `<li ${config.ID}="${val["@id"] ?? val.id}"><a href="${resolvedLink}${val["@id"] ?? val.id}">${name}</a></li>`
                : `<li ${config.ID}="${val["@id"] ?? val.id}">${name}</li>`
        })
        tmpl += `</ul>`
        this.innerHTML = tmpl

        this.checkForUpdatedLabels(itemList)
        
        // Dispatch custom event when list is rendered
        this.dispatchEvent(new CustomEvent('deer-list-rendered', {
            detail: { 
                items: itemList,
                element: this 
            },
            bubbles: true
        }))
    }

    checkForUpdatedLabels(items) {
        // gather all the deer-ids from the list items
        const ids = items.map(item => item['@id'] || item.id).filter(id => id)
        if (ids.length === 0) return
        // query for Annotations that target these ids and have body with nick updates
        const queryObj = {
            "target": { "$in": ids },
            "body.nick": { "$exists": true }
        }
        fetch(`${config.URLS.QUERY}?limit=100`, {
            method: "POST",
            mode: "cors",
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(queryObj)
        }).then(res => res.json()).then(data => {
            // match the annotations to the list items and update the labels
            const nickMap = {}
            data.forEach(annotation => {
                const targetId = getValue(annotation.target)
                if (targetId && ids.includes(targetId)) {
                    nickMap[targetId] = annotation.body.nick
                }
            })
            items.forEach(item => {
                const itemId = item['@id'] || item.id
                if (nickMap[itemId]) {
                    item.label = nickMap[itemId]
                }
            })
            // replace the text nodes with updated labels
            const listElements = this.querySelectorAll('li')
            listElements.forEach(li => {
                const liId = li.getAttribute(config.ID)
                if (nickMap[liId]) {
                    const link = li.querySelector('a')
                    if (link) {
                        link.textContent = getValue(nickMap[liId])
                    }
                }
            })
        }).catch(() => {})
    }
}

customElements.define('deer-list', DeerListTemplate)
export default DeerListTemplate
