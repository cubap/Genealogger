import { getLabel } from '../utils/string-utils.js'

class DeerTypeaheadFilter extends HTMLElement {
    constructor() {
        super()
        this.items = []
        this.filteredItems = []
        this.targetList = null
        this.input = null
        this.isFiltering = false
    }

    connectedCallback() {
        this.render()
        this.setupEventListeners()
    }

    render() {
        this.innerHTML = `
            <div class="typeahead-filter">
                <input type="text" 
                       placeholder="Type to filter names..." 
                       class="typeahead-input material-input"
                       title="Filter list items">
                <div class="typeahead-results"></div>
            </div>
        `
        this.input = this.querySelector('.typeahead-input')
    }

    setupEventListeners() {
        // Listen for deer-list-rendered events
        document.addEventListener('deer-list-rendered', (event) => {
            const targetId = this.getAttribute('target')
            if (!targetId || event.detail.element.id === targetId) {
                this.handleListRendered(event.detail)
            }
        })

        // Handle input changes
        if (this.input) {
            this.input.addEventListener('input', (event) => {
                this.handleInput(event.target.value)
            })

            this.input.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    this.clearFilter()
                }
            })
        }
    }

    handleListRendered(detail) {
        this.items = detail.items || []
        this.targetList = detail.element
        this.filteredItems = [...this.items]
        
        // Show the filter input only when we have items
        if (this.items.length > 0) {
            this.style.display = 'block'
        } else {
            this.style.display = 'none'
        }
    }

    handleInput(query) {
        if (!query.trim()) {
            this.clearFilter()
            return
        }

        this.isFiltering = true
        const normalizedQuery = query.toLowerCase().trim()
        
        // Filter items based on their labels
        this.filteredItems = this.items.filter(item => {
            const label = getLabel(item).toLowerCase()
            return label.includes(normalizedQuery)
        })

        this.updateTargetList()
    }

    updateTargetList() {
        if (!this.targetList) return

        if (!this.isFiltering) {
            // Show all items
            this.showAllItems()
        } else {
            // Show only filtered items
            this.showFilteredItems()
        }
    }

    showAllItems() {
        const listItems = this.targetList.querySelectorAll('li')
        listItems.forEach(li => {
            li.style.display = ''
        })
    }

    showFilteredItems() {
        const listItems = this.targetList.querySelectorAll('li')
        const filteredIds = new Set(this.filteredItems.map(item => item['@id']))

        listItems.forEach(li => {
            const itemId = li.getAttribute('deer-id')
            if (filteredIds.has(itemId)) {
                li.style.display = ''
            } else {
                li.style.display = 'none'
            }
        })
    }

    clearFilter() {
        if (this.input) {
            this.input.value = ''
        }
        this.isFiltering = false
        this.filteredItems = [...this.items]
        this.updateTargetList()
    }

    // Public method to get current filter state
    getFilterState() {
        return {
            isFiltering: this.isFiltering,
            query: this.input?.value || '',
            totalItems: this.items.length,
            filteredItems: this.filteredItems.length
        }
    }
}

customElements.define('deer-typeahead-filter', DeerTypeaheadFilter)
export default DeerTypeaheadFilter
