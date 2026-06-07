const mongoose = require('mongoose');

const officeSettingsSchema = new mongoose.Schema({
  office_status: { type: String, enum: ['Open', 'Closed'], default: 'Open' },
  start_time:    { type: String, default: '08:00' },
  end_time:      { type: String, default: '17:00' },
  working_days:  [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('OfficeSettings', officeSettingsSchema);
