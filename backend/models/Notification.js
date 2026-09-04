const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  title:    { type: String, required: true },
  message:  { type: String, default: '' },
  is_read:  { type: Boolean, default: false },
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  type:     { type: String, default: 'event' },
  // Optional explicit client destination for notification types that cannot
  // be derived from event_id/type alone. Only same-app paths are accepted by
  // the frontend.
  target_url: { type: String, default: '' },
}, { timestamps: true });

// Every unread-badge/list query filters on these two together.
schema.index({ user_id: 1, is_read: 1 });

module.exports = mongoose.model('Notification', schema);
