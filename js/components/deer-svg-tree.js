import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerSvgTree extends HTMLElement {
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
        
        const data = await this.transformData(obj)
        if (!data) {
            this.innerHTML = `<span>Error: Unable to load tree data</span>`
            return
        }

        this.innerHTML = '' // Clear any existing content
        const svg = d3.select(this).append('svg')
            .attr('width', 800)
            .attr('height', 600)
            .attr('viewBox', [-400, -300, 800, 600])
            .style('cursor', 'grab')

        const g = svg.append('g')

        const root = d3.hierarchy(data)
        
        // Dynamic tree layout with focus-based angle adjustment
        let focusedNode = root // Start with root as focused
        let treeLayout = d3.tree().nodeSize([15, 250])
        
        // Function to create a custom tree layout with dynamic angles
        const createDynamicLayout = (focusNode) => {
            return d3.tree()
                .nodeSize([15, 250])
                .separation((a, b) => {
                    // Calculate separation based on distance from focus
                    const focusDepth = focusNode.depth || 0
                    const aDistance = Math.abs(a.depth - focusDepth)
                    const bDistance = Math.abs(b.depth - focusDepth)
                    
                    // Wider separation for nodes closer to focus, tighter for distant ones
                    const baseSeparation = a.parent === b.parent ? 1 : 2
                    const focusMultiplier = Math.max(0.5, 2 - Math.max(aDistance, bDistance) * 0.3)
                    
                    return baseSeparation * focusMultiplier
                })
        }
        
        // Function to apply custom positioning based on focus
        const applyFocusLayout = (root, focusNode) => {
            treeLayout = createDynamicLayout(focusNode)
            treeLayout(root)
            
            // Apply additional angle adjustments for descendants of focused node
            root.descendants().forEach(d => {
                if (d === focusNode) return
                
                // Calculate relationship to focus node
                const isAncestor = d.ancestors().includes(focusNode)
                const isDescendant = focusNode.ancestors().includes(d)
                const depthFromFocus = Math.abs(d.depth - focusNode.depth)
                
                if (isDescendant) {
                    // Nodes that are ancestors of focus get pushed to the right and compressed
                    const compressionFactor = 0.7 + (depthFromFocus * 0.1)
                    d.y = d.y * compressionFactor + (depthFromFocus * 50)
                    
                    // Slight vertical compression for non-focused branches
                    if (d !== focusNode.parent) {
                        d.x = d.x * 0.8
                    }
                } else if (isAncestor) {
                    // Descendants of focus get wider angles
                    const expansionFactor = 1.3 - (depthFromFocus * 0.1)
                    d.x = d.x * expansionFactor
                    
                    // Slight forward positioning for focused descendants
                    d.y = d.y * 0.95
                } else {
                    // Sibling branches get moderate compression
                    const siblingFactor = 0.85
                    d.x = d.x * siblingFactor
                    d.y = d.y * 1.1
                }
            })
        }
        
        // Initial layout
        applyFocusLayout(root, focusedNode)

        // --- Tooltip setup ---
        const tooltip = d3.select(this)
            .append('div')
            .attr('class', 'deer-svg-tooltip')
            .style('position', 'absolute')
            .style('pointer-events', 'none')
            .style('background', '#fff')
            .style('border', '1px solid #1976d2')
            .style('border-radius', '4px')
            .style('padding', '8px 12px')
            .style('font-size', '13px')
            .style('color', '#222')
            .style('box-shadow', '0 2px 8px rgba(0,0,0,0.15)')
            .style('display', 'none')
            .style('z-index', 10)

        // --- Lazy loading for large trees with intersection observer ---
        const MAX_INITIAL_DEPTH = 2
        let expandedNodes = new Set()
        function updateTree() {
            // Recalculate layout with current focus
            applyFocusLayout(root, focusedNode)
            
            // Filter descendants to only those within expandedNodes or MAX_INITIAL_DEPTH
            const visibleNodes = root.descendants().filter(d => {
                // Always show all ancestors of expanded nodes
                let show = d.depth <= MAX_INITIAL_DEPTH || expandedNodes.has(d.data.id)
                if (!show) {
                    // If any ancestor is expanded, show this node
                    let ancestor = d.parent
                    while (ancestor) {
                        if (expandedNodes.has(ancestor.data.id)) {
                            show = true
                            break
                        }
                        ancestor = ancestor.parent
                    }
                }
                return show
            })
            const visibleLinks = root.links().filter(l => {
                // Show link if both source and target are visible
                return visibleNodes.includes(l.source) && visibleNodes.includes(l.target)
            })
            
            // Render links with smooth transition
            const linkTransition = d3.transition()
                .duration(500)
                .ease(d3.easeQuadInOut)
                
            g.selectAll('.link').remove()
            g.selectAll('.link')
                .data(visibleLinks)
                .join('line')
                .attr('class', 'link')
                .attr('x1', d => d.source.y)
                .attr('y1', d => d.source.x)
                .attr('x2', d => d.target.y)
                .attr('y2', d => d.target.x)
                .attr('stroke', '#555')
                .attr('stroke-width', 1.5)
                .style('opacity', 0)
                .transition(linkTransition)
                .style('opacity', 1)
                
            // Render nodes with smooth transition
            const nodeTransition = d3.transition()
                .duration(500)
                .ease(d3.easeQuadInOut)
                
            g.selectAll('.node').remove()
            const nodes = g.selectAll('.node')
                .data(visibleNodes, d => d.data.id)
                .join('g')
                .attr('class', 'node')
                .attr('transform', d => `translate(${d.y},${d.x})`)
                .style('opacity', 0)
            
            nodes.transition(nodeTransition)
                .style('opacity', 1)
            
            // Add click handlers to nodes
            const self = this
            nodes.on('click', function(event, d) {
                console.log('Node clicked:', d.data.name, d)
                event.stopPropagation()
                
                // Update focus node
                focusedNode = d
                
                // Re-render tree with new focus
                updateTree()
            })
            nodes.each(function (d) {
                const nodeElement = d3.select(this)
                
                if (d.data.name) {
                    nodeElement
                        .append('rect')
                        .attr('width', 150)
                        .attr('height', 30)
                        .attr('x', -75)
                        .attr('y', -15)
                        .attr('fill', d === focusedNode ? '#1976d2' : '#999')
                        .attr('stroke', '#555')
                        .attr('stroke-width', 2)
                    
                    nodeElement
                        .append('text')
                        .attr('text-anchor', 'middle')
                        .attr('alignment-baseline', 'middle')
                        .text(d.data.name)
                        .style('font-size', '12px')
                        .style('font-family', 'Arial, sans-serif')
                        .style('fill', '#fff')
                } else {
                    nodeElement
                        .append('foreignObject')
                        .attr('width', 150)
                        .attr('height', 50)
                        .attr('x', 0)
                        .attr('y', -15)
                        .append('xhtml:div')
                        .attr('class', 'void-parent')
                        .html(d => {
                            let buttons = ''
                            if (d.data.hasOwnProperty('hasFather')) {
                                buttons += `[ <a href="parents.html?#${d.data.id}">add father</a> ] `
                            }
                            if (d.data.hasOwnProperty('hasMother')) {
                                buttons += `[ <a href="parents.html?#${d.data.id}">add mother</a> ]`
                            }
                            return buttons
                        })
                }
            })
            
            // Re-add click handlers for focus change and expansion
            nodes.on('click', async function(event, d) {
                event.stopPropagation()
                
                // Update the focused node
                focusedNode = d
                
                // Lazy expand: if not already expanded, expand this node
                if (!expandedNodes.has(d.data.id)) {
                    expandedNodes.add(d.data.id)
                    updateTree()
                }
                
                // Recalculate layout with new focus
                applyFocusLayout(root, focusedNode)
                
                // Smooth transition to new layout
                const transition = d3.transition()
                    .duration(750)
                    .ease(d3.easeQuadInOut)
                
                // Update link positions with transition
                g.selectAll('.link')
                    .transition(transition)
                    .attr('x1', d => d.source.y)
                    .attr('y1', d => d.source.x)
                    .attr('x2', d => d.target.y)
                    .attr('y2', d => d.target.x)
                
                // Update node positions with transition
                g.selectAll('.node')
                    .transition(transition)
                    .attr('transform', d => `translate(${d.y},${d.x})`)
                
                // Centering logic - focus on the clicked node
                const x = d.x
                const y = d.y
                const scale = 1
                const svgHeight = +svg.attr('height')
                const translate = [-y * scale, -svgHeight * 0.2 - x * scale]
                
                svg.transition()
                    .duration(750)
                    .ease(d3.easeQuadInOut)
                    .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale))
                
                // Update highlights
                setTimeout(() => {
                    g.selectAll('.node rect').attr('fill', '#999')
                    d3.select(this).select('rect').attr('fill', '#1976d2')
                }, 750)
            })
            // --- Tooltip events ---
            nodes.on('mouseover', async function(event, d) {
                tooltip.style('display', 'block')
                tooltip.html(`<b>${d.data.name ?? 'Unknown'}</b><br>ID: ${d.data.id}`)
            })
            nodes.on('mousemove', function(event) {
                tooltip.style('left', (event.clientX + 10) + 'px')
                    .style('top', (event.clientY - 10) + 'px')
            })
            nodes.on('mouseleave', function() {
                tooltip.style('display', 'none')
            })

            // --- Intersection Observer for auto-expand on visible ---
            // Remove any previous observers
            if (window._deerTreeObservers) {
                window._deerTreeObservers.forEach(obs => obs.disconnect())
            }
            window._deerTreeObservers = []
            nodes.each(function(d) {
                const nodeElem = this
                // Only observe nodes that are not already expanded and are deeper than MAX_INITIAL_DEPTH
                if (!expandedNodes.has(d.data.id) && d.depth > MAX_INITIAL_DEPTH) {
                    const observer = new IntersectionObserver(entries => {
                        entries.forEach(entry => {
                            if (entry.isIntersecting) {
                                expandedNodes.add(d.data.id)
                                updateTree()
                                observer.disconnect()
                            }
                        })
                    }, { root: svg.node(), threshold: 0.1 })
                    observer.observe(nodeElem)
                    window._deerTreeObservers.push(observer)
                }
            })
        }
        // Initial render
        updateTree()

        // Add zoom and pan functionality
        const zoom = d3.zoom()
            .scaleExtent([0.5, 2])
            .on('zoom', (event) => {
                console.log('Zoom event triggered:', event.transform)
                g.attr('transform', event.transform)
                // On pan/zoom, add all visible nodes to expandedNodes
                const visibleNodes = root.descendants().filter(d => {
                    let show = d.depth <= MAX_INITIAL_DEPTH || expandedNodes.has(d.data.id)
                    if (!show) {
                        let ancestor = d.parent
                        while (ancestor) {
                            if (expandedNodes.has(ancestor.data.id)) {
                                show = true
                                break
                            }
                            ancestor = ancestor.parent
                        }
                    }
                    return show
                })
                let changed = false
                for (const d of visibleNodes) {
                    if (!expandedNodes.has(d.data.id)) {
                        expandedNodes.add(d.data.id)
                        changed = true
                    }
                }
                if (changed) updateTree()
            })
        console.log('Setting up zoom on SVG')
        svg.call(zoom)

        // Add refresh button for cache invalidation
        const refreshBtn = document.createElement('button')
        refreshBtn.textContent = 'Refresh Tree (Clear Cache)'
        refreshBtn.style.margin = '8px 0'
        refreshBtn.style.display = 'block'
        refreshBtn.style.background = '#1976d2'
        refreshBtn.style.color = '#fff'
        refreshBtn.style.border = 'none'
        refreshBtn.style.padding = '6px 12px'
        refreshBtn.style.borderRadius = '4px'
        refreshBtn.style.cursor = 'pointer'
        this.prepend(refreshBtn)

        refreshBtn.addEventListener('click', async () => {
            // Remove all localStorage cache for this tree's nodes and annotations
            const id = this.getAttribute(config.ID)
            if (id) {
                // Remove document cache
                localStorage.removeItem(id)
                // Remove annotation cache
                localStorage.removeItem(`annos:${id}`)
            }
            // Optionally, clear all annos/doc cache for all tree nodes (deep clear)
            // For now, just reload with forceRefresh
            await this.renderWithForceRefresh()
        })

        // Add fullscreen button
        const fullscreenBtn = document.createElement('button')
        fullscreenBtn.innerHTML = '⛶'
        fullscreenBtn.title = 'Fullscreen'
        fullscreenBtn.style.position = 'absolute'
        fullscreenBtn.style.top = '8px'
        fullscreenBtn.style.right = '8px'
        fullscreenBtn.style.zIndex = 20
        fullscreenBtn.style.background = '#fff'
        fullscreenBtn.style.border = '1px solid #1976d2'
        fullscreenBtn.style.borderRadius = '4px'
        fullscreenBtn.style.padding = '4px 8px'
        fullscreenBtn.style.cursor = 'pointer'
        fullscreenBtn.style.fontSize = '20px'
        fullscreenBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)'
        this.style.position = 'relative'
        this.appendChild(fullscreenBtn)

        fullscreenBtn.addEventListener('click', () => {
            const el = this.querySelector('svg')
            if (el.requestFullscreen) {
                el.requestFullscreen()
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen()
            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen()
            }
        })

        // Set white background when SVG is fullscreen
        const svgEl = this.querySelector('svg')
        if (svgEl) {
            svgEl.addEventListener('fullscreenchange', () => {
                if (document.fullscreenElement === svgEl) {
                    svgEl.style.background = '#fff'
                } else {
                    svgEl.style.background = ''
                }
            })
            // For webkit
            svgEl.addEventListener('webkitfullscreenchange', () => {
                if (document.webkitFullscreenElement === svgEl) {
                    svgEl.style.background = '#fff'
                } else {
                    svgEl.style.background = ''
                }
            })
        }
    }

    // Add a helper to render with forceRefresh
    async renderWithForceRefresh() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(config.ID)
            if (id) {
                obj = await expand(id, undefined, true) // forceRefresh
            }
        }
        const data = await this.transformData(obj)
        if (!data) {
            this.innerHTML = `<span>Error: Unable to load tree data</span>`
            return
        }
        this.innerHTML = ''
        await this.render() // re-render tree
    }

    async transformData(obj) {
        if (!obj || !obj['@id']) return null

        const buildTree = async (node) => {
            if (!node) return null
            const name = getLabel(node)
            const ancestors = []
            const addAncestor = async (relation, label) => {
                const rel = node[relation]
                const relId = rel?.value || rel?.['@id'] || rel
                if (relId && typeof relId === 'string') {
                    try {
                        const ancestorObj = await expand(relId)
                        ancestors.push(await buildTree(ancestorObj))
                    } catch (e) {
                        ancestors.push({ id: node['@id'], [relation]: false })
                    }
                } else {
                    ancestors.push({ id: node['@id'], [relation]: false })
                }
            }
            await addAncestor('hasFather', 'Father')
            await addAncestor('hasMother', 'Mother')
            return { name, children: ancestors, id: node['@id'], hasFather: node.hasFather, hasMother: node.hasMother }
        }
        return await buildTree(obj)
    }
}

customElements.define('deer-svg-tree', DeerSvgTree)
export default DeerSvgTree
