# Genealogger Project Plan

> **Status: partly superseded.** This is the original MVP plan, written while the app still ran the
> DEER v1 runtime. Milestones M1–M3 (the eventities rebuild: `js/model` + `js/adapters` seams, the
> `gl-*` pages, and the deletion of the v1 runtime) are done; see the README,
> `docs/page-model-adapter.md`, and issue #14 for what the code actually is. The plan is kept as the
> record of intent, not as the current spec.

## Project Overview
Genealogger is a web-based genealogy application for recording person records as evidenced annotations in RERUM. It enables users to create, manage, and visualize family relationships through interactive family trees and ancestor timelines.

**Current State:**
- Static HTML/JS frontend with custom web components
- Uses RERUM/TinyThings APIs for data storage (no custom backend)
- Core features implemented: person management, family trees, ancestor timelines
- Missing: tests, CI/CD, monitoring, comprehensive documentation

## Objectives
- Deliver a stable MVP with core genealogy features
- Ensure code quality with automated tests and linting
- Enable continuous delivery via GitHub Actions
- Add basic error monitoring and logging
- Document setup, usage, and contribution guidelines

## Scope
**In scope (MVP):**
- Person creation and management (birth, death, relationships)
- Family tree visualization (hierarchical and SVG-based)
- Ancestor timeline visualization
- Data persistence via RERUM APIs
- Automated testing (unit tests for utilities)
- CI/CD pipeline for deployment
- Error monitoring and logging
- Documentation (README, CONTRIBUTING, API docs)

**Out of scope (initial):**
- User authentication and authorization
- Advanced analytics and reporting
- Multi-tenant deployment
- Extensive localization (i18n)
- Mobile-native application
- Offline support (PWA)

## Deliverables
1. **Working MVP:** All core genealogy features functional
2. **Test Suite:** Unit tests for utility functions and component logic
3. **CI/CD Pipeline:** GitHub Actions for testing and deployment
4. **Monitoring:** Error tracking and performance logging
5. **Documentation:** README, CONTRIBUTING, API documentation, user guide

## Milestones & Timeline
- **Week 0-1:** Infrastructure setup (tests, CI/CD, monitoring)
- **Week 2-3:** Code cleanup, bug fixes, documentation
- **Week 4:** User testing, feedback incorporation
- **Week 5:** Release candidate, deployment to production
- **Week 6:** Launch and retrospective

## Technical Stack
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3 — no build step
- **Components:** Custom Web Elements (`gl-*`), shaped by DEER v2's element conventions
- **Data Storage:** RERUM/TinyThings APIs (JSON-LD, Web Annotations); `?store=local|memory|fixture` for offline
- **Visualization:** hand-rolled SVG (`gl-tree-view`) and DOM rows (`gl-ancestor-timeline`) — no charting dependency
- **Testing:** Vitest (unit), Playwright (E2E + opt-in live devstore smoke)
- **CI/CD:** GitHub Actions
- **Monitoring:** page-level error banners; the v1 error logger was removed with the rest of DEER v1
- **Deployment:** GitHub Pages (static hosting)

## Risks & Mitigations
- **RERUM API dependency** — implement graceful degradation and offline fallbacks
- **Browser compatibility** — test across major browsers, use polyfills if needed
- **Data integrity** — validate all data inputs, implement backup strategies
- **Scope creep** — enforce backlog grooming and sprint scope

## Acceptance Criteria
- [ ] All core user journeys complete and tested
- [ ] Automated test coverage > 70% for utility functions
- [ ] CI/CD pipeline passes on all PRs
- [ ] Error monitoring captures and reports critical failures
- [ ] Documentation covers setup, usage, and contribution
- [ ] Deployment to staging with smoke tests passing

## Success Metrics
- Time-to-first-usable-feature < 5 minutes
- Defect rate in production < 5%
- User feedback score > 4/5 for MVP
- Test coverage > 70% for critical paths
- CI/CD pipeline success rate > 95%

## Next Steps
1. Set up test infrastructure (Jest, Playwright)
2. Create CI/CD pipeline (GitHub Actions)
3. Add error monitoring and logging utilities
4. Create comprehensive documentation
5. Fix existing code issues and improve code quality
