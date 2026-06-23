const xlsx          = require('xlsx');
const Event         = require('../models/Event');
const AttendanceLog = require('../models/AttendanceLog');
const EventFeedback = require('../models/EventFeedback');
const Notification  = require('../models/Notification');
const User          = require('../models/User');

// GET /coordinator/attendance/events
const getAttendanceEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ event_datetime: -1 }).lean();
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

    const alumni = await User.aggregate([
      { $match: { role: 'alumni' } },
      {
        $addFields: {
          fullName: { $concat: ['$firstName', ' ', '$lastName'] },
        },
      },
      {
        $match: {
          $or: [
            { fullName: { $regex: q, $options: 'i' } },
            { email:    { $regex: q, $options: 'i' } },
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

    const existing = await AttendanceLog.findOne({ event_id, alumni_id });
    if (existing) {
      return res.status(409).json({ message: 'Attendance already recorded for this alumni at this event.' });
    }

    const now = new Date();
    const autoTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const log = await AttendanceLog.create({
      event_id,
      alumni_id,
      status:      status      || 'Present',
      time_in:     time_in     || autoTime,
      recorded_by: req.user.id,
    });

    const [alumni, event] = await Promise.all([
      User.findById(alumni_id, 'firstName lastName course email').lean(),
      Event.findById(event_id, 'title created_by').lean(),
    ]);

    // Notify the coordinator who created the event (skip if they recorded it themselves)
    if (event?.created_by && String(event.created_by) !== String(req.user.id)) {
      await Notification.create({
        user_id:  event.created_by,
        title:    'Attendance Recorded',
        message:  `${alumni ? `${alumni.firstName} ${alumni.lastName}` : 'An alumni'} was recorded as ${status || 'Present'} at "${event.title}"`,
        is_read:  false,
        event_id: event._id,
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

// GET /coordinator/attendance/:eventId/records
const getAttendanceRecords = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { search, status, page = 1, limit = 10 } = req.query;

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

    const [event, logs, feedbackCount] = await Promise.all([
      Event.findById(eventId, 'title capacity').lean(),
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

    const total    = await AttendanceLog.countDocuments({ event_id: req.params.eventId });
    const capacity = event.capacity || 0;
    const rate     = capacity > 0 ? Math.round((total / capacity) * 100) : 0;

    res.json({ event: { ...event, total_attendees: total, attendance_rate: rate } });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/:eventId/export?format=csv|xlsx
const exportAttendance = async (req, res) => {
  try {
    const { eventId } = req.params;
    const format      = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

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
  getAttendanceRecords,
  getAttendanceStats,
  getEventDetails,
  exportAttendance,
};
