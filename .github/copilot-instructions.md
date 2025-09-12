# Genealogger

Genealogger is a client-side JavaScript web application built with the DEER (Data Encoding and Exhibition for RERUM) framework for managing genealogical data. It's a static web application that connects to external RERUM services for data storage and uses ES6 modules with custom web components.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Run the Application
- **CRITICAL**: No build process is required. This is a static web application served directly from files.
- Start the development server:
  - `cd /home/runner/work/Genealogger/Genealogger`
  - `python3 -m http.server 8080` -- starts immediately (< 5 seconds). Server runs in background.
- Access the application:
  - Open browser to `http://localhost:8080`
  - Application loads homepage with person list and "New Person" button
  - Navigation works between pages: index.html, person.html, birth.html, death.html, etc.

### External Dependencies (IMPORTANT)
- **D3.js Library**: Loaded from `https://cdn.jsdelivr.net/npm/d3@7/+esm`
- **RERUM APIs**: Data storage services at `tinydev.rerum.io` and `devstore.rerum.io`
- **Network Access Required**: Application has limited functionality when external services are blocked
- **Expected Behavior**: Console errors about blocked CDN resources are normal in restricted environments

### No Build Process
- **DO NOT run `npm install`** - No dependencies in package.json need installation
- **DO NOT run `npm run build`** - No build process exists or is needed
- **DO NOT run `npm start`** - Use Python HTTP server instead
- Files are served directly without compilation or bundling

### Testing
- **Manual Testing**: Always test through browser after making changes
- **No Automated Tests**: package.json only has placeholder test script
- **Functional Validation**: Test forms, navigation, and data entry workflows
- **NEVER CANCEL**: Allow full page load times (5-10 seconds) for external dependencies

## Validation

### Core User Scenarios
Always manually validate these scenarios after making changes:
1. **Homepage Load**: Navigate to `http://localhost:8080` and verify person list area and "New Person" button display
2. **Navigation**: Click "New Person" button and verify navigation to person.html page
3. **Form Functionality**: Navigate to birth.html and test form fields (Given Name, Family Name, etc.)
4. **Data Entry**: Fill out birth form fields and verify input accepts text
5. **Page Linking**: Test "home" links on all pages return to index.html

### Expected Application Behavior
- **Homepage**: Shows "loading..." message and "New Person" button
- **Person Page**: May show minimal content due to external API dependencies
- **Birth Form**: Fully functional with all form fields working
- **Form Fields**: Text inputs, date picker, gender dropdown all functional
- **Network Dependencies**: Some features require external RERUM APIs

### Browser Testing Requirements
- Always test in browser after code changes
- Take screenshots of UI changes to verify visual functionality
- Test form field interactions manually
- Verify navigation between all HTML pages works

## Common Tasks

### Starting Development Server
```bash
cd /home/runner/work/Genealogger/Genealogger
python3 -m http.server 8080
# Server starts immediately, runs in background
# Access at http://localhost:8080
```

### Repository Structure
```
/home/runner/work/Genealogger/Genealogger/
├── index.html          # Homepage with person list
├── person.html         # Person detail/creation page
├── birth.html          # Birth event form (fully functional)
├── death.html          # Death event form
├── parents.html        # Parent relationship form
├── label.html          # Label/tagging page
├── timeline.html       # Timeline view
├── tree.html           # Family tree view
├── css/
│   └── site.css        # Main stylesheet
├── js/
│   ├── deer.js         # Main DEER framework entry point
│   ├── deer-config.js  # Configuration (API URLs, settings)
│   ├── deer-render.js  # Rendering engine (uses D3.js)
│   ├── deer-record.js  # Data recording/saving
│   ├── deer-utils.js   # Utility functions
│   ├── components/     # 15+ custom web components
│   └── utils/          # Data, DOM, and string utilities
└── package.json        # Minimal package info (no dependencies)
```

### Key Components (15 custom web components)
- `deer-entity`: Person entity display
- `deer-list`: Person list display
- `deer-person`: Person detail component
- `deer-event`: Event display component
- `deer-typeahead-filter`: Search/filter component
- `deer-nickname-editor`: Name editing component
- `deer-tree`: Family tree visualization
- `deer-svg-tree`: SVG-based tree display
- `deer-timeline`: Event timeline component
- And 6 more in js/components/

### File Information Reference
```bash
# Repository root contents
ls -la /home/runner/work/Genealogger/Genealogger/
# Shows: HTML pages, css/, js/, package.json, .git*, no build files

# JavaScript components
ls -la /home/runner/work/Genealogger/Genealogger/js/components/
# Shows: 15 deer-*.js custom web component files

# Utility modules  
ls -la /home/runner/work/Genealogger/Genealogger/js/utils/
# Shows: data-utils.js, dom-utils.js, string-utils.js
```

### package.json content
```json
{
    "name": "genealogger",
    "version": "1.0.0",
    "description": "A quick demonstration of the way Eventities can be used in family relationships to emulate genealogical software",
    "license": "Proprietary",
    "keywords": ["util", "functional", "server", "client", "browser"],
    "author": "cubap",
    "dependencies": {},
    "scripts": {
        "test": "echo 'No tests specified yet'"
    }
}
```

## Technical Architecture

### DEER Framework
- **Custom Web Components**: Uses deer-* prefixed custom elements
- **External APIs**: Connects to RERUM (tinydev.rerum.io, devstore.rerum.io) for data storage
- **ES6 Modules**: Uses modern JavaScript module imports
- **No Framework Dependencies**: Pure JavaScript with custom component system

### Development Notes
- **Static Serving**: All files served directly without compilation
- **Module System**: ES6 imports work directly in modern browsers
- **External Dependencies**: D3.js for visualizations, RERUM APIs for data
- **No Backend**: Client-side only application
- **Cross-Platform**: Works with any static web server (Python, Node.js, Apache, nginx)

### Debugging
- **Console Errors Expected**: CDN and API blocking errors are normal in restricted environments
- **Network Tab**: Check browser network tab for failed external requests
- **Form Testing**: Birth form is most reliable for testing functionality
- **Local Files**: All local JavaScript and CSS files load successfully

### Making Changes
- **Edit Files Directly**: No build step required
- **Refresh Browser**: Changes visible immediately after browser refresh
- **Test Locally**: Always use Python HTTP server for development
- **Form Fields**: birth.html provides best testing interface for changes

## Important Limitations
- **External API Dependency**: Full functionality requires internet access to RERUM services
- **CDN Dependencies**: D3.js visualizations require CDN access
- **No Offline Mode**: Limited functionality when external services unavailable
- **Development Environment**: Best tested with unrestricted internet access
- **Expected Errors**: Console errors for blocked external resources are normal