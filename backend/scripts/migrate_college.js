/**
 * One-time migration: set college = 'CCS' for all alumni whose course
 * is BSIT, BSCS, or BSIS and who have no college set yet.
 *
 * Run from the backend/ directory:
 *   node scripts/migrate_college.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User     = require('../models/User');

const CCS_COURSES = ['BSIT', 'BSCS', 'BSIS'];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const result = await User.updateMany(
    {
      role:    'alumni',
      course:  { $in: CCS_COURSES },
      $or: [{ college: { $exists: false } }, { college: '' }],
    },
    { $set: { college: 'CCS' } }
  );

  console.log(`Updated ${result.modifiedCount} alumni record(s) → college = 'CCS'.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
