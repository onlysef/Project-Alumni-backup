require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const usersCol      = db.collection('users');
  const employmentCol = db.collection('alumniemployments');
  const tracerCol     = db.collection('tracerstudyresponses');

  // Get all valid user IDs
  const users = await usersCol.find({}, { projection: { _id: 1 } }).toArray();
  const validIds = new Set(users.map((u) => u._id.toString()));

  // Find and delete orphaned AlumniEmployment records
  const empRecords = await employmentCol.find({}, { projection: { _id: 1, alumni_id: 1 } }).toArray();
  const orphanEmpIds = empRecords
    .filter((r) => !validIds.has(r.alumni_id?.toString()))
    .map((r) => r._id);

  if (orphanEmpIds.length) {
    await employmentCol.deleteMany({ _id: { $in: orphanEmpIds } });
    console.log(`Deleted ${orphanEmpIds.length} orphaned AlumniEmployment record(s).`);
  } else {
    console.log('No orphaned AlumniEmployment records found.');
  }

  // Find and delete orphaned TracerStudyResponse records
  const tracerRecords = await tracerCol.find({}, { projection: { _id: 1, alumni_id: 1 } }).toArray();
  const orphanTracerIds = tracerRecords
    .filter((r) => !validIds.has(r.alumni_id?.toString()))
    .map((r) => r._id);

  if (orphanTracerIds.length) {
    await tracerCol.deleteMany({ _id: { $in: orphanTracerIds } });
    console.log(`Deleted ${orphanTracerIds.length} orphaned TracerStudyResponse record(s).`);
  } else {
    console.log('No orphaned TracerStudyResponse records found.');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
