const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, required: true },
  type:        { type: String, enum: ['News', 'Event', 'Career', 'Scholarship'], default: 'News' },
  imageUrl:    { type: String, default: '' },
  likes:       { type: Number, default: 0 },
  comments:    { type: Number, default: 0 },
  shares:      { type: Number, default: 0 },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Announcement', announcementSchema);
