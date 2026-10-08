const xlsx          = require('xlsx');
const Event         = require('../models/Event');
const AttendanceLog = require('../models/AttendanceLog');
const EventFeedback = require('../models/EventFeedback');
const Notification  = require('../models/Notification');
const User          = require('../models/User');
const { escapeRegex } = require('../utils/escapeRegex');
const { logActivity, resolveAdminName } = require('./employmentController');

// The routes below take an :eventId param directly and, before this check
// existed, queried AttendanceLog/Event/EventFeedback for it with no
// ownership check at all — a coordinator who knew or guessed another
// college's event ID could read (or export) that college's full attendee
// roster, names/emails included. recordAttendance/updateEvent/deleteEvent
// already guard this same way; this mirrors that for the read/export routes.
// Returns the event doc on success, or null after already sending a
// 404/403 response (callers should just `return` when this returns null).
async function assertEventInScope(req, res, eventId, fields = '') {
  const event = await Event.findById(eventId, fields ? `college ${fields}` : 'college').lean();
  if (!event) { res.status(404).json({ message: 'Event not found.' }); return null; }
  if (req.user.college && event.college && event.college !== req.user.college) {
    res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
    return null;
  }
  return event;
}

// GET /coordinator/attendance/events
const getAttendanceEvents = async (req, res) => {
  try {
    // Coordinators only see events for their college; admins see all
    const filter = req.user.college ? { college: req.user.college } : {};
    const events = await Event.find(filter).sort({ event_datetime: -1 }).lean();
    res.json({ events });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/alumni-search?q=
const searchAlumni = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ alumni: [] });

    // Coordinators can only search alumni from their college
    const baseMatch = { role: 'alumni' };
    if (req.user.college) baseMatch.college = req.user.college;

    const alumni = await User.aggregate([
      { $match: baseMatch },
      {
        $addFields: {
          fullName: { $concat: ['$firstName', ' ', '$lastName'] },
        },
      },
      {
        $match: {
          $or: [
            { fullName: { $regex: escapeRegex(q), $options: 'i' } },
            { email:    { $regex: escapeRegex(q), $options: 'i' } },
          ],
        },
      },
      { $limit: 10 },
      { $project: { firstName: 1, lastName: 1, email: 1, course: 1, college: 1 } },
    ]);

    res.json({ alumni });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /coordinator/attendance
const recordAttendance = async (req, res) => {
  try {
    const { event_id, alumni_id, status, time_in } = req.body;
    if (!event_id)  return res.status(400).json({ message: 'Event is required.' });
    if (!alumni_id) return res.status(400).json({ message: 'Alumni is required.' });

    // Time-window validation + college enforcement
    const eventDoc = await Event.findById(event_id, 'title event_datetime end_datetime ended_at college created_by').lean();
    if (!eventDoc) return res.status(404).json({ message: 'Event not found.' });

    // Coordinator can only record attendance for their college's events
    if (req.user.college && eventDoc.college && eventDoc.college !== req.user.college) {
      return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
    }

    if (eventDoc.ended_at) {
      return res.status(400).json({ message: 'Attendance is already closed. This event has ended.' });
    }

    const now   = new Date();
    const start = new Date(eventDoc.event_datetime);
    if (now < start) {
      return res.status(400).json({ message: 'Attendance is not yet open. This event has not started yet.' });
    }
    const end = eventDoc.end_datetime
      ? new Date(eventDoc.end_datetime)
      : (() => { const d = new Date(eventDoc.event_datetime); d.setHours(23, 59, 59, 999); return d; })();
    if (now > end) {
      return res.status(400).json({ message: 'Attendance is already closed. This event has ended.' });
    }

    const existing = await AttendanceLog.findOne({ event_id, alumni_id });
    if (existing) {
      return res.status(409).json({ message: 'Attendance already recorded for this alumni at this event.' });
    }

    const autoTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    let log;
    try {
      log = await AttendanceLog.create({
        event_id,
        alumni_id,
        status:      status      || 'Present',
        time_in:     time_in     || autoTime,
        recorded_by: req.user.id,
      });
    } catch (err) {
      // Backstop for a race between the existence check above and this
      // create (e.g. a double-click, or two coordinators recording the same
      // alumnus at once) — the unique(event_id, alumni_id) index is the
      // real guarantee; without this catch the losing request fell through
      // to the generic 500 handler instead of the same clean 409 the
      // existence check above already gives for the non-race case.
      if (err.code === 11000) return res.status(409).json({ message: 'Attendance already recorded for this alumni at this event.' });
      throw err;
    }

    const alumni = await User.findById(alumni_id, 'firstName lastName course email').lean();

    // Notify the coordinator who created the event (skip if they recorded it themselves)
    if (eventDoc.created_by && String(eventDoc.created_by) !== String(req.user.id)) {
      await Notification.create({
        user_id:  eventDoc.created_by,
        title:    'Attendance Recorded',
        message:  `${alumni ? `${alumni.firstName} ${alumni.lastName}` : 'An alumni'} was recorded as ${status || 'Present'} at "${eventDoc.title}"`,
        is_read:  false,
        event_id: eventDoc._id,
        type:     'attendance',
      });
    }

    res.status(201).json({
      log: {
        ...log.toObject(),
        name:   alumni ? `${alumni.firstName} ${alumni.lastName}` : 'Unknown',
        course: alumni?.course || '',
        email:  alumni?.email  || '',
      },
    });
  } catch (err) {
    console.error('recordAttendance error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const VALID_STATUSES = ['Present', 'Late', 'Excused', 'Absent'];

// PATCH /coordinator/attendance/:id — correct a mis-recorded status/time.
// If the correction makes this "Absent", any feedback this alumnus already
// submitted for the event no longer satisfies the rule it was gated on
// (must have attended) — same reasoning submitEventFeedback and
// getAlumniEvents already apply, so it's removed here too rather than left
// as an orphaned response tied to attendance that's since been retracted.
const updateAttendance = async (req, res) => {
  try {
    const { status, time_in } = req.body;
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const log = await AttendanceLog.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Attendance record not found.' });

    const event = await Event.findById(log.event_id, 'college').lean();
    if (req.user.college && event?.college && event.college !== req.user.college) {
      return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
    }

    if (status  !== undefined) log.status  = status;
    if (time_in !== undefined) log.time_in = time_in;
    await log.save();

    let feedbackRemoved = false;
    if (log.status === 'Absent') {
      const result = await EventFeedback.deleteOne({ event_id: log.event_id, alumni_id: log.alumni_id });
      feedbackRemoved = result.deletedCount > 0;
    }

    const [staffName, alumni] = await Promise.all([
      resolveAdminName(req.user.id),
      User.findById(log.alumni_id, 'firstName lastName').lean(),
    ]);
    logActivity(req.user.id, staffName, 'edited attendance record', alumni ? `${alumni.firstName} ${alumni.lastName}` : '', `set to ${log.status}`);

    res.json({ message: 'Attendance updated.', log, feedbackRemoved });
  } catch (err) {
    console.error('updateAttendance error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /coordinator/attendance/:id — same feedback-cascade reasoning as
// updateAttendance above: no attendance record at all means the "must have
// attended" rule feedback was gated on no longer holds.
const deleteAttendance = async (req, res) => {
  try {
    const log = await AttendanceLog.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Attendance record not found.' });

    const event = await Event.findById(log.event_id, 'college').lean();
    if (req.user.college && event?.college && event.college !== req.user.college) {
      return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
    }

    const alumni = await User.findById(log.alumni_id, 'firstName lastName').lean();
    await log.deleteOne();
    const result = await EventFeedback.deleteOne({ event_id: log.event_id, alumni_id: log.alumni_id });

    resolveAdminName(req.user.id).then(staffName => {
      logActivity(req.user.id, staffName, 'deleted attendance record', alumni ? `${alumni.firstName} ${alumni.lastName}` : '');
    });

    res.json({ message: 'Attendance record deleted.', feedbackRemoved: result.deletedCount > 0 });
  } catch (err) {
    console.error('deleteAttendance error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/:eventId/records
const getAttendanceRecords = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { search, status, page = 1, limit = 10 } = req.query;

    if (!(await assertEventInScope(req, res, eventId))) return;

    const [logs, feedbackDocs] = await Promise.all([
      AttendanceLog.find({ event_id: eventId })
        .populate('alumni_id', 'firstName lastName course email')
        .sort({ createdAt: -1 })
        .lean(),
      EventFeedback.find({ event_id: eventId }, 'alumni_id').lean(),
    ]);

    const feedbackSet = new Set(feedbackDocs.map(f => String(f.alumni_id)));

    let records = logs.map(l => ({
      _id:      l._id,
      name:     l.alumni_id ? `${l.alumni_id.firstName} ${l.alumni_id.lastName}` : 'Unknown',
      email:    l.alumni_id?.email  || '',
      course:   l.alumni_id?.course || '',
      time_in:  l.time_in,
      status:   l.status,
      feedback: feedbackSet.has(String(l.alumni_id?._id)),
      date:     l.createdAt,
    }));

    if (search) {
      const q = search.toLowerCase();
      records = records.filter(r =>
        r.name.toLowerCase().includes(q)   ||
        r.course.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q)
      );
    }
    if (status) records = records.filter(r => r.status === status);

    const total = records.length;
    const pages = Math.ceil(total / Number(limit)) || 1;
    const paged = records.slice((Number(page) - 1) * Number(limit), Number(page) * Number(limit));

    res.json({ records: paged, pagination: { page: +page, limit: +limit, total, pages } });
  } catch (err) {
    console.error('getAttendanceRecords error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/:eventId/stats
const getAttendanceStats = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await assertEventInScope(req, res, eventId, 'title capacity');
    if (!event) return;

    const [logs, feedbackCount] = await Promise.all([
      AttendanceLog.find({ event_id: eventId }).populate('alumni_id', 'course').lean(),
      EventFeedback.countDocuments({ event_id: eventId }),
    ]);

    const total    = logs.length;
    const capacity = event?.capacity || 0;
    const rate     = capacity > 0 ? Math.round((total / capacity) * 100) : 0;

    const courseCount = {};
    logs.forEach(l => {
      const c = l.alumni_id?.course || 'Unknown';
      courseCount[c] = (courseCount[c] || 0) + 1;
    });
    const sorted     = Object.entries(courseCount).sort((a, b) => b[1] - a[1]);
    const topCourse  = sorted[0]?.[0]    || '—';
    const lowestCourse = sorted.length > 1 ? sorted[sorted.length - 1][0] : '—';

    res.json({ attendees: total, feedbacks: feedbackCount, capacity, rate, topCourse, lowestCourse });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/:eventId/details
const getEventDetails = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).lean();
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (req.user.college && event.college && event.college !== req.user.college) {
      return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
    }

    const [total, feedbackResponses] = await Promise.all([
      AttendanceLog.countDocuments({ event_id: req.params.eventId }),
      EventFeedback.countDocuments({ event_id: req.params.eventId }),
    ]);
    const capacity = event.capacity || 0;
    const rate     = capacity > 0 ? Math.round((total / capacity) * 100) : 0;

    res.json({
      event: {
        ...event,
        total_attendees: total,
        attendance_rate: rate,
        feedback_responses: feedbackResponses,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /coordinator/attendance/:eventId/end — coordinator manually closes
// attendance before the event's own scheduled end_datetime (e.g. the event
// wrapped up early in person). One-way: no "reopen", mirroring how
// end_datetime passing is also irreversible once real time has moved on.
const endEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await assertEventInScope(req, res, eventId, 'title ended_at');
    if (!event) return;

    if (event.ended_at) {
      return res.status(400).json({ message: 'Attendance for this event is already closed.' });
    }

    const updated = await Event.findByIdAndUpdate(eventId, { ended_at: new Date() }, { new: true }).lean();

    resolveAdminName(req.user.id).then(staffName => {
      logActivity(req.user.id, staffName, 'ended attendance', event.title || '');
    });

    res.json({ message: 'Attendance closed for this event.', event: updated });
  } catch (err) {
    console.error('endEvent error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/:eventId/export?format=csv|xlsx
const exportAttendance = async (req, res) => {
  try {
    const { eventId } = req.params;
    const format      = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

    if (!(await assertEventInScope(req, res, eventId))) return;

    const [event, logs, feedbackDocs] = await Promise.all([
      Event.findById(eventId, 'title event_datetime').lean(),
      AttendanceLog.find({ event_id: eventId })
        .populate('alumni_id', 'firstName lastName course email')
        .sort({ createdAt: -1 })
        .lean(),
      EventFeedback.find({ event_id: eventId }, 'alumni_id').lean(),
    ]);

    const feedbackSet = new Set(feedbackDocs.map(f => String(f.alumni_id)));
    const eventTitle  = event?.title || 'Event';

    resolveAdminName(req.user.id).then(staffName => {
      logActivity(req.user.id, staffName, 'exported attendance report', eventTitle, `${format}, ${logs.length} records`);
    });

    const rows = logs.map(l => ({
      'Event Name':  eventTitle,
      'Alumni Name': l.alumni_id ? `${l.alumni_id.firstName} ${l.alumni_id.lastName}` : 'Unknown',
      'Student ID':  l.alumni_id ? String(l.alumni_id._id).slice(-8).toUpperCase() : '',
      'Course':      l.alumni_id?.course || '',
      'Status':      l.status,
      'Time In':     l.time_in,
      'Date':        l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-US') : '',
      'Feedback':    feedbackSet.has(String(l.alumni_id?._id)) ? 'Yes' : 'No',
    }));

    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Attendance');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${eventId}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    // CSV
    const header = Object.keys(rows[0] || {});
    const csvRows = [
      header.join(','),
      ...rows.map(r => header.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${eventId}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error('exportAttendance error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getAttendanceEvents,
  searchAlumni,
  recordAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceRecords,
  getAttendanceStats,
  getEventDetails,
  exportAttendance,
  endEvent,
};
