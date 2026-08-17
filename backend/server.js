const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cron = require('node-cron');
const connectDB = require('./config/db');
const { runJobAlerts } = require('./services/jobAlertService');
const authRoutes        = require('./routes/auth');
const adminRoutes       = require('./routes/admin');
const alumniRoutes      = require('./routes/alumni');
const employerRoutes    = require('./routes/employer');
const coordinatorRoutes = require('./routes/coordinator');
const aiRoutes          = require('./routes/ai');

connectDB();

const app = express();

// Deployed behind Vercel's proxy — without this, express-rate-limit can't
// tell one visitor's IP from another (everyone looks like the proxy) and
// refuses to start in production.
app.set('trust proxy', 1);

// Standard hardening (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
// — this API never serves HTML itself, so the default CSP is a no-op in
// practice, but the rest closes a real defense-in-depth gap for the HTML-
// injection surfaces elsewhere in the app (emailService.js) and stops this
// origin from being framed.
app.use(helmet());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));
// Several endpoints embed images as base64 data URIs directly in the JSON
// response (announcements, events, avatars) instead of serving them as
// separate files — gzip cuts those payloads down significantly in transit.
app.use(compression());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth',        authRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/alumni',      alumniRoutes);
app.use('/api/employer',    employerRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/ai',          aiRoutes);


app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Alumni Portal API is running.' });
});

// Return JSON for all errors (prevents HTML body-parser errors from breaking res.json() on the client)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error('Unhandled error:', err);
  // A 4xx here is always a deliberate, safe, user-facing message (CORS
  // rejection above, a malformed-body error from express.json, etc.) — a
  // 500 means something genuinely unexpected happened (a Mongoose
  // CastError/ValidationError from a route with no try/catch, a third-
  // party library throwing), and nothing guarantees its raw .message is
  // safe to hand to an API consumer. Every controller already catches its
  // own errors and returns its own safe message, so this only changes
  // behavior for the unhandled case this comment describes.
  const exposeMessage = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({ message: exposeMessage ? (err.message || 'Internal server error.') : 'Internal server error.' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Daily Job Connect alert sweep, 8:00 AM Manila time.
    cron.schedule('0 8 * * *', () => {
      runJobAlerts().catch((err) => console.error('runJobAlerts failed:', err));
    }, { timezone: 'Asia/Manila' });
  });
}

module.exports = app;
