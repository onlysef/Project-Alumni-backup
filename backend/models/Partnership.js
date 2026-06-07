const mongoose = require('mongoose');

const partnershipSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  type:             { type: String, enum: ['Industry', 'Academe', 'Government', 'NGO'], required: true },
  contact:          { type: String, required: true, trim: true },
  status:      { type: String, enum: ['Active', 'Pending', 'Archived'], default: 'Pending' },
  description: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Partnership', partnershipSchema);
