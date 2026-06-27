const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: '' },
  image:          { type: String, default: '' },
  location:       { type: String, default: '' },
  event_datetime: { type: Date, required: true },
  end_datetime:   { type: Date, default: null },
  visibility:     {
    type: String,
    enum: ['Public', 'Private', 'CCS Alumni', 'All Alumni', 'CPAG', 'CCS', 'COS', 'CIT', 'COE', 'CBA', 'COED', 'CASS', 'CCJE', 'CAFA'],
    default: 'Public',
  },
  capacity:       { type: Number, default: 0 },
  created_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
