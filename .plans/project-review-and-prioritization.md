# Genealogger Project Review & Prioritized Task Plan

## Overview
Genealogger is a client-side JavaScript web application built with the DEER (Data Encoding and Exhibition for RERUM) framework for managing genealogical data. This document prioritizes tasks by complexity and impact.

---

## Priority 1: Critical Path Validation (High Impact)

**Objective**: Verify core functionality is working before proceeding with any changes.

### Steps
1. Start the development server:
   ```bash
   cd /home/runner/work/Genealogger/Genealogger
   python3 -m http.server 8080
   ```

2. Access application at `http://localhost:8080` and validate:
   - Homepage loads with person list area visible
   - "New Person" button is present and clickable
   - Birth form (`birth.html`) displays all fields correctly
   - Form fields accept text input

3. Monitor browser console for expected errors (blocked CDN/API resources are normal)

### Why This Matters
Without confirming baseline functionality, all subsequent changes are invalid. RERUM API dependencies must be confirmed working or blocked.

---

## Priority 2: Architecture Audit (Medium Impact)

**Objective**: Ensure codebase structure supports ES6 modules and has no hidden dependencies.

### Key Checks
- **Module System**:
  - Verify all `.js` files use ES6 `import`/`export` syntax
  - Confirm no CommonJS `require()` statements exist
  - Check that D3.js is loaded via CDN only (no local copies)

- **Component Structure**:
  - Verify `js/components/` contains 15+ `deer-*.js` files
  - Confirm each component is a custom web element
  - Check imports are relative and use `.js` extensions

- **Configuration**:
  - Review `js/deer-config.js` for API endpoint definitions
  - Verify RERUM API URLs point to `tinydev.rerum.io` or `devstore.rerum.io`
  - Confirm no hardcoded API keys

- **Dependencies**:
  - Validate `package.json` has empty `dependencies` object
  - Confirm `scripts.test` is placeholder only

### Files to Review
```
js/deer.js
js/deer-config.js
js/deer-render.js
js/deer-record.js
js/deer-utils.js
js/components/* (all 15+ files)
js/utils/* (data-utils.js, dom-utils.js, string-utils.js)
```

---

## Priority 3: Feature Implementation Workflow (Low-Medium Impact)

**Objective**: Establish repeatable pattern for adding new features.

### New Component Pattern
```
1. Create component file: js/components/deer-[feature-name].js
2. Use ES6 class extending HTMLElement
3. Import any utilities: import { util } from '../utils/utility.js'
4. Define custom element: customElements.define('deer-[feature]', DeerComponent)
5. Import in target HTML page: <script type="module" src="js/components/deer-[feature].js"></script>
6. Use in HTML: <deer-[feature]></deer-[feature]>
7. Test in browser with Python server
```

### Code Standards
- No unnecessary semicolons
- Use optional chaining: `data?.field ?? 'default'`
- Use guard clauses: `if (!input) return`
- Avoid CommonJS syntax
- No `defer` attribute (use `type="module"` instead)

---

## Priority 4: Testing Strategy (High Impact)

**Objective**: Validate changes don't break core functionality.

### Test Scenarios (in order of priority)
1. **Birth Form Validation**:
   - Navigate to `birth.html`
   - Fill all fields (Given Name, Family Name, birth date, gender)
   - Submit form
   - Verify API call in Network tab
   - Check person list updates on `index.html`

2. **Navigation Flow**:
   - Homepage → "New Person" button → `person.html`
   - `person.html` → Create new person → redirect
   - All pages → "home" link → returns to `index.html`

3. **Edge Cases**:
   - Submit empty form → should show validation error
   - API returns 400/500 → should display error message
   - Missing RERUM API → should gracefully degrade

### Browser Testing Tools
- **Network Tab**: Monitor API requests to RERUM endpoints
- **Console Tab**: Watch for module load errors
- **Elements Tab**: Inspect custom web component DOM structure

---

## Priority 5: Risk Mitigation (Medium Impact)

**Objective**: Prepare for deployment and external dependency failures.

### D3.js Library Management
- Currently loaded from: `https://cdn.jsdelivr.net/npm/d3@7/+esm`
- If CDN is blocked: Download locally and update import path
- Fallback: Create SVG-based alternatives for tree/timeline views

### RERUM API Resilience
- Add fetch error handling: `cache: 'no-store'` header
- Implement retry logic for failed requests
- Display user-friendly error messages instead of console errors
- Test with API disabled to identify graceful degradation issues

### External Dependencies
- Verify all external URLs are HTTPS
- Document API version requirements
- Create `.env.example` file for configuration

---

## Priority 6: Documentation (Low Impact)

**Objective**: Keep documentation synchronized with codebase.

### Files to Update/Create
- `README.md`:
  - Add section: "Run Locally" with Python HTTP server command
  - Add troubleshooting section for common errors

- `.plans/` directory:
  - This file (current)
  - Create `ARCHITECTURE.md` with component dependency graph
  - Create `TESTING.md` with detailed test procedures

- `js/components/README.md`:
  - List all 15+ components with purpose
  - Include example usage for each

### Documentation Standards
- Use Markdown formatting
- Include code examples where relevant
- Link to external resources (DEER docs, RERUM API docs)

---

## Implementation Timeline

| Phase | Tasks | Duration | Dependencies |
|-------|-------|----------|--------------|
| **Phase 1** | Priority 1: Validation | 30 min | None |
| **Phase 2** | Priority 2: Architecture Audit | 2-3 hours | Phase 1 complete |
| **Phase 3** | Priority 3: Feature Implementation | Varies | Phase 2 complete |
| **Phase 4** | Priority 4: Testing | 2-4 hours | Phase 3 complete |
| **Phase 5** | Priority 5: Risk Mitigation | 3-4 hours | All phases |
| **Phase 6** | Priority 6: Documentation | 1-2 hours | All phases |

---

## Success Criteria

- [ ] Application runs without errors on Python HTTP server
- [ ] All 15+ components are ES6 modules with no CommonJS syntax
- [ ] Birth form accepts input and submits to RERUM API
- [ ] Navigation between all HTML pages works correctly
- [ ] Browser console shows only expected CDN/API blocking errors
- [ ] New features follow established component pattern
- [ ] All test scenarios pass in browser validation
- [ ] Error handling gracefully manages API failures
- [ ] Documentation reflects current architecture

---

## Notes
- **No build process required** - files served directly
- **Manual testing only** - no automated test suite exists
- **Allow 5-10 seconds** for external dependency loading
- **Test in modern browser** - ES6 module support required
