const OfficeSettings = require('../models/OfficeSettings');
const Staff          = require('../models/Staff');
const Appointment    = require('../models/Appointment');
const User           = require('../models/User');

function toMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Day labels aligned with JS Date.getDay(): 0=Sun, 1=Mon, ..., 6=Sat
// Sunday is intentionally null — the office day picker has no Sunday option.
const JS_DAY_TO_LABEL = [null, 'M', 'T', 'W', 'TH', 'F', 'S'];

// ============ OFFICE SETTINGS ============

// GET /api/admin/appointments/settings
const getOfficeSettings = async (req, res) => {
  try {
    let settings = await OfficeSettings.findOne();
    if (!settings) {
      settings = await OfficeSettings.create({
        office_status: 'Open',
        start_time:    '08:00',
        end_time:      '17:00',
        working_days:  ['M', 'W', 'F'],
      });
    }
    res.json({ settings });
  } catch (err) {
    console.error('getOfficeSettings error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/appointments/settings
const updateOfficeSettings = async (req, res) => {
  try {
    const { office_status, start_time, end_time, working_days } = req.body;
    let settings = await OfficeSettings.findOne();
    if (!settings) settings = new OfficeSettings();

    if (office_status !== undefined) settings.office_status = office_status;
    if (start_time    !== undefined) settings.start_time    = start_time;
    if (end_time      !== undefined) settings.end_time      = end_time;
    if (working_days  !== undefined) settings.working_days  = working_days;

    await settings.save();
    res.json({ message: 'Office settings saved.', settings });
  } catch (err) {
    console.error('updateOfficeSettings error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ============ STAFF ============

// GET /api/admin/appointments/staff
const getStaff = async (req, res) => {
  try {
    const staff = await Staff.find({ deleted: false }).sort({ createdAt: -1 });
    res.json({ staff });
  } catch (err) {
    console.error('getStaff error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/appointments/staff
const createStaff = async (req, res) => {
  try {
    const { name, role, email, status } = req.body;
    if (!name || !role) return res.status(400).json({ message: 'Name and role are required.' });

    const staff = await Staff.create({
      name:   name.trim(),
      role:   role.trim(),
      email:  email  ? email.trim()  : '',
      status: status || 'Available',
    });
    res.status(201).json({ message: 'Staff member added.', staff });
  } catch (err) {
    console.error('createStaff error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/appointments/staff/:id
const updateStaff = async (req, res) => {
  try {
    const { name, role, email, status } = req.body;
    const updates = {};
    if (name   !== undefined) updates.name   = name.trim();
    if (role   !== undefined) updates.role   = role.trim();
    if (email  !== undefined) updates.email  = email.trim();
    if (status !== undefined) updates.status = status;

    const staff = await Staff.findOneAndUpdate(
      { _id: req.params.id, deleted: false },
      updates,
      { new: true, runValidators: true }
    );
    if (!staff) return res.status(404).json({ message: 'Staff member not found.' });
    res.json({ message: 'Staff member updated.', staff });
  } catch (err) {
    console.error('updateStaff error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/appointments/staff/:id  — soft delete
const deleteStaff = async (req, res) => {
  try {
    const staff = await Staff.findOneAndUpdate(
      { _id: req.params.id, deleted: false },
      { deleted: true, status: 'Unavailable' },
      { new: true }
    );
    if (!staff) return res.status(404).json({ message: 'Staff member not found.' });
    res.json({ message: `${staff.name} removed from staff.` });
  } catch (err) {
    console.error('deleteStaff error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ============ APPOINTMENTS ============

// GET /api/admin/appointments  (supports ?search=&status=&staff_id=&date=)
const getAppointments = async (req, res) => {
  try {
    const { search, status, staff_id, date } = req.query;
    const query = {};
    if (status)   query.status           = status;
    if (staff_id) query.staff_id         = staff_id;
    if (date)     query.appointment_date = date;
    if (search)   query.alumni_name      = { $regex: search, $options: 'i' };

    const appointments = await Appointment.find(query)
      .populate('staff_id',  'name role status')
      .populate('alumni_id', 'firstName lastName email')
      .sort({ appointment_date: -1, appointment_time: -1 });

    res.json({ appointments });
  } catch (err) {
    console.error('getAppointments error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/appointments
const createAppointment = async (req, res) => {
  try {
    const { alumni_id, alumni_name, staff_id, appointment_date, appointment_time, purpose, notes } = req.body;

    if (!alumni_name || !staff_id || !appointment_date || !appointment_time) {
      return res.status(400).json({ message: 'Alumni name, staff, date, and time are required.' });
    }

    const staff = await Staff.findOne({ _id: staff_id, deleted: false });
    if (!staff) return res.status(404).json({ message: 'Selected staff member not found.' });

    const settings = await OfficeSettings.findOne();
    if (settings) {
      if (settings.office_status === 'Closed') {
        return res.status(400).json({ message: 'The office is currently closed. Appointments cannot be booked.' });
      }

      const [year, month, day] = appointment_date.split('-').map(Number);
      const dateObj        = new Date(year, month - 1, day);
      const appointmentDay = JS_DAY_TO_LABEL[dateObj.getDay()];

      if (!appointmentDay || !settings.working_days.includes(appointmentDay)) {
        const dayList = settings.working_days.join(', ') || 'none';
        return res.status(400).json({
          message: `Appointments are not available on this day. Working days: ${dayList}.`,
        });
      }

      const apptMin  = toMinutes(appointment_time);
      const startMin = toMinutes(settings.start_time);
      const endMin   = toMinutes(settings.end_time);
      if (apptMin < startMin || apptMin >= endMin) {
        return res.status(400).json({
          message: `Appointment time must be within office hours (${settings.start_time}–${settings.end_time}).`,
        });
      }
    }

    // Prevent double-booking the same staff at the same date + time
    const conflict = await Appointment.findOne({
      staff_id,
      appointment_date,
      appointment_time,
      status: { $nin: ['Rejected', 'Cancelled'] },
    });
    if (conflict) {
      return res.status(409).json({
        message: 'This staff member already has an appointment at that date and time.',
      });
    }

    let resolvedName = alumni_name.trim();
    if (alumni_id) {
      const user = await User.findById(alumni_id).select('firstName lastName');
      if (user) resolvedName = `${user.firstName} ${user.lastName}`;
    }

    const appointment = await Appointment.create({
      alumni_id: alumni_id || undefined,
      alumni_name: resolvedName,
      staff_id,
      appointment_date,
      appointment_time,
      purpose: purpose ? purpose.trim() : '',
      notes:   notes   ? notes.trim()   : '',
      status:  'Pending',
    });

    const populated = await Appointment.findById(appointment._id)
      .populate('staff_id',  'name role status')
      .populate('alumni_id', 'firstName lastName email');

    res.status(201).json({ message: 'Appointment created.', appointment: populated });
  } catch (err) {
    console.error('createAppointment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/appointments/:id/status
const updateAppointmentStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const validTransitions = {
      Pending:  ['Approved', 'Rejected'],
      Approved: ['Completed', 'Cancelled'],
    };

    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: 'Appointment not found.' });

    const allowed = validTransitions[appt.status];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({
        message: `Cannot change status from "${appt.status}" to "${status}".`,
      });
    }

    appt.status = status;
    await appt.save();

    const populated = await Appointment.findById(appt._id)
      .populate('staff_id',  'name role status')
      .populate('alumni_id', 'firstName lastName email');

    res.json({ message: `Appointment ${status.toLowerCase()}.`, appointment: populated });
  } catch (err) {
    console.error('updateAppointmentStatus error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/appointments/:id
const deleteAppointment = async (req, res) => {
  try {
    const appt = await Appointment.findByIdAndDelete(req.params.id);
    if (!appt) return res.status(404).json({ message: 'Appointment not found.' });
    res.json({ message: 'Appointment deleted.' });
  } catch (err) {
    console.error('deleteAppointment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getOfficeSettings,     updateOfficeSettings,
  getStaff,             createStaff,    updateStaff,    deleteStaff,
  getAppointments,      createAppointment,
  updateAppointmentStatus, deleteAppointment,
};
