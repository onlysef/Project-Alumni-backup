const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Partnership = require('../models/Partnership');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const employers = await User.find({ role: 'employer' }).lean();
  console.log(`Found ${employers.length} employer account(s).`);

  let created = 0;
  for (const emp of employers) {
    const email = emp.email;
    const existing = await Partnership.findOne({ contact: email });
    if (existing) {
      console.log(`  SKIP  ${email} — partnership record already exists (${existing.name})`);
      continue;
    }
    const name = emp.company?.trim() || `${emp.firstName} ${emp.lastName}`.trim();
    await Partnership.create({
      name,
      type: 'Industry',
      contact: email,
      status: 'Pending',
    });
    console.log(`  CREATED  Partnership for "${name}" <${email}>`);
    created++;
  }

  console.log(`\nDone. Created ${created} missing partnership record(s).`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
