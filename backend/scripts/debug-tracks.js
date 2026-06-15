require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // 1. Show all collection names
  const cols = await db.listCollections().toArray();
  console.log('Collections:', cols.map(c => c.name).join(', '));

  // 2. Count BSIT users
  const bsitUsers = await db.collection('users').find({ course: 'BSIT' }).toArray();
  console.log('\nBSIT users:', bsitUsers.length);
  bsitUsers.forEach(u => console.log(' -', u._id, u.firstName, u.lastName, '| track:', u.track));

  // 3. Count AlumniEmployment records for those BSIT users
  const bsitIds = bsitUsers.map(u => u._id);
  const empRecords = await db.collection('alumniemployments').find({ alumni_id: { $in: bsitIds } }).toArray();
  console.log('\nAlumniEmployment records for BSIT:', empRecords.length);

  // 4. Check TracerStudyResponse for those BSIT users
  const tracerName = cols.find(c => c.name.includes('tracer') && c.name.includes('response'))?.name;
  console.log('\nTracer collection name:', tracerName);
  if (tracerName) {
    const tracers = await db.collection(tracerName).find({ alumni_id: { $in: bsitIds } }).toArray();
    console.log('Tracer responses for BSIT users:', tracers.length);
    tracers.forEach(t => console.log(' -', t.alumni_id, '| programsCompleted:', JSON.stringify(t.programsCompleted)));
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
