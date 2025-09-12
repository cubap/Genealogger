import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerAncestorTimeline extends HTMLElement {
    static get observedAttributes() {
        return [config.ID, 'demo']
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading ancestor timeline...</span>`
        
        // Check for URL hash with person ID
        const hash = window.location.hash
        if (hash && hash.startsWith('#http')) {
            const personId = hash.substring(1) // Remove the # character
            this.setAttribute(config.ID, personId)
            await this.render()
        } else if (this.getAttribute('demo') === 'true') {
            await this.render()
        }
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if ((name === config.ID || name === 'demo') && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        
        // Check for demo mode first
        if (this.getAttribute('demo') === 'true') {
            const timelineData = this.getMockTimelineData()
            this.renderTimeline(timelineData)
            return
        }
        
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(config.ID)
            if (id) {
                try {
                    obj = await expand(id)
                } catch (e) {
                    console.warn('Could not load person data:', e)
                    this.innerHTML = `<div class="timeline-error">Could not load person data. <button onclick="this.parentElement.parentElement.setAttribute('demo', 'true')">Try Demo</button></div>`
                    return
                }
            }
        }

        if (!obj || !obj['@id']) {
            this.innerHTML = `<div class="timeline-error">Please select a person to view their ancestor timeline</div>`
            return
        }

        const timelineData = await this.buildTimelineData(obj)
        this.renderTimeline(timelineData)
    }

    async buildTimelineData(rootPerson) {
        const persons = new Map()
        const events = new Map()
        const marriages = new Map()
        
        // Check if we should use mock data (for development/demo purposes)
        if (this.getAttribute('demo') === 'true' || !rootPerson['@id']) {
            return this.getMockTimelineData()
        }
        
        // Recursively gather ancestors
        const gatherAncestors = async (person, generation = 0) => {
            if (!person || persons.has(person['@id']) || generation > 4) return // Limit to 5 generations
            
            const personData = {
                id: person['@id'],
                name: getLabel(person),
                generation: generation,
                person: person
            }
            persons.set(person['@id'], personData)

            // Get birth and death events for this person
            await this.getPersonEvents(person['@id'], events)

            // Get parents
            if (person.hasFather) {
                const fatherID = getValue(person.hasFather)
                if (fatherID) {
                    try {
                        const father = await expand(fatherID)
                        await gatherAncestors(father, generation + 1)
                        personData.fatherId = fatherID
                    } catch (e) {
                        console.warn('Could not load father:', fatherID)
                    }
                }
            }

            if (person.hasMother) {
                const motherID = getValue(person.hasMother)
                if (motherID) {
                    try {
                        const mother = await expand(motherID)
                        await gatherAncestors(mother, generation + 1)
                        personData.motherId = motherID
                    } catch (e) {
                        console.warn('Could not load mother:', motherID)
                    }
                }
            }
        }

        await gatherAncestors(rootPerson)

        return { persons, events, marriages }
    }

    getMockTimelineData() {
        const persons = new Map()
        const events = new Map()
        
        // Mock data for demonstration
        const mockPersons = [
            { id: 'person1', name: 'John Smith', generation: 0 },
            { id: 'person2', name: 'Robert Smith', generation: 1, fatherId: null, motherId: null },
            { id: 'person3', name: 'Mary Johnson', generation: 1, fatherId: null, motherId: null },
            { id: 'person4', name: 'William Smith', generation: 2, fatherId: null, motherId: null },
            { id: 'person5', name: 'Elizabeth Brown', generation: 2, fatherId: null, motherId: null },
            { id: 'person6', name: 'James Johnson', generation: 2, fatherId: null, motherId: null },
            { id: 'person7', name: 'Sarah Davis', generation: 2, fatherId: null, motherId: null }
        ]

        // Set parent relationships
        mockPersons[0].fatherId = 'person2'
        mockPersons[0].motherId = 'person3'
        mockPersons[1].fatherId = 'person4'
        mockPersons[1].motherId = 'person5'
        mockPersons[2].fatherId = 'person6'
        mockPersons[2].motherId = 'person7'

        mockPersons.forEach(p => persons.set(p.id, p))

        // Mock events with realistic dates
        const mockEvents = [
            { id: 'birth1', type: 'Birth', personId: 'person1', date: '1990-03-15' },
            { id: 'birth2', type: 'Birth', personId: 'person2', date: '1965-07-22' },
            { id: 'birth3', type: 'Birth', personId: 'person3', date: '1968-11-08' },
            { id: 'birth4', type: 'Birth', personId: 'person4', date: '1940-01-12' },
            { id: 'birth5', type: 'Birth', personId: 'person5', date: '1942-09-30' },
            { id: 'birth6', type: 'Birth', personId: 'person6', date: '1945-05-18' },
            { id: 'birth7', type: 'Birth', personId: 'person7', date: '1948-12-03' },
            { id: 'death4', type: 'Death', personId: 'person4', date: '2015-08-14' },
            { id: 'death6', type: 'Death', personId: 'person6', date: '2018-02-28' }
        ]

        mockEvents.forEach(e => events.set(`${e.personId}-${e.type}`, e))

        return { persons, events, marriages: new Map() }
    }

    async getPersonEvents(personId, events) {
        try {
            const query = {
                "__rerum.history.next": { "$exists": true, "$size": 0 },
                "body.hasAgent.value": { $in: [personId.replace(/^https?:/, 'https:')] }
            }
            
            const eventAnnotations = await fetch('https://tinydev.rerum.io/query', {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
            }).then(r => r.json()).catch(() => [])

            for (const annotation of eventAnnotations) {
                if (!annotation?.target) continue
                try {
                    const eventObj = await expand(annotation.target)
                    const type = getValue(eventObj.additionalType)
                    if (type === 'Birth' || type === 'Death' || type === 'Baptism') {
                        const eventData = {
                            id: eventObj['@id'],
                            type: type,
                            personId: personId,
                            date: getValue(eventObj.birthDate) || getValue(eventObj.deathDate) || getValue(eventObj.date),
                            label: getLabel(eventObj)
                        }
                        events.set(`${personId}-${type}`, eventData)
                    }
                } catch (e) {
                    console.warn('Could not load event:', annotation.target)
                }
            }
        } catch (e) {
            console.warn('Could not query events for person:', personId)
        }
    }

    renderTimeline(data) {
        const { persons, events } = data
        
        // Clear previous content
        this.innerHTML = ''
        
        // Calculate date range
        const dateRange = this.calculateDateRange(persons, events)
        
        // Create container
        const container = document.createElement('div')
        container.className = 'ancestor-timeline-container'
        container.style.position = 'relative'
        container.style.width = '100%'
        container.style.height = '600px'
        container.style.overflow = 'auto'
        container.style.border = '1px solid #ddd'
        container.style.borderRadius = '8px'
        container.style.background = '#fff'
        
        // Create SVG
        const timelineWidth = Math.max(1200, dateRange.span * 15) // 15px per year
        const timelineHeight = 500
        const rowHeight = 80
        const margin = { top: 60, right: 100, bottom: 60, left: 150 }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('width', timelineWidth)
        svg.setAttribute('height', timelineHeight)
        svg.style.cursor = 'grab'
        svg.style.display = 'block'

        // Calculate scales - REVERSE the date order so newest is on left
        const generations = Array.from(new Set(Array.from(persons.values()).map(p => p.generation))).sort((a, b) => a - b) // Gen 0 first (newest)
        
        // Render timeline axis
        this.renderTimelineAxis(svg, dateRange, timelineWidth, timelineHeight, margin)
        
        // Render persons and events
        this.renderPersonsAndEvents(svg, persons, events, dateRange, generations, timelineWidth, timelineHeight, margin, rowHeight)
        
        // Add pan functionality
        this.addPanToTimeline(container, svg)
        
        // Add tooltip
        this.addTooltip(container, svg)
        
        container.appendChild(svg)
        this.appendChild(container)
    }

    calculateDateRange(persons, events) {
        const dates = []
        
        // Get all dates from events
        for (const event of events.values()) {
            if (event.date) {
                const date = new Date(event.date)
                if (!isNaN(date.getTime())) {
                    dates.push(date)
                }
            }
        }

        // If no dates found, create a reasonable range
        if (dates.length === 0) {
            const now = new Date()
            return {
                min: new Date(now.getFullYear() - 150, 0, 1),
                max: new Date(now.getFullYear() + 10, 11, 31),
                span: 160
            }
        }

        const minDate = new Date(Math.min(...dates))
        const maxDate = new Date(Math.max(...dates))
        
        // Add some padding
        const span = maxDate.getFullYear() - minDate.getFullYear()
        const padding = Math.max(10, span * 0.1)
        
        return {
            min: new Date(minDate.getFullYear() - padding, 0, 1),
            max: new Date(maxDate.getFullYear() + padding, 11, 31),
            span: span + (padding * 2)
        }
    }

    // Simple linear scale function
    createScale(domain, range) {
        const domainMin = domain[0].getTime()
        const domainMax = domain[1].getTime()
        const rangeMin = range[0]
        const rangeMax = range[1]
        
        return (value) => {
            const valueTime = value.getTime()
            const ratio = (valueTime - domainMin) / (domainMax - domainMin)
            return rangeMin + ratio * (rangeMax - rangeMin)
        }
    }

    renderTimelineAxis(svg, dateRange, width, height, margin) {
        // REVERSE the x-scale so newer dates are on the left
        const xScale = this.createScale([dateRange.max, dateRange.min], [margin.left, width - margin.right])
        
        // Top axis line
        const topAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        topAxisLine.setAttribute('x1', margin.left)
        topAxisLine.setAttribute('y1', margin.top)
        topAxisLine.setAttribute('x2', width - margin.right)
        topAxisLine.setAttribute('y2', margin.top)
        topAxisLine.setAttribute('stroke', '#666')
        topAxisLine.setAttribute('stroke-width', '1')
        svg.appendChild(topAxisLine)

        // Bottom axis line
        const bottomAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        bottomAxisLine.setAttribute('x1', margin.left)
        bottomAxisLine.setAttribute('y1', height - margin.bottom)
        bottomAxisLine.setAttribute('x2', width - margin.right)
        bottomAxisLine.setAttribute('y2', height - margin.bottom)
        bottomAxisLine.setAttribute('stroke', '#666')
        bottomAxisLine.setAttribute('stroke-width', '1')
        svg.appendChild(bottomAxisLine)

        // Add year labels and grid lines
        const startYear = dateRange.min.getFullYear()
        const endYear = dateRange.max.getFullYear()
        const yearStep = Math.max(5, Math.floor((endYear - startYear) / 15))
        
        for (let year = startYear; year <= endYear; year += yearStep) {
            const date = new Date(year, 0, 1)
            const x = xScale(date)
            
            // Grid line
            const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
            gridLine.setAttribute('x1', x)
            gridLine.setAttribute('y1', margin.top)
            gridLine.setAttribute('x2', x)
            gridLine.setAttribute('y2', height - margin.bottom)
            gridLine.setAttribute('stroke', '#e0e0e0')
            gridLine.setAttribute('stroke-width', '1')
            gridLine.setAttribute('stroke-dasharray', '2,2')
            svg.appendChild(gridLine)
            
            // Top label
            const topLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
            topLabel.setAttribute('x', x)
            topLabel.setAttribute('y', margin.top - 10)
            topLabel.setAttribute('text-anchor', 'middle')
            topLabel.setAttribute('font-size', '12')
            topLabel.setAttribute('fill', '#666')
            topLabel.textContent = year
            svg.appendChild(topLabel)
            
            // Bottom label
            const bottomLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
            bottomLabel.setAttribute('x', x)
            bottomLabel.setAttribute('y', height - margin.bottom + 20)
            bottomLabel.setAttribute('text-anchor', 'middle')
            bottomLabel.setAttribute('font-size', '12')
            bottomLabel.setAttribute('fill', '#666')
            bottomLabel.textContent = year
            svg.appendChild(bottomLabel)
        }
    }

    renderPersonsAndEvents(svg, persons, events, dateRange, generations, width, height, margin, rowHeight) {
        // REVERSE the x-scale so newer dates are on the left
        const xScale = this.createScale([dateRange.max, dateRange.min], [margin.left, width - margin.right])
        
        // Group people by generation and assign rows
        const generationGroups = new Map()
        generations.forEach(gen => generationGroups.set(gen, []))
        
        Array.from(persons.values()).forEach(person => {
            generationGroups.get(person.generation).push(person)
        })
        
        // Calculate layout dimensions
        const maxPeopleInGeneration = Math.max(...Array.from(generationGroups.values()).map(group => group.length))
        const rowsPerGeneration = Math.max(1, maxPeopleInGeneration)
        const personRowHeight = 50 // Height for each person row
        const generationSpacing = 20 // Extra space between generations
        const totalGenerationHeight = (rowsPerGeneration * personRowHeight) + generationSpacing
        
        // Update SVG height to accommodate all rows
        const newHeight = Math.max(height, margin.top + margin.bottom + (generations.length * totalGenerationHeight))
        svg.setAttribute('height', newHeight)
        
        // Render generation backgrounds for visual separation
        generations.forEach((generation, genIndex) => {
            const genY = margin.top + (genIndex * totalGenerationHeight)
            const genRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
            genRect.setAttribute('x', margin.left - 20)
            genRect.setAttribute('y', genY - 10)
            genRect.setAttribute('width', width - margin.left - margin.right + 40)
            genRect.setAttribute('height', totalGenerationHeight - generationSpacing)
            genRect.setAttribute('fill', generation === 0 ? '#e3f2fd' : '#f5f5f5')
            genRect.setAttribute('stroke', '#ddd')
            genRect.setAttribute('stroke-width', '1')
            genRect.setAttribute('opacity', '0.3')
            svg.appendChild(genRect)
            
            // Generation label
            const genLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
            genLabel.setAttribute('x', '10')
            genLabel.setAttribute('y', genY + (totalGenerationHeight - generationSpacing) / 2)
            genLabel.setAttribute('text-anchor', 'start')
            genLabel.setAttribute('dominant-baseline', 'middle')
            genLabel.setAttribute('font-size', '14')
            genLabel.setAttribute('font-weight', 'bold')
            genLabel.setAttribute('fill', '#666')
            genLabel.textContent = `Gen ${generation}`
            svg.appendChild(genLabel)
        })
        
        // Render each person in their assigned row
        generations.forEach((generation, genIndex) => {
            const peopleInGeneration = generationGroups.get(generation)
            
            peopleInGeneration.forEach((personData, personIndex) => {
                const genY = margin.top + (genIndex * totalGenerationHeight)
                const y = genY + (personIndex * personRowHeight) + (personRowHeight / 2)
                
                // Get birth, death, and baptism events for this person
                const birthEvent = events.get(`${personData.id}-Birth`)
                const deathEvent = events.get(`${personData.id}-Death`)
                const baptismEvent = events.get(`${personData.id}-Baptism`)

                // Calculate timeline span for this person
                let startDate, endDate, isEstimated = false

                if (birthEvent && birthEvent.date) {
                    startDate = new Date(birthEvent.date)
                } else if (baptismEvent && baptismEvent.date) {
                    // Estimate birth as the year before baptism
                    isEstimated = true
                    const baptismDate = new Date(baptismEvent.date)
                    startDate = new Date(baptismDate.getFullYear() - 1, baptismDate.getMonth(), baptismDate.getDate())
                } else {
                    // Estimate birth date based on death date or current year
                    isEstimated = true
                    if (deathEvent && deathEvent.date) {
                        startDate = new Date(new Date(deathEvent.date).getFullYear() - 80, 0, 1)
                    } else {
                        startDate = new Date(dateRange.max.getFullYear() - 80 - (personData.generation * 25), 0, 1)
                    }
                }

                if (deathEvent && deathEvent.date) {
                    endDate = new Date(deathEvent.date)
                } else {
                    // Estimate death date or use a reasonable endpoint
                    if (birthEvent && birthEvent.date) {
                        endDate = new Date(new Date(birthEvent.date).getFullYear() + 80, 11, 31)
                    } else if (baptismEvent && baptismEvent.date) {
                        endDate = new Date(new Date(baptismEvent.date).getFullYear() + 80, 11, 31)
                    } else {
                        endDate = new Date(startDate.getFullYear() + 80, 11, 31)
                    }
                    isEstimated = true
                }

                // Person timeline bar (fix negative width issue for reversed timeline)
                const barStartX = xScale(startDate)
                const barEndX = xScale(endDate)
                const barX = Math.min(barStartX, barEndX)
                const barWidth = Math.abs(barEndX - barStartX)
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
                rect.setAttribute('x', barX)
                rect.setAttribute('y', y - 15)
                rect.setAttribute('width', barWidth)
                rect.setAttribute('height', 30)
                rect.setAttribute('fill', personData.generation === 0 ? '#1976d2' : '#90caf9')
                rect.setAttribute('stroke', '#1976d2')
                rect.setAttribute('stroke-width', '2')
                rect.style.opacity = isEstimated ? '0.6' : '1'
                if (isEstimated) {
                    rect.setAttribute('stroke-dasharray', '5,5')
                }
                rect.style.cursor = 'pointer'
                
                // Store data for tooltip
                rect.personData = {
                    ...personData,
                    birthEvent,
                    deathEvent,
                    baptismEvent,
                    startDate,
                    endDate,
                    isEstimated
                }
                
                svg.appendChild(rect)

                // Person name label
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
                text.setAttribute('x', barX + barWidth / 2)
                text.setAttribute('y', y)
                text.setAttribute('text-anchor', 'middle')
                text.setAttribute('dominant-baseline', 'middle')
                text.setAttribute('font-size', '12')
                text.setAttribute('font-weight', '500')
                text.setAttribute('fill', personData.generation === 0 ? '#fff' : '#1976d2')
                text.textContent = personData.name
                text.style.pointerEvents = 'none'
                svg.appendChild(text)

                // Birth event marker
                if (birthEvent && birthEvent.date) {
                    const birthMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
                    birthMarker.setAttribute('cx', xScale(startDate))
                    birthMarker.setAttribute('cy', y)
                    birthMarker.setAttribute('r', '5')
                    birthMarker.setAttribute('fill', '#4caf50')
                    birthMarker.setAttribute('stroke', '#fff')
                    birthMarker.setAttribute('stroke-width', '2')
                    birthMarker.style.cursor = 'pointer'
                    birthMarker.eventData = birthEvent
                    svg.appendChild(birthMarker)
                }

                // Baptism event marker (if used for birth estimation)
                if (baptismEvent && baptismEvent.date && (!birthEvent || !birthEvent.date)) {
                    const baptismMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
                    baptismMarker.setAttribute('cx', xScale(new Date(baptismEvent.date)))
                    baptismMarker.setAttribute('cy', y)
                    baptismMarker.setAttribute('r', '4')
                    baptismMarker.setAttribute('fill', '#9c27b0')
                    baptismMarker.setAttribute('stroke', '#fff')
                    baptismMarker.setAttribute('stroke-width', '2')
                    baptismMarker.style.cursor = 'pointer'
                    baptismMarker.eventData = baptismEvent
                    svg.appendChild(baptismMarker)
                }

                // Death event marker
                if (deathEvent && deathEvent.date) {
                    const deathMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
                    deathMarker.setAttribute('cx', xScale(endDate))
                    deathMarker.setAttribute('cy', y)
                    deathMarker.setAttribute('r', '5')
                    deathMarker.setAttribute('fill', '#f44336')
                    deathMarker.setAttribute('stroke', '#fff')
                    deathMarker.setAttribute('stroke-width', '2')
                    deathMarker.style.cursor = 'pointer'
                    deathMarker.eventData = deathEvent
                    svg.appendChild(deathMarker)
                }

                // Draw parent-child relationships
                this.renderRelationshipLines(svg, personData, persons, events, xScale, margin, totalGenerationHeight, generations, genIndex, personIndex, peopleInGeneration)
            })
        })
    }

    renderRelationshipLines(svg, person, persons, events, xScale, margin, totalGenerationHeight, generations, genIndex, personIndex, peopleInGeneration) {
        if (person.fatherId || person.motherId) {
            const personRowHeight = 50
            const genY = margin.top + (genIndex * totalGenerationHeight)
            const childY = genY + (personIndex * personRowHeight) + (personRowHeight / 2)
            const childBirth = events.get(`${person.id}-Birth`)
            const childBaptism = events.get(`${person.id}-Baptism`)
            // Use birth date, or baptism if no birth, or estimate
            const childBirthDate = childBirth?.date ? new Date(childBirth.date) : 
                                 childBaptism?.date ? new Date(childBaptism.date) : 
                                 new Date(2000, 0, 1)
            const childX = xScale(childBirthDate)
            
            if (person.fatherId && persons.has(person.fatherId)) {
                const father = persons.get(person.fatherId)
                const fatherGenIndex = generations.indexOf(father.generation)
                const fatherGenY = margin.top + (fatherGenIndex * totalGenerationHeight)
                
                // Find father's position within his generation
                const fatherGeneration = Array.from(persons.values()).filter(p => p.generation === father.generation)
                const fatherPersonIndex = fatherGeneration.findIndex(p => p.id === father.id)
                const fatherY = fatherGenY + (fatherPersonIndex * personRowHeight) + (personRowHeight / 2)
                
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
                line.setAttribute('x1', childX)
                line.setAttribute('y1', fatherY + 15)
                line.setAttribute('x2', childX)
                line.setAttribute('y2', childY - 15)
                line.setAttribute('stroke', '#4caf50')
                line.setAttribute('stroke-width', '2')
                line.setAttribute('stroke-dasharray', '3,3')
                svg.appendChild(line)
            }
            
            if (person.motherId && persons.has(person.motherId)) {
                const mother = persons.get(person.motherId)
                const motherGenIndex = generations.indexOf(mother.generation)
                const motherGenY = margin.top + (motherGenIndex * totalGenerationHeight)
                
                // Find mother's position within her generation
                const motherGeneration = Array.from(persons.values()).filter(p => p.generation === mother.generation)
                const motherPersonIndex = motherGeneration.findIndex(p => p.id === mother.id)
                const motherY = motherGenY + (motherPersonIndex * personRowHeight) + (personRowHeight / 2)
                
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
                line.setAttribute('x1', childX)
                line.setAttribute('y1', motherY + 15)
                line.setAttribute('x2', childX)
                line.setAttribute('y2', childY - 15)
                line.setAttribute('stroke', '#4caf50')
                line.setAttribute('stroke-width', '2')
                line.setAttribute('stroke-dasharray', '3,3')
                svg.appendChild(line)
            }

            // Draw marriage line between parents if both exist
            if (person.fatherId && person.motherId && 
                persons.has(person.fatherId) && persons.has(person.motherId)) {
                const father = persons.get(person.fatherId)
                const mother = persons.get(person.motherId)
                
                const fatherGenIndex = generations.indexOf(father.generation)
                const fatherGenY = margin.top + (fatherGenIndex * totalGenerationHeight)
                const fatherGeneration = Array.from(persons.values()).filter(p => p.generation === father.generation)
                const fatherPersonIndex = fatherGeneration.findIndex(p => p.id === father.id)
                const fatherY = fatherGenY + (fatherPersonIndex * personRowHeight) + (personRowHeight / 2)
                
                const motherGenIndex = generations.indexOf(mother.generation)
                const motherGenY = margin.top + (motherGenIndex * totalGenerationHeight)
                const motherGeneration = Array.from(persons.values()).filter(p => p.generation === mother.generation)
                const motherPersonIndex = motherGeneration.findIndex(p => p.id === mother.id)
                const motherY = motherGenY + (motherPersonIndex * personRowHeight) + (personRowHeight / 2)
                
                const marriageLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
                marriageLine.setAttribute('x1', childX - 20)
                marriageLine.setAttribute('y1', fatherY)
                marriageLine.setAttribute('x2', childX - 20)
                marriageLine.setAttribute('y2', motherY)
                marriageLine.setAttribute('stroke', '#e91e63')
                marriageLine.setAttribute('stroke-width', '3')
                svg.appendChild(marriageLine)
            }
        }
    }

    addPanToTimeline(container, svg) {
        let isDragging = false
        let startX = 0
        let startY = 0
        let startScrollLeft = 0
        let startScrollTop = 0

        container.addEventListener('mousedown', (e) => {
            isDragging = true
            startX = e.clientX
            startY = e.clientY
            startScrollLeft = container.scrollLeft
            startScrollTop = container.scrollTop
            container.style.cursor = 'grabbing'
        })

        container.addEventListener('mousemove', (e) => {
            if (!isDragging) return
            const deltaX = e.clientX - startX
            const deltaY = e.clientY - startY
            container.scrollLeft = startScrollLeft - deltaX
            container.scrollTop = startScrollTop - deltaY
        })

        container.addEventListener('mouseup', () => {
            isDragging = false
            container.style.cursor = 'grab'
        })

        container.addEventListener('mouseleave', () => {
            isDragging = false
            container.style.cursor = 'grab'
        })
    }

    addTooltip(container, svg) {
        const tooltip = document.createElement('div')
        tooltip.className = 'timeline-tooltip'
        tooltip.style.position = 'absolute'
        tooltip.style.pointerEvents = 'none'
        tooltip.style.background = '#fff'
        tooltip.style.border = '1px solid #1976d2'
        tooltip.style.borderRadius = '4px'
        tooltip.style.padding = '8px 12px'
        tooltip.style.fontSize = '13px'
        tooltip.style.color = '#222'
        tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'
        tooltip.style.display = 'none'
        tooltip.style.zIndex = '10'
        tooltip.style.maxWidth = '200px'
        tooltip.style.lineHeight = '1.4'
        container.appendChild(tooltip)

        // Add hover events to person rectangles and markers
        svg.addEventListener('mouseover', (event) => {
            const target = event.target
            if (target.personData || target.eventData) {
                tooltip.style.display = 'block'
                if (target.personData) {
                    const d = target.personData
                    const birthStr = d.birthEvent ? d.birthEvent.date : 
                                   d.baptismEvent ? `~${new Date(new Date(d.baptismEvent.date).getFullYear() - 1, new Date(d.baptismEvent.date).getMonth(), new Date(d.baptismEvent.date).getDate()).toISOString().split('T')[0]} (est. from baptism)` : 
                                   'Unknown'
                    const deathStr = d.deathEvent ? d.deathEvent.date : 'Unknown'
                    tooltip.innerHTML = `
                        <b>${d.name}</b><br>
                        Born: ${birthStr}<br>
                        Died: ${deathStr}<br>
                        Generation: ${d.generation}
                        ${d.isEstimated ? '<br><i>* Some dates estimated</i>' : ''}
                        ${d.baptismEvent && !d.birthEvent ? '<br><i>Birth estimated from baptism</i>' : ''}
                    `
                } else if (target.eventData) {
                    const e = target.eventData
                    tooltip.innerHTML = `
                        <b>${e.type} Event</b><br>
                        Date: ${e.date}<br>
                        ${e.label || ''}
                    `
                }
            }
        })

        svg.addEventListener('mousemove', (event) => {
            if (tooltip.style.display === 'block') {
                const rect = container.getBoundingClientRect()
                tooltip.style.left = (event.clientX - rect.left + 10) + 'px'
                tooltip.style.top = (event.clientY - rect.top - 10) + 'px'
            }
        })

        svg.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none'
        })
    }
}

customElements.define('deer-ancestor-timeline', DeerAncestorTimeline)
export default DeerAncestorTimeline