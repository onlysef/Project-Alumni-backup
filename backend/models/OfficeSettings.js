const mongoose = require('mongoose');

const officeSettingsSchema = new mongoose.Schema({
  office_status: { type: String, enum: ['Open', 'Closed'], default: 'Open' },
  start_time:    { type: String, default: '08:00' },
  end_time:      { type: String, default: '17:00' },
  working_days:  [{ type: String }],
  // Specific one-off dates (e.g. public holidays, university-declared
  // suspensions) the office is closed on, on top of the recurring weekly
  // working_days schedule above. Stored as "YYYY-MM-DD" strings so they
  // compare directly against Appointment.appointment_date without timezone
  // conversion — see createAppointmentRecord in appointmentController.js.
  holidays: [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('OfficeSettings', officeSettingsSchema);
