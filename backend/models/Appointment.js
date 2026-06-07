const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  alumni_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  alumni_name:      { type: String, required: true, trim: true },
  staff_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  appointment_date: { type: String, required: true },
  appointment_time: { type: String, required: true },
  purpose:          { type: String, default: '' },
  notes:            { type: String, default: '' },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'],
    default: 'Pending',
  },
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);
