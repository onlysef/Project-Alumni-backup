const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  user_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_name:          { type: String, required: true },
  action:             { type: String, enum: ['liked', 'commented on', 'shared'], required: true },
  announcement_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement' },
  announcement_title: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
