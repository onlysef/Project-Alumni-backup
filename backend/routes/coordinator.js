const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getEmploymentRecords, getEmploymentActivity, notifyAlumniToUpdate } = require('../controllers/employmentController');
const {
  getEvents, createEvent, updateEvent, deleteEvent,
  getInterestedAlumni, getCoordinatorNotifications, markNotificationsRead,
} = require('../controllers/eventController');
const {
  getAttendanceEvents, searchAlumni, recordAttendance, updateAttendance, deleteAttendance,
  getAttendanceRecords, getAttendanceStats, getEventDetails, exportAttendance,
} = require('../controllers/attendanceController');
const { getEventFeedbackSummary } = require('../controllers/feedbackController');
const User = require('../models/User');
const AlumniEmployment = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const Event = require('../models/Event');
const AttendanceLog = require('../models/AttendanceLog');
const EventFeedback = require('../models/EventFeedback');

router.use(protect, authorize('admin', 'coordinator'));

// Dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const college = req.user.college || '';

    // Filters scoped to coordinator's college (admins have no college, see all)
    const alumniFilter  = college ? { role: 'alumni', college } : { role: 'alumni' };
    const eventFilter   = college ? { college }                 : {};

    const [
      totalAlumni,
      completedEvents,
    ] = await Promise.all([
      User.countDocuments(alumniFilter),
      Event.countDocuments({ ...eventFilter, event_datetime: { $lt: now, $gte: startOfYear } }),
    ]);

    // Get IDs of events scoped to this coordinator's college
    const scopedEvents = await Event.find(eventFilter, '_id').lean();
    const scopedEventIds = scopedEvents.map(e => e._id);

    const [
      recentFeedbackCount,
      avgRatingResult,
      recentEvents,
    ] = await Promise.all([
      EventFeedback.countDocuments({
        event_id: { $in: scopedEventIds },
        createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) },
      }),
      EventFeedback.aggregate([
        { $match: { event_id: { $in: scopedEventIds } } },
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ]),
      Event.find(eventFilter).sort({ event_datetime: -1 }).limit(5).lean(),
    ]);

    const recentFeedbacks = recentFeedbackCount;
    const avgRating = avgRatingResult[0] ? Math.round(avgRatingResult[0].avg * 10) / 10 : 0;

    // Attendance count per recent event
    const eventIds = recentEvents.map(e => e._id);
    const [attendanceCounts, feedbackCounts] = await Promise.all([
      AttendanceLog.aggregate([
        { $match: { event_id: { $in: eventIds } } },
        { $group: { _id: '$event_id', count: { $sum: 1 } } },
      ]),
      EventFeedback.aggregate([
        { $match: { event_id: { $in: eventIds } } },
        { $group: { _id: '$event_id', count: { $sum: 1 } } },
      ]),
    ]);

    const attMap = {};
    attendanceCounts.forEach(a => { attMap[String(a._id)] = a.count; });
    const fbMap = {};
    feedbackCounts.forEach(f => { fbMap[String(f._id)] = f.count; });

    const chartEvents = recentEvents.map(e => ({
      label: e.title,
      attendance: attMap[String(e._id)] || 0,
      feedbacks: fbMap[String(e._id)] || 0,
    })).reverse();

    // Top and lowest event by attendance (scoped to college)
    const allAttendance = await AttendanceLog.aggregate([
      ...(scopedEventIds.length ? [{ $match: { event_id: { $in: scopedEventIds } } }] : []),
      { $group: { _id: '$event_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    let topEvent = '—', lowEvent = '—';
    if (allAttendance.length > 0) {
      const [topDoc, lowDoc] = await Promise.all([
        Event.findById(allAttendance[0]._id, 'title').lean(),
        Event.findById(allAttendance[allAttendance.length - 1]._id, 'title').lean(),
      ]);
      topEvent = topDoc?.title || '—';
      lowEvent = allAttendance.length > 1 ? (lowDoc?.title || '—') : '—';
    }

    // Recent activity scoped to this college's events
    const [recentLogs, recentFeedbackDocs] = await Promise.all([
      AttendanceLog.find({ event_id: { $in: scopedEventIds } })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('alumni_id', 'firstName lastName')
        .populate('event_id', 'title')
        .lean(),
      EventFeedback.find({ event_id: { $in: scopedEventIds } })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('alumni_id', 'firstName lastName')
        .populate('event_id', 'title')
        .lean(),
    ]);

    const activityItems = [
      ...recentLogs.map(l => {
        const name = l.alumni_id ? `${l.alumni_id.firstName} ${l.alumni_id.lastName}` : 'An alumni';
        const detail = `was recorded ${l.status || 'Present'} at "${l.event_id?.title || 'an event'}"`;
        return { name, detail, text: `${name} ${detail}`, time: l.createdAt, type: 'attendance', event_id: l.event_id?._id ?? null };
      }),
      ...recentFeedbackDocs.map(f => {
        const name = f.alumni_id ? `${f.alumni_id.firstName} ${f.alumni_id.lastName}` : 'An alumni';
        const detail = `submitted feedback for "${f.event_id?.title || 'an event'}"`;
        return { name, detail, text: `${name} ${detail}`, time: f.createdAt, type: 'feedback', event_id: f.event_id?._id ?? null };
      }),
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 8);

    res.json({
      totalAlumni,
      completedEvents,
      recentFeedbacks,
      avgRating,
      topEvent,
      lowEvent,
      chartEvents,
      activity: activityItems,
    });
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// Reports
router.get('/reports/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const year    = parseInt(req.query.year) || new Date().getFullYear();
    const eventId = req.query.eventId || null;
    const format  = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const xlsx    = require('xlsx');
    const college = req.user.college || '';
    const eventFilter = college ? { college } : {};

    let events;
    if (eventId) {
      const single = await Event.findById(eventId).lean();
      // Coordinators cannot export events from another college
      if (single && college && single.college && single.college !== college) {
        return res.status(403).json({ message: 'Access denied.' });
      }
      events = single ? [single] : [];
    } else {
      const start = new Date(year, 0, 1);
      const end   = new Date(year + 1, 0, 1);
      events = await Event.find({ ...eventFilter, event_datetime: { $gte: start, $lt: end } })
        .sort({ event_datetime: -1 }).lean();
    }

    const eventIds = events.map(e => e._id);

    const [attendanceCounts, feedbackAgg] = await Promise.all([
      AttendanceLog.aggregate([
        { $match: { event_id: { $in: eventIds } } },
        { $group: { _id: '$event_id', count: { $sum: 1 } } },
      ]),
      EventFeedback.aggregate([
        { $match: { event_id: { $in: eventIds } } },
        { $group: { _id: '$event_id', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
      ]),
    ]);

    const attMap = {};
    attendanceCounts.forEach(a => { attMap[String(a._id)] = a.count; });
    const fbMap = {};
    feedbackAgg.forEach(f => { fbMap[String(f._id)] = { count: f.count, avg: Math.round(f.avgRating * 10) / 10 }; });

    let rows = [];
    let filename = '';

    if (type === 'event-attendance') {
      filename = `event-attendance-${year}`;
      rows = events.map((e, i) => {
        const att = attMap[String(e._id)] || 0;
        const cap = e.capacity || 0;
        return {
          'No.':             i + 1,
          'Event Name':      e.title,
          'Date':            new Date(e.event_datetime).toLocaleDateString('en-US'),
          'Total Attendees': att,
          'Capacity':        cap || '—',
          'Attendance Rate': cap > 0 ? `${Math.round((att / cap) * 100)}%` : '—',
        };
      });
    } else if (type === 'top-events') {
      filename = `top-events-${year}`;
      rows = [...events]
        .sort((a, b) => (attMap[String(b._id)] || 0) - (attMap[String(a._id)] || 0))
        .map((e, i) => ({
          'Rank':          i + 1,
          'Event Name':    e.title,
          'Date':          new Date(e.event_datetime).toLocaleDateString('en-US'),
          'Attendees':     attMap[String(e._id)] || 0,
          'Feedbacks':     fbMap[String(e._id)]?.count || 0,
          'Avg Rating':    fbMap[String(e._id)]?.avg || '—',
        }));
    } else if (type === 'feedback-completion') {
      filename = `feedback-completion-${year}`;
      rows = events.map((e, i) => {
        const att = attMap[String(e._id)] || 0;
        const fb  = fbMap[String(e._id)]?.count || 0;
        return {
          'No.':               i + 1,
          'Event Name':        e.title,
          'Date':              new Date(e.event_datetime).toLocaleDateString('en-US'),
          'Total Attendees':   att,
          'Feedbacks Received': fb,
          'Completion Rate':   att > 0 ? `${Math.round((fb / att) * 100)}%` : '—',
          'Avg Rating':        fbMap[String(e._id)]?.avg || '—',
        };
      });
    } else {
      return res.status(400).json({ message: 'Unknown report type.' });
    }

    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Report');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    const header = Object.keys(rows[0] || {});
    const csv = [
      header.join(','),
      ...rows.map(r => header.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (err) {
    console.error('reports error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// Notifications
router.get('/notifications',        getCoordinatorNotifications);
router.patch('/notifications/read', markNotificationsRead);

// Employment (must declare /activity before plain /employment)
router.get('/employment/activity', getEmploymentActivity);
router.get('/employment', (req, res, next) => {
  // Force coordinator's college — cannot be overridden by query param
  if (req.user.college) req.query.college = req.user.college;
  next();
}, getEmploymentRecords);
router.post('/employment/notify',  (req, res) => {
  // Force the coordinator's assigned college — ignore any body.college
  req.body.college = req.user.college || '';
  req.body.course  = '';
  return notifyAlumniToUpdate(req, res);
});

// Attendance — must declare specific paths before /:eventId param routes
router.get('/attendance/events',                   getAttendanceEvents);
router.get('/attendance/alumni-search',            searchAlumni);
router.post('/attendance',                         recordAttendance);
router.patch('/attendance/:id',                    updateAttendance);
router.delete('/attendance/:id',                   deleteAttendance);
router.get('/attendance/:eventId/records',         getAttendanceRecords);
router.get('/attendance/:eventId/stats',           getAttendanceStats);
router.get('/attendance/:eventId/details',         getEventDetails);
router.get('/attendance/:eventId/export',          exportAttendance);
router.get('/attendance/:eventId/feedback',         getEventFeedbackSummary);

// Events
router.get('/events',                    getEvents);
router.post('/events',                   createEvent);
router.put('/events/:id',                updateEvent);
router.delete('/events/:id',             deleteEvent);
router.get('/events/:id/interested',     getInterestedAlumni);

// Alumni contacts
router.get('/alumni', async (req, res) => {
  try {
    const { course, year, search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);

    // Coordinators can only view alumni from their assigned college
    const match = { role: 'alumni' };
    if (req.user.college) match.college = req.user.college;
    if (course) match.course = course;
    if (year)   match.graduationYear = Number(year);

    let users = await User.find(match, 'firstName lastName email course graduationYear avatarUrl').sort({ lastName: 1 }).lean();

    if (search) {
      const q = search.toLowerCase();
      users = users.filter(u =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    }

    const total = users.length;
    const pages = Math.ceil(total / limit) || 1;
    const paged = users.slice((page - 1) * limit, page * limit);
    const ids   = paged.map(u => u._id);

    const [empRecords, tracerRecords] = await Promise.all([
      AlumniEmployment.find({ alumni_id: { $in: ids } }, 'alumni_id job_title employment_status').lean(),
      TracerStudyResponse.find({ alumni_id: { $in: ids } }, 'alumni_id contactNumber').lean(),
    ]);

    const empMap = {};
    empRecords.forEach(e => { empMap[String(e.alumni_id)] = e; });
    const tracerMap = {};
    tracerRecords.forEach(t => { tracerMap[String(t.alumni_id)] = t; });

    const PLACEHOLDER = new Set(['N/A', 'None', 'null', 'undefined', '']);

    const contacts = paged.map(u => {
      const key = String(u._id);
      const emp = empMap[key];
      const tracer = tracerMap[key];
      const jobTitle = emp?.job_title && !PLACEHOLDER.has(emp.job_title) ? emp.job_title : '';
      const phone = tracer?.contactNumber && !PLACEHOLDER.has(tracer.contactNumber) ? tracer.contactNumber : '';
      return {
        _id:    u._id,
        name:   `${u.firstName} ${u.lastName}`,
        email:  u.email,
        course: u.course || '',
        year:   u.graduationYear || '',
        title:  jobTitle || emp?.employment_status || '',
        phone,
        avatarUrl: u.avatarUrl || '',
      };
    });

    res.json({ contacts, pagination: { page, limit, total, pages } });
  } catch (err) {
    console.error('coordinator /alumni error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;