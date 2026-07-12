// Lightweight structured logger for the AI assistant pipeline.
// Emits single-line JSON so logs stay greppable without adding a logging dependency.
function write(level, event, fields) {
  const entry = { level, event, ts: new Date().toISOString(), ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.log(line);
}

const logger = {
  info:  (event, fields = {}) => write('info', event, fields),
  warn:  (event, fields = {}) => write('warn', event, fields),
  error: (event, fields = {}) => write('error', event, {
    ...fields,
    error: fields.error instanceof Error ? fields.error.message : fields.error,
  }),
};

module.exports = logger;
