# Genealogger

A web-based genealogy application for creating, managing, and visualizing family relationships. Built with vanilla JavaScript and the DEER (Data Encoding and Exhibition for RERUM) framework, Genealogger provides an intuitive interface for building family trees and exploring ancestral timelines.

## Features

- **Person Management**: Create and manage family members with detailed information
- **Family Trees**: Interactive hierarchical visualization of family relationships
- **Ancestor Timelines**: Visual timeline showing ancestors across generations
- **Event Recording**: Record births, deaths, marriages, and other significant events
- **Relationship Mapping**: Define parent-child, spousal, and other family relationships
- **Data Persistence**: All data stored in RERUM (Research and Educational Digital Object Management)

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Components**: Custom Web Components (DEER framework)
- **Data Storage**: RERUM/TinyThings APIs (JSON-LD, Web Annotations)
- **Visualization**: D3.js for family trees and timelines
- **Testing**: Jest (unit tests), Playwright (E2E tests)
- **CI/CD**: GitHub Actions
- **Deployment**: GitHub Pages

## Getting Started

### Prerequisites

- Modern web browser with ES6+ support
- Internet connection (for RERUM API access)
- Node.js and npm (for development and testing)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/cubap/Genealogger.git
   cd Genealogger
   ```

2. Install dependencies (for testing):
   ```bash
   npm install
   ```

3. Open `index.html` in your browser or run a local server:
   ```bash
   npm run serve
   ```

4. Navigate to `http://localhost:8080`

### Development

- **Run tests**: `npm test`
- **Run E2E tests**: `npm run test:e2e`
- **Lint code**: `npm run lint`
- **Start local server**: `npm run serve`

## Usage

### Creating a New Person

1. Navigate to the main page
2. Click "New Person" or go to `person.html`
3. Enter the person's name and details
4. The person will be saved to RERUM

### Adding Family Relationships

1. Go to a person's profile page
2. Use the action buttons to:
   - Add birth information
   - Add death information
   - Add parents
   - Add children
   - Add spouses

### Viewing Family Trees

1. Navigate to `tree.html`
2. Select a person to view their family tree
3. The tree will display ancestors and descendants interactively

### Viewing Ancestor Timelines

1. Navigate to `timeline.html`
2. Select a person to view their ancestor timeline
3. The timeline shows ancestors across generations with birth/death dates

## Project Structure

```
Genealogger/
├── css/
│   └── site.css              # Main stylesheet
├── js/
│   ├── deer.js               # DEER framework integration
│   ├── deer-config.js        # DEER configuration
│   ├── deer-render.js        # DEER rendering utilities
│   ├── deer-record.js        # DEER data recording
│   ├── components/           # Custom web components
│   │   ├── deer-person.js
│   │   ├── deer-tree.js
│   │   ├── deer-timeline.js
│   │   └── ...
│   └── utils/                # Utility functions
│       ├── data-utils.js
│       ├── string-utils.js
│       ├── dom-utils.js
│       └── error-logger.js
├── tests/                    # Test files
│   ├── unit/                 # Unit tests
│   └── e2e/                  # E2E tests
├── .github/workflows/        # CI/CD pipelines
│   └── ci-cd.yml
├── index.html                # Main page
├── person.html               # Person profile page
├── tree.html                 # Family tree visualization
├── timeline.html             # Ancestor timeline
├── package.json              # Project configuration
└── README.md                 # This file
```

## API Documentation

### RERUM API Endpoints

- **Create**: `https://tinydev.rerum.io/create`
- **Update**: `https://tinydev.rerum.io/update`
- **Query**: `https://tinydev.rerum.io/query`
- **Overwrite**: `https://tinydev.rerum.io/overwrite`

### Data Format

All data follows JSON-LD (Linked Data) standards with Web Annotation specifications.

Example Person object:
```json
{
  "@type": "Person",
  "name": "John Doe",
  "familyName": "Doe",
  "givenName": "John",
  "hasFather": "https://devstore.rerum.io/v1/id/...",
  "hasMother": "https://devstore.rerum.io/v1/id/..."
}
```

## Testing

### Unit Tests

Run unit tests with Jest:
```bash
npm test
```

Tests are located in `tests/unit/` and cover utility functions and core logic.

### E2E Tests

Run end-to-end tests with Playwright:
```bash
npm run test:e2e
```

E2E tests are located in `tests/e2e/` and test user journeys across the application.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Ensure all tests pass
6. Submit a pull request

### Code Style

- ES6+ JavaScript
- No external frameworks (vanilla JS only)
- Web Components for modular UI
- Semantic HTML5
- Mobile-first responsive design

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [DEER Framework](https://github.com/CenterForDigitalHumanities/deer) - Data Encoding and Exhibition for RERUM
- [RERUM](https://rerum.io/) - Research and Educational Digital Object Management
- [D3.js](https://d3js.org/) - Data-driven documents visualization

## Contact

- Author: cubap
- Repository: [github.com/cubap/Genealogger](https://github.com/cubap/Genealogger)

## Roadmap

- [ ] User authentication and authorization
- [ ] Advanced search and filtering
- [ ] Export family data (GEDCOM format)
- [ ] Mobile-native application
- [ ] Offline support (PWA)
- [ ] Multi-language support (i18n)
- [ ] Advanced analytics and reporting
