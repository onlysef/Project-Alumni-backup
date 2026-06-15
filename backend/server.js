const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes     = require('./routes/auth');
const adminRoutes    = require('./routes/admin');
const alumniRoutes   = require('./routes/alumni');
const employerRoutes = require('./routes/employer');

connectDB();

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://project-alumni-frontend.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
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
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth',     authRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/alumni',   alumniRoutes);
app.use('/api/employer', employerRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Alumni Portal API is running.' });
});

// Return JSON for all errors (prevents HTML body-parser errors from breaking res.json() on the client)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: err.message || 'Internal server error.' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
