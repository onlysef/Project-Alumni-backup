const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  title:    { type: String, required: true },
  message:  { type: String, default: '' },
  is_read:  { type: Boolean, default: false },
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  type:     { type: String, default: 'event' },
}, { timestamps: true });

module.exports = mongoose.model('Notification', schema);
