const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName:  { type: String, required: true },
  text:      { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const announcementSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, required: true },
  type:        { type: String, enum: ['News', 'Event', 'Career', 'Scholarship'], default: 'News' },
  imageUrl:    { type: String, default: '' },
  likedBy:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments:    [commentSchema],
  sharedBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Announcement', announcementSchema);
