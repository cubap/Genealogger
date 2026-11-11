/**
 * Tests for gl-tree-view: the PURE layout math (`layoutTree`) gets the real
 * scrutiny — deterministic in-order placement, generation bands, shared
 * ancestors drawn once, corrupt cycles terminating — plus a thin jsdom smoke
 * that the shadow SVG actually renders nodes, contested styling, evidence-
 * naming edge labels, person links, and the re-root event.
 */

import {
    layoutTree,
    GLTreeView,
    COL_WIDTH,
    ROW_HEIGHT,
    PADDING
} from '../../js/components/gl-tree-view.js'
import { PERSON_HREF } from '../../js/components/gl-person-chip.js'

function viewData(overrides = {}) {
    return {
        rootId: 'ada',
        rootLabel: 'Ada Byron',
        nodes: [
            { id: 'george', label: 'George Byron', gen: -1, contested: false },
            { id: 'annabella', label: 'Annabella Milbanke', gen: -1, contested: false },
            { id: 'ada', label: 'Ada Byron', gen: 0, contested: false },
            { id: 'harriet', label: 'Harriet Byron', gen: 1, contested: false }
        ],
        edges: [
            { from: 'george', to: 'ada', role: 'father', evidenceLabel: 'Parish certificate' },
            { from: 'annabella', to: 'ada', role: 'mother', evidenceLabel: 'Parish certificate' },
            { from: 'ada', to: 'harriet', role: 'mother', evidenceLabel: 'Almanac' }
        ],
        ...overrides
    }
}

describe('layoutTree (pure)', () => {
    test('in-order DFS: parents left of child, child left of descendants', () => {
        const layout = layoutTree(viewData())
        const { positions, order } = layout
        expect(Object.keys(positions)).toHaveLength(4)
        expect(order).toEqual(['annabella', 'george', 'ada', 'harriet'])
        expect(positions.annabella.x).toBeLessThan(positions.george.x)
        expect(positions.george.x).toBeLessThan(positions.ada.x)
        expect(positions.ada.x).toBeLessThan(positions.harriet.x)
    })

    test('generation fixes the row band', () => {
        const layout = layoutTree(viewData())
        const { positions } = layout
        expect(positions.george.y).toBe(positions.annabella.y)
        expect(positions.ada.y).toBe(positions.george.y + ROW_HEIGHT)
        expect(positions.harriet.y).toBe(positions.ada.y + ROW_HEIGHT)
        expect(positions.george.y).toBe(PADDING) // top generation anchors the band
    })

    test('each person gets its own column and the canvas covers them all', () => {
        const layout = layoutTree(viewData())
        const xs = Object.values(layout.positions).map(p => p.x)
        expect(new Set(xs).size).toBe(xs.length)
        expect(layout.width).toBe(PADDING * 2 + 4 * COL_WIDTH)
        expect(layout.height).toBe(PADDING * 2 + 3 * ROW_HEIGHT)
    })

    test('deterministic ordering: siblings sort by label, not insertion', () => {
        const a = layoutTree(viewData())
        const shuffled = viewData()
        shuffled.nodes.reverse()
        shuffled.edges.reverse()
        const b = layoutTree(shuffled)
        expect(b.order).toEqual(a.order)
        expect(b.positions).toEqual(a.positions)
    })

    test('a shared ancestor is placed once (pedigree collapse)', () => {
        const data = {
            rootId: 'grandchild',
            nodes: [
                { id: 'gp', label: 'Shared Grandparent', gen: -2 },
                { id: 'm', label: 'Mother', gen: -1 },
                { id: 'f', label: 'Father', gen: -1 },
                { id: 'grandchild', label: 'Child', gen: 0 }
            ],
            edges: [
                { from: 'gp', to: 'm' },
                { from: 'gp', to: 'f' },
                { from: 'm', to: 'grandchild' },
                { from: 'f', to: 'grandchild' }
            ]
        }
        const layout = layoutTree(data)
        expect(layout.order).toHaveLength(4)
        expect(layout.order[0]).toBe('gp')
        // Mother's subtree comes before Father's, and both before the child.
        expect(layout.positions.gp.x).toBeLessThan(layout.positions.f.x)
    })

    test('corrupt cycles terminate and still place every node', () => {
        const layout = layoutTree({
            rootId: 'a',
            nodes: [{ id: 'a', label: 'A', gen: 0 }, { id: 'b', label: 'B', gen: 1 }],
            edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
        })
        expect(Object.keys(layout.positions)).toHaveLength(2)
    })

    test('disconnected nodes are still positioned; empty data yields no canvas', () => {
        const layout = layoutTree({
            rootId: 'x',
            nodes: [{ id: 'x', label: 'X', gen: 0 }, { id: 'orphan', label: 'O', gen: 5 }],
            edges: []
        })
        expect(layout.positions.orphan).toBeTruthy()
        const empty = layoutTree({ rootId: 'x', nodes: [], edges: [] })
        expect(empty.positions).toEqual({})
        expect(empty.width).toBe(0)
        expect(empty.height).toBe(0)
    })

    test('options resize the grid', () => {
        const layout = layoutTree(viewData(), { colWidth: 10, rowHeight: 20 })
        expect(layout.positions.harriet.x - layout.positions.ada.x).toBe(10)
        expect(layout.positions.harriet.y - layout.positions.ada.y).toBe(20)
    })
})

describe('gl-tree-view element', () => {
    let host

    beforeEach(() => {
        host = document.createElement('gl-tree-view')
        document.body.appendChild(host)
    })

    afterEach(() => {
        host.remove()
    })

    test('renders one node group per person with links to the person page', () => {
        host.tree = viewData()
        const root = host.shadowRoot
        expect(root.querySelectorAll('.node')).toHaveLength(4)
        const ada = root.querySelector('[data-person-id="ada"]')
        expect(ada.classList.contains('root')).toBe(true)
        expect(ada.querySelector('.person-name').textContent).toContain('Ada Byron')
        expect(ada.querySelector('.person-link').getAttribute('href')).toBe(`${PERSON_HREF}ada`)
    })

    test('edges are labelled with role and evidence Record', () => {
        host.tree = viewData()
        const labels = [...host.shadowRoot.querySelectorAll('.edge-label')].map(t => t.textContent)
        expect(labels).toContain('father \u00b7 Parish certificate')
        expect(labels).toContain('mother \u00b7 Almanac')
        expect(host.shadowRoot.querySelectorAll('.parent-child-line')).toHaveLength(3)
    })

    test('contested parentage shows in the shape: dashed edge + flagged node', () => {
        const data = viewData()
        data.nodes.find(n => n.id === 'ada').contested = true
        data.edges.forEach(e => {
            if (e.to === 'ada') e.contested = true
        })
        data.edges.push({ from: 'william', to: 'ada', role: 'father', evidenceLabel: 'Will', contested: true })
        data.nodes.push({ id: 'william', label: 'William Ashley', gen: -1, contested: false })
        host.tree = data
        const root = host.shadowRoot
        expect(root.querySelector('[data-person-id="ada"]').classList.contains('contested')).toBe(true)
        expect(root.querySelector('[data-person-id="ada"]').textContent).toContain('contested parentage')
        // Every claim into the contested person is dashed: with two sources
        // disagreeing, even the mother's assertion is part of the dispute.
        expect(root.querySelectorAll('path.edge.contested')).toHaveLength(3)
        // BOTH competing father edges survive side by side.
        const fatherLabels = [...root.querySelectorAll('.edge-label')]
            .filter(t => t.textContent.startsWith('father'))
            .map(t => t.textContent)
        expect(fatherLabels).toEqual(['father \u00b7 Parish certificate', 'father \u00b7 Will'])
    })

    test('clicking a node fires gl-tree-root; clicking its person link does not', () => {
        host.tree = viewData()
        const seen = []
        host.addEventListener('gl-tree-root', event => seen.push(event.detail.id))
        host.shadowRoot.querySelector('[data-person-id="harriet"]').dispatchEvent(
            new Event('click', { bubbles: true })
        )
        expect(seen).toEqual(['harriet'])
        host.shadowRoot.querySelector('[data-person-id="george"] a').dispatchEvent(
            new Event('click', { bubbles: true })
        )
        expect(seen).toEqual(['harriet'])
    })

    test('null tree clears the canvas', () => {
        host.tree = viewData()
        expect(host.shadowRoot.querySelector('svg')).toBeTruthy()
        host.tree = null
        expect(host.shadowRoot.querySelector('svg')).toBeNull()
    })

    test('labels are escaped, never parsed as markup', () => {
        host.tree = viewData({
            nodes: [{ id: 'x', label: '<img src=x onerror=alert(1)>', gen: 0 }]
        })
        expect(host.shadowRoot.querySelector('img')).toBeNull()
        expect(host.shadowRoot.querySelector('.person-name').textContent)
            .toBe('<img src=x onerror=alert(1)>')
    })

    test('the class is exported and registered as gl-tree-view', () => {
        expect(customElements.get('gl-tree-view')).toBe(GLTreeView)
    })
})
