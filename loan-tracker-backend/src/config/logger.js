import winston from 'winston';

// Application-wide logger instance. Import this anywhere logging is needed
// instead of using console.* so output is consistent and centrally configured.
const logger = winston.createLogger({
  // Minimum severity to record. Quieter in production (drops `debug`),
  // fully verbose everywhere else for easier local debugging.
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

  // Default format applied to transports that don't define their own:
  // attach a timestamp, then emit each entry as structured JSON
  // (machine-readable for log aggregators / parsing).
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),

  // Destinations each log entry is written to.
  transports: [
    // Terminal output: colorized, human-readable single lines.
    // This overrides the JSON format above (so console lines have no timestamp).
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),

    // Persist only error-level entries to error.log for quick failure triage.
    new winston.transports.File({ filename: 'error.log', level: 'error' }),

    // Persist all entries (at the configured level) to combined.log.
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

export default logger;