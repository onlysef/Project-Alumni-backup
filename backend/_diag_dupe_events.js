require('dotenv').config();
const mongoose = require('mongoose');
const Event = require('./models/Event');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const events = await Event.find({}).select('title college event_datetime updatedAt createdAt').lean();
  const byTitle = {};
  events.forEach(e => { (byTitle[e.title] ||= []).push(e); });
  const dupes = Object.entries(byTitle).filter(([, list]) => list.length > 1);
  console.log('Total events:', events.length);
  console.log('Duplicate-titled groups:', dupes.length);
  dupes.forEach(([title, list]) => {
    console.log('---', title, '---');
    list.forEach(e => console.log(' ', e._id.toString(), '| college:', e.college, '| datetime:', e.event_datetime, '| updatedAt:', e.updatedAt));
  });
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
