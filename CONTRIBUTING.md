# Contributing to Genealogger

Thank you for your interest in contributing to Genealogger! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to foster an inclusive and welcoming community.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/cubap/Genealogger/issues)
2. If not, create a new issue with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots if applicable
   - Browser and OS information

### Suggesting Features

1. Check [Issues](https://github.com/cubap/Genealogger/issues) for existing feature requests
2. Create a new issue with:
   - Clear description of the feature
   - Use case and benefits
   - Potential implementation approach
   - Any relevant examples or references

### Submitting Code

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Write or update tests**
5. **Ensure all tests pass**:
   ```bash
   npm test
   npm run test:e2e
   ```
6. **Lint your code**:
   ```bash
   npm run lint
   ```
7. **Commit your changes** with a descriptive message
8. **Push to your fork**
9. **Submit a Pull Request**

## Development Guidelines

### Code Style

- **JavaScript**: ES6+ syntax, no frameworks
- **HTML**: Semantic HTML5 elements
- **CSS**: Mobile-first, responsive design
- **Components**: Web Components (custom elements)
- **Naming**: camelCase for variables/functions, PascalCase for classes/components

### File Structure

```
Genealogger/
├── css/              # Stylesheets
├── js/               # JavaScript modules
│   ├── components/   # Web components
│   └── utils/        # Utility functions
├── tests/            # Test files
│   ├── unit/         # Unit tests
│   └── e2e/          # E2E tests
├── *.html            # HTML pages
└── package.json      # Project configuration
```

### Web Components

When creating new web components:

1. Create a file in `js/components/` named `deer-[component-name].js`
2. Extend `HTMLElement`
3. Use `observedAttributes()` for reactive attributes
4. Implement `connectedCallback()` and `attributeChangedCallback()`
5. Register with `customElements.define()`
6. Import in `js/deer.js`

Example:
```javascript
class DeerMyComponent extends HTMLElement {
    static get observedAttributes() {
        return ['deer-id', 'deer-type']
    }

    connectedCallback() {
        // Initialization
    }

    attributeChangedCallback(name, oldValue, newValue) {
        // React to attribute changes
    }
}

customElements.define('deer-my-component', DeerMyComponent)
```

### Testing

- **Unit Tests**: Test utility functions and pure logic
- **E2E Tests**: Test user journeys and component interactions
- **Coverage**: Aim for >70% coverage on utility functions

Run tests:
```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests
```

### Error Handling

Use the `ErrorLogger` utility for consistent error logging:

```javascript
import logger from './js/utils/error-logger.js'

try {
    // Your code
} catch (error) {
    logger.log(error, { context: 'myFunction' }, 'high')
}
```

## Pull Request Process

1. **Update documentation** if needed
2. **Ensure tests pass** and coverage is maintained
3. **Self-review** your code
4. **Request review** from maintainers
5. **Address feedback** and iterate

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Maintenance tasks

Example:
```
feat: add ancestor timeline component

- Create deer-ancestor-timeline.js
- Add timeline visualization
- Include demo mode for testing
```

## Getting Help

- Open an issue for questions or problems
- Check existing documentation
- Review existing components for patterns

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
