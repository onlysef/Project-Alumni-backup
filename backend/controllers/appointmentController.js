const OfficeSettings = require('../models/OfficeSettings');
const Staff          = require('../models/Staff');
const Appointment    = require('../models/Appointment');
const User           = require('../models/User');
const Notification   = require('../models/Notification');

function toMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isPastDateTime(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime() < Date.now();
}

// "YYYY-MM-DD" + "HH:MM" → "Jul 28, 2026 · 8:30 AM", matching the format
// already shown in the coordinator's appointments table.
function formatApptDateTime(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dateLabel = new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${dateLabel} · ${h12}:${String(mi).padStart(2, '0')} ${ampm}`;
}

// A Pending appointment whose slot has already passed is no longer
// actionable — approving it now wouldn't put anyone in front of staff at
// the time they booked. Sweep those to "Missed" so the coordinator queue
// only shows requests that can still be acted on.
async function expireStalePendingAppointments() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const candidates = await Appointment.find({
    status: 'Pending',
    appointment_date: { $lte: todayStr },
  }).select('_id appointment_date appointment_time');

  const staleIds = candidates
    .filter((a) => isPastDateTime(a.appointment_date, a.appointment_time))
    .map((a) => a._id);

  if (staleIds.length) {
    await Appointment.updateMany({ _id: { $in: staleIds } }, { status: 'Missed' });
  }
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
    await expireStalePendingAppointments();

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

// Shared by the admin-authored booking form and the alumni self-service one —
// keeps office-hours/working-day/double-booking rules in exactly one place.
async function createAppointmentRecord({ alumni_id, alumni_name, staff_id, appointment_date, appointment_time, purpose, notes }) {
  if (!alumni_name || !staff_id || !appointment_date || !appointment_time) {
    return { ok: false, status: 400, message: 'Alumni name, staff, date, and time are required.' };
  }

  const staff = await Staff.findOne({ _id: staff_id, deleted: false });
  if (!staff) return { ok: false, status: 404, message: 'Selected staff member not found.' };

  const settings = await OfficeSettings.findOne();
  if (settings) {
    if (settings.office_status === 'Closed') {
      return { ok: false, status: 400, message: 'The office is currently closed. Appointments cannot be booked.' };
    }

    const [year, month, day] = appointment_date.split('-').map(Number);
    const dateObj        = new Date(year, month - 1, day);
    const appointmentDay = JS_DAY_TO_LABEL[dateObj.getDay()];

    if (!appointmentDay || !settings.working_days.includes(appointmentDay)) {
      const dayList = settings.working_days.join(', ') || 'none';
      return { ok: false, status: 400, message: `Appointments are not available on this day. Working days: ${dayList}.` };
    }

    const apptMin  = toMinutes(appointment_time);
    const startMin = toMinutes(settings.start_time);
    const endMin   = toMinutes(settings.end_time);
    if (apptMin < startMin || apptMin >= endMin) {
      return { ok: false, status: 400, message: `Appointment time must be within office hours (${settings.start_time}–${settings.end_time}).` };
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
    return { ok: false, status: 409, message: 'This staff member already has an appointment at that date and time.' };
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

  return { ok: true, appointment: populated };
}

// POST /api/admin/appointments
const createAppointment = async (req, res) => {
  try {
    const { alumni_id, alumni_name, staff_id, appointment_date, appointment_time, purpose, notes } = req.body;
    const result = await createAppointmentRecord({ alumni_id, alumni_name, staff_id, appointment_date, appointment_time, purpose, notes });
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    res.status(201).json({ message: 'Appointment created.', appointment: result.appointment });
  } catch (err) {
    console.error('createAppointment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/appointments/booked-slots?staff_id=&date= — just the taken
// times for that staff/day, so the alumni booking form can hide them. No
// alumni identity is exposed here, unlike the admin appointments list.
const getBookedSlots = async (req, res) => {
  try {
    const { staff_id, date } = req.query;
    if (!staff_id || !date) return res.status(400).json({ message: 'staff_id and date are required.' });

    const appointments = await Appointment.find({
      staff_id,
      appointment_date: date,
      status: { $nin: ['Rejected', 'Cancelled'] },
    }).select('appointment_time');

    res.json({ times: appointments.map((a) => a.appointment_time) });
  } catch (err) {
    console.error('getBookedSlots error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/appointments/staff — only staff currently taking appointments
const getAvailableStaff = async (req, res) => {
  try {
    const staff = await Staff.find({ deleted: false, status: 'Available' }).sort({ name: 1 });
    res.json({ staff });
  } catch (err) {
    console.error('getAvailableStaff error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/alumni/appointments — alumni books for themselves; identity comes
// from the authenticated session, never from the request body.
const bookAppointment = async (req, res) => {
  try {
    const { staff_id, appointment_date, appointment_time, purpose } = req.body;

    const user = await User.findById(req.user.id).select('firstName lastName');
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const result = await createAppointmentRecord({
      alumni_id: req.user.id,
      alumni_name: `${user.firstName} ${user.lastName}`,
      staff_id,
      appointment_date,
      appointment_time,
      purpose,
    });
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    res.status(201).json({ message: 'Your appointment request has been sent.', appointment: result.appointment });
  } catch (err) {
    console.error('bookAppointment error:', err);
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

    if (appt.alumni_id && (status === 'Approved' || status === 'Rejected')) {
      const when = formatApptDateTime(appt.appointment_date, appt.appointment_time);
      await Notification.create({
        user_id: appt.alumni_id,
        title:   status === 'Approved' ? 'Appointment Approved' : 'Appointment Rejected',
        message: status === 'Approved'
          ? `Your ${appt.purpose || 'appointment'} request for ${when} has been approved.`
          : `Your ${appt.purpose || 'appointment'} request for ${when} was not approved.`,
        is_read: false,
        type:    'appointment',
      });
    }

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
  getAvailableStaff,    bookAppointment,    getBookedSlots,
};
