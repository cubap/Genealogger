/**
 * Error Logger Utility
 * Provides centralized error logging and monitoring for Genealogger
 * 
 * Features:
 * - Structured error logging with context
 * - Error categorization and severity levels
 * - Optional Sentry integration
 * - Performance monitoring
 * - User action tracking
 */

class ErrorLogger {
    constructor(options = {}) {
        this.sentryDSN = options.sentryDSN || null
        this.environment = options.environment || 'development'
        this.appName = options.appName || 'genealogger'
        this.maxErrors = options.maxErrors || 100
        this.errors = []
        this.performanceEntries = []
        
        // Initialize Sentry if DSN is provided
        if (this.sentryDSN && typeof window !== 'undefined') {
            this.initSentry()
        }
    }

    /**
     * Log an error with context
     * @param {Error|string} error - Error object or error message
     * @param {Object} context - Additional context about the error
     * @param {string} severity - Error severity: 'low', 'medium', 'high', 'critical'
     */
    log(error, context = {}, severity = 'medium') {
        const errorObj = {
            timestamp: new Date().toISOString(),
            message: error.message || error.toString(),
            stack: error.stack || new Error().stack,
            severity,
            context,
            environment: this.environment,
            appName: this.appName,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
            url: typeof window !== 'undefined' ? window.location.href : 'unknown'
        }

        // Store error locally
        this.errors.push(errorObj)
        if (this.errors.length > this.maxErrors) {
            this.errors.shift()
        }

        // Log to console
        const logMethod = severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info'
        console[logMethod](`[${severity.toUpperCase()}] ${errorObj.message}`, errorObj)

        // Send to Sentry if configured
        if (this.sentryDSN && window.Sentry) {
            window.Sentry.captureException(error, {
                contexts: { error: errorObj },
                level: severity
            })
        }

        return errorObj
    }

    /**
     * Log a warning
     * @param {string} message - Warning message
     * @param {Object} context - Additional context
     */
    warn(message, context = {}) {
        this.log(message, context, 'medium')
    }

    /**
     * Log an informational message
     * @param {string} message - Info message
     * @param {Object} context - Additional context
     */
    info(message, context = {}) {
        this.log(message, context, 'low')
    }

    /**
     * Log a critical error
     * @param {Error|string} error - Error object or message
     * @param {Object} context - Additional context
     */
    critical(error, context = {}) {
        this.log(error, context, 'critical')
    }

    /**
     * Track a user action
     * @param {string} action - Action name
     * @param {Object} data - Action data
     */
    trackAction(action, data = {}) {
        const actionObj = {
            timestamp: new Date().toISOString(),
            action,
            data,
            url: typeof window !== 'undefined' ? window.location.href : 'unknown'
        }

        console.log(`[ACTION] ${action}`, actionObj)

        // Send to analytics service if configured
        if (this.sentryDSN && window.Sentry) {
            window.Sentry.addBreadcrumb({
                category: 'action',
                message: action,
                data,
                level: 'info'
            })
        }
    }

    /**
     * Measure performance of an operation
     * @param {string} name - Operation name
     * @param {Function} fn - Function to measure
     * @returns {Promise<*>} Result of the function
     */
    async measure(name, fn) {
        const start = performance.now()
        try {
            const result = await fn()
            const end = performance.now()
            const duration = end - start
            
            this.performanceEntries.push({
                name,
                duration,
                timestamp: new Date().toISOString(),
                status: 'success'
            })

            console.log(`[PERF] ${name}: ${duration.toFixed(2)}ms`)
            return result
        } catch (error) {
            const end = performance.now()
            const duration = end - start
            
            this.performanceEntries.push({
                name,
                duration,
                timestamp: new Date().toISOString(),
                status: 'error',
                error: error.message
            })

            this.log(`Performance error in ${name}: ${error.message}`, { duration }, 'high')
            throw error
        }
    }

    /**
     * Get recent errors
     * @param {number} count - Number of recent errors to retrieve
     * @returns {Array} Array of error objects
     */
    getRecentErrors(count = 10) {
        return this.errors.slice(-count)
    }

    /**
     * Get performance entries
     * @returns {Array} Array of performance entries
     */
    getPerformanceEntries() {
        return this.performanceEntries
    }

    /**
     * Initialize Sentry integration
     */
    initSentry() {
        if (typeof window !== 'undefined' && !window.Sentry) {
            // Load Sentry SDK dynamically
            const script = document.createElement('script')
            script.src = 'https://browser.sentry-cdn.com/7.45.0/bundle.min.js'
            script.onload = () => {
                window.Sentry.init({
                    dsn: this.sentryDSN,
                    environment: this.environment,
                    release: this.appName,
                    tracesSampleRate: 1.0
                })
            }
            document.head.appendChild(script)
        }
    }

    /**
     * Setup global error handlers
     */
    setupGlobalHandlers() {
        if (typeof window === 'undefined') return

        // Handle uncaught errors
        window.addEventListener('error', (event) => {
            this.critical(event.error || event.message, {
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            })
        })

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.critical(event.reason, {
                promise: event.promise
            })
        })

        // Handle network errors
        window.addEventListener('online', () => {
            this.info('Network connection restored')
        })

        window.addEventListener('offline', () => {
            this.warn('Network connection lost')
        })
    }
}

// Create singleton instance
const logger = new ErrorLogger({
    environment: 'production',
    appName: 'genealogger'
})

// Setup global error handlers
logger.setupGlobalHandlers()

// Export for use in other modules
export { ErrorLogger, logger }
export default logger
