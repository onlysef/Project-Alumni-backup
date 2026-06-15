require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const emp = db.collection('alumniemployments');

  const result = await emp.aggregate([
    { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
    { $match: { '_user.0': { $exists: true } } },
    { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
    { $match: { '_u.course': 'BSIT' } },
    { $lookup: { from: 'tracerstudyresponses', localField: 'alumni_id', foreignField: 'alumni_id', as: '_tracer' } },
    { $addFields: { _t: { $arrayElemAt: ['$_tracer', 0] } } },
    {
      $addFields: {
        _track: {
          $let: {
            vars: {
              progStr: {
                $toLower: {
                  $reduce: {
                    input: { $ifNull: ['$_t.programsCompleted', []] },
                    initialValue: '',
                    in: { $concat: ['$$value', ' ', '$$this'] },
                  },
                },
              },
            },
            in: {
              $switch: {
                branches: [
                  { case: { $gt: [{ $indexOfCP: ['$$progStr', 'network administration'] },       -1] }, then: 'NA'  },
                  { case: { $gt: [{ $indexOfCP: ['$$progStr', 'web and mobile'] },               -1] }, then: 'WMA' },
                  { case: { $gt: [{ $indexOfCP: ['$$progStr', 'technical service management'] }, -1] }, then: 'TSM' },
                ],
                default: '',
              },
            },
          },
        },
      },
    },
    { $project: { '_u.firstName': 1, _track: 1, employment_status: 1 } },
  ]).toArray();

  console.log('Full pipeline result:');
  result.forEach(d => console.log(' -', d._u?.firstName, '| track:', d._track, '| status:', d.employment_status));

  const matched = result.filter(d => ['TSM','WMA','NA'].includes(d._track));
  console.log('\nMatched with track:', matched.length);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
