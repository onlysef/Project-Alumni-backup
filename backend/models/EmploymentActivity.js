const mongoose = require('mongoose');

const employmentActivitySchema = new mongoose.Schema({
  user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_name: { type: String, required: true },
  action: {
    type: String,
    enum: [
      'updated employment status',
      'updated personal information',
      'added achievements',
      'exported employment list',
      'printed employment record',
      'edited tracer form',
      'added to employment details',
    ],
    required: true,
  },
  target_name: { type: String, default: '' },
  details:     { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('EmploymentActivity', employmentActivitySchema);
