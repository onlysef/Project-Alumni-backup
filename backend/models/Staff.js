const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  role:    { type: String, required: true, trim: true },
  email:   { type: String, trim: true, lowercase: true, default: '' },
  status:  { type: String, enum: ['Available', 'Busy', 'On Leave', 'Inactive'], default: 'Available' },
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Staff', staffSchema);
