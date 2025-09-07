import { expand, getValue } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'

class DeerNicknameEditor extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    constructor() {
        super()
        this.person = {}
        this.isEditing = false
    }

    async connectedCallback() {
        this.innerHTML = `<div>Loading...</div>`
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === config.ID && oldValue !== newValue) {
            await this.loadPerson()
            this.render()
        }
    }

    async loadPerson() {
        const id = this.getAttribute(config.ID)
        if (id) {
            this.person = await expand(id)
        }
    }

    render() {
        const nickname = getValue(this.person.nick) || getValue(this.person.nickname) || ''
        const personName = getValue(this.person.name) || 'Unknown'
        const personId = this.getAttribute(config.ID)
        
        if (this.isEditing) {
            this.innerHTML = `
                <div class="nickname-editor editing">
                    <form deer-type="nick" deer-motivation="editing" deer-creator="genealogger-user" deer-id="${personId}">
                        <label class="nickname-field-label">
                            <span>Nickname for ${personName}:</span>
                            <input type="text" 
                                   deer-key="nick"
                                   class="nickname-input material-input" 
                                   value="${nickname}" 
                                   placeholder="Enter nickname..."
                                   title="Person's nickname">
                        </label>
                        <div class="nickname-actions">
                            <input type="submit" value="Save" class="save-btn material-btn">
                            <button type="button" class="cancel-btn material-btn-secondary">Cancel</button>
                        </div>
                    </form>
                </div>
            `
        } else {
            this.innerHTML = `
                <div class="nickname-editor">
                    <div class="nickname-display">
                        <span class="nickname-label">Nickname:</span>
                        <span class="nickname-value">${nickname || 'None set'}</span>
                        <button type="button" class="edit-btn material-btn-small" title="Edit nickname">
                            <span class="edit-icon">✏️</span>
                        </button>
                    </div>
                </div>
            `
        }

        this.setupEventListeners()
    }

    setupEventListeners() {
        const editBtn = this.querySelector('.edit-btn')
        const cancelBtn = this.querySelector('.cancel-btn')
        const form = this.querySelector('form')
        const input = this.querySelector('.nickname-input')

        if (editBtn) {
            editBtn.addEventListener('click', () => this.startEditing())
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelEditing())
        }

        // Only set up form handling if we're in edit mode
        if (form && this.isEditing) {
            // Listen for successful data update
            const personId = this.getAttribute(config.ID)
            const updateHandler = (event) => {
                if (event.detail?.target === personId || event.detail?.['@id'] === personId) {
                    document.removeEventListener(config.EVENTS.UPDATED, updateHandler)
                    this.handleSuccessfulSave()
                }
            }
            document.addEventListener(config.EVENTS.UPDATED, updateHandler)
            
            // Announce new form to DEER when user starts typing or focuses input
            let formAnnounced = false
            const announceForm = () => {
                if (!formAnnounced) {
                    formAnnounced = true
                    const event = new CustomEvent(config.EVENTS.NEW_FORM, {
                        detail: { set: [form] }
                    })
                    document.dispatchEvent(event)
                }
            }
            
            // Set up dirty tracking for the input
            if (input) {
                input.addEventListener('input', (e) => {
                    e.target.$isDirty = true
                    announceForm() // Announce form when user starts typing
                })
                input.addEventListener('focus', announceForm, { once: true })
            }
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.cancelEditing()
                }
            })
            // Focus the input when editing starts
            input.focus()
            input.select()
        }
    }

    startEditing() {
        this.isEditing = true
        this.render()
    }

    cancelEditing() {
        this.isEditing = false
        this.render()
    }

    handleSuccessfulSave() {
        // Add a small delay to ensure the form has actually been processed
        setTimeout(() => {
            this.isEditing = false
            // Reload the person data to get the updated nickname
            this.loadPerson().then(() => {
                this.render()
                this.showFeedback('Nickname saved successfully!', 'success')
            })
            
            // Clear cache so other components refresh - the DEER event handling will take care of this
            const personId = this.getAttribute(config.ID)
            if (personId) {
                localStorage.removeItem(personId)
            }
        }, 100)
    }

    showFeedback(message, type = 'info') {
        // Create temporary feedback element
        const feedback = document.createElement('div')
        feedback.className = `nickname-feedback ${type}`
        feedback.textContent = message
        feedback.style.cssText = `
            position: absolute;
            top: -30px;
            left: 0;
            background: ${type === 'success' ? '#4caf50' : '#f44336'};
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `
        
        this.style.position = 'relative'
        this.appendChild(feedback)
        
        // Animate in
        setTimeout(() => feedback.style.opacity = '1', 10)
        
        // Remove after 3 seconds
        setTimeout(() => {
            feedback.style.opacity = '0'
            setTimeout(() => feedback.remove(), 300)
        }, 3000)
    }

    // Public method to get current nickname
    getNickname() {
        return getValue(this.person["foaf:nick"]) || getValue(this.person.nickname) || ''
    }
}

customElements.define('deer-nickname-editor', DeerNicknameEditor)
export default DeerNicknameEditor
