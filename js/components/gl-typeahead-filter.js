/**
 * @module components/gl-typeahead-filter
 * @description `gl-typeahead-filter` is the search box above a person list
 * (issue #14 story 11). It replaces `deer-typeahead-filter`, whose "model" was
 * string-matching `data-searchable` attributes and poking `display:none` into
 * ANOTHER component's `<li>` elements. This one owns only the input: it
 * debounces typing and announces the query. The PAGE decides what a query means
 * by handing it to `model/search.js` (`listPersons({ query })`) and re-rendering.
 * No reach-in, no `deer-*` attribute magic, no fetch.
 *
 * Light DOM on purpose, like `gl-birth-form`: `css/site.css` already styles
 * `.typeahead-filter` / `.typeahead-input`, and a picker embedding this control
 * needs those styles to match the rest of the site.
 *
 * Attributes
 *   placeholder  input placeholder (default 'Filter...')
 *   debounce     ms to wait after typing stops before announcing (default 150)
 * Properties
 *   value        the current query text (setting it does NOT announce)
 * Methods
 *   clear()      empty the input and announce ''
 * Events (bubbles)
 *   gl-filter-change  detail: { query }
 */

export const DEFAULT_DEBOUNCE_MS = 150

/**
 * Should the current input be announced now? Pure, so the rule (announce on
 * empty/Enter/Escape, otherwise wait out the debounce) is testable without a DOM.
 * @param {string} query current input text
 * @returns {boolean} true when the announcement must not wait
 */
export function announcesImmediately(query) {
    return String(query ?? '').trim() === ''
}

export class GLTypeaheadFilter extends HTMLElement {
    static get observedAttributes() {
        return ['placeholder']
    }

    connectedCallback() {
        if (this._input) return
        this.innerHTML = `
            <div class="typeahead-filter">
                <input type="text" class="typeahead-input material-input"
                    aria-label="Filter people" title="Filter the list by name"
                    placeholder="${escapeHtml(this.getAttribute('placeholder') || 'Filter...')}">
            </div>
        `
        this._input = this.querySelector('input')
        this._input.addEventListener('input', () => this._schedule())
        this._input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                this._flush()
            } else if (event.key === 'Escape') {
                this.clear()
            }
        })
        if (this._pendingValue !== undefined) {
            this._input.value = this._pendingValue
            delete this._pendingValue
        }
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'placeholder' && this._input && oldValue !== newValue) {
            this._input.placeholder = newValue || ''
        }
    }

    get value() {
        return this._input ? this._input.value : (this._pendingValue || '')
    }

    /** Set the text without announcing; used to restore a query from the URL. */
    set value(text) {
        const value = String(text ?? '')
        if (this._input) this._input.value = value
        else this._pendingValue = value
    }

    get debounceMs() {
        const raw = parseInt(this.getAttribute('debounce'), 10)
        return Number.isNaN(raw) || raw < 0 ? DEFAULT_DEBOUNCE_MS : raw
    }

    /** Empty the input and announce the cleared query. */
    clear() {
        this._cancel()
        this.value = ''
        this._announce()
    }

    _cancel() {
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
    }

    _schedule() {
        this._cancel()
        const query = this.value
        if (announcesImmediately(query)) {
            this._announce()
            return
        }
        this._timer = setTimeout(() => this._announce(), this.debounceMs)
    }

    _flush() {
        this._cancel()
        this._announce()
    }

    _announce() {
        if (this._lastAnnounced === this.value) return
        this._lastAnnounced = this.value
        /** The page listens for this and re-queries the model. */
        this.dispatchEvent(new CustomEvent('gl-filter-change', {
            bubbles: true,
            detail: { query: this.value }
        }))
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
    }[c]))
}

if (!customElements.get('gl-typeahead-filter')) {
    customElements.define('gl-typeahead-filter', GLTypeaheadFilter)
}
