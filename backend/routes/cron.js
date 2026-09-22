const express = require('express');
const router = express.Router();
const { runJobAlerts } = require('../services/jobAlertService');

// Vercel Cron Jobs send a GET request with this header set to the value
// configured in the project's env vars — without checking it, this route
// would be a public, unauthenticated way to trigger an alumni-wide email
// sweep on demand.
function verifyCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }
  next();
}

// GET /api/cron/job-alerts — daily Job Connect alert sweep, invoked by
// Vercel Cron (see vercel.json) since the in-process node-cron scheduler in
// server.js only runs under `node server.js`, never inside a serverless
// function.
router.get('/job-alerts', verifyCronSecret, async (req, res) => {
  try {
    const result = await runJobAlerts();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('cron job-alerts error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
