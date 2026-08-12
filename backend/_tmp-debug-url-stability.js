require('dotenv').config();
const mongoose = require('mongoose');
const SavedJob = require('./models/SavedJob');
const careerjetService = require('./services/careerjetService');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const saved = await SavedJob.findOne({ title: /QA Engineer.*Power BI/i }).lean();
  if (!saved) { console.log('No matching saved job found in DB.'); process.exit(0); }
  console.log('SAVED IN DB:');
  console.log('  title:', saved.title, '| company:', saved.company);
  console.log('  url:', saved.url);
  console.log('  savedAt:', saved.createdAt);
  console.log();

  const data = await careerjetService.searchJobs({
    keywords: 'Software Engineer', location: '', page: 1, pagesize: 50, sort: 'date',
    userIp: '136.158.116.177', userAgent: 'Mozilla/5.0',
    referrerUrl: 'https://project-alumni-frontend.vercel.app/alumni/job-connect',
  });
  const match = (data.jobs || []).find((j) => j.title === saved.title && j.company === saved.company);
  console.log('FRESH FETCH RESULT for same title+company:');
  if (!match) {
    console.log('  NOT FOUND in current fresh fetch at all (fell out of the date-sorted top 50).');
  } else {
    console.log('  url:', match.url);
    console.log('  date:', match.date);
    console.log('  URL MATCHES SAVED ONE:', match.url === saved.url);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => { console.error('Test failed:', err); process.exit(1); });
