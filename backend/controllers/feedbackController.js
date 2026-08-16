const Event         = require('../models/Event');
const AttendanceLog = require('../models/AttendanceLog');
const EventFeedback = require('../models/EventFeedback');

const CATEGORY_KEYS = ['organization', 'content', 'venue', 'satisfaction'];

// Same "ended" definition used everywhere else this app computes event
// status (EventManagement.jsx computeStatus, EventParticipation.jsx
// attendanceStatus, attendanceController.recordAttendance's time-window
// check) — no end_datetime falls back to end-of-start-day. Kept as one
// function here so feedback gating can never drift from those.
function isEventEnded(event) {
  const now   = new Date();
  const start = new Date(event.event_datetime);
  const end   = event.end_datetime
    ? new Date(event.end_datetime)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
  return now > end;
}

function average(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

// POST /api/alumni/events/:id/feedback — the alumnus's own submission.
// Every check here is re-validated server-side on purpose (per the spec):
// authenticated (via `protect`), attended, event ended, not already
// submitted — a direct API call has to satisfy all four, the UI hiding the
// form is not the real gate.
const submitEventFeedback = async (req, res) => {
  try {
    const eventId = req.params.id;
    const numRating = Number(req.body.rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({ message: 'An overall rating from 1 to 5 is required.' });
    }

    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    if (!isEventEnded(event)) {
      return res.status(400).json({ message: 'Feedback is not available until this event has ended.' });
    }

    // A row with status "Absent" means the coordinator logged that this
    // alumnus was expected but did not attend — a record existing is not by
    // itself proof of attendance.
    const attendance = await AttendanceLog.findOne({ event_id: eventId, alumni_id: req.user.id }).lean();
    if (!attendance || attendance.status === 'Absent') {
      return res.status(403).json({ message: 'Feedback is only available to alumni who attended this event.' });
    }

    const existing = await EventFeedback.findOne({ event_id: eventId, alumni_id: req.user.id }).select('_id').lean();
    if (existing) {
      return res.status(409).json({ message: 'You have already submitted feedback for this event.' });
    }

    const ratings = {};
    if (req.body.ratings && typeof req.body.ratings === 'object') {
      CATEGORY_KEYS.forEach((key) => {
        const v = Number(req.body.ratings[key]);
        if (v >= 1 && v <= 5) ratings[key] = v;
      });
    }

    let doc;
    try {
      doc = await EventFeedback.create({
        event_id:  eventId,
        alumni_id: req.user.id,
        rating:    numRating,
        ratings,
        feedback:  String(req.body.feedback || '').trim(),
      });
    } catch (err) {
      // Backstop for a race between the existence check above and this
      // create (e.g. a double-click or two open tabs submitting at once) —
      // the unique(event_id, alumni_id) index is the real guarantee.
      if (err.code === 11000) return res.status(409).json({ message: 'You have already submitted feedback for this event.' });
      throw err;
    }

    res.status(201).json({ message: 'Feedback submitted. Thank you!', feedback: doc });
  } catch (err) {
    console.error('submitEventFeedback error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/events/:id/feedback — the alumnus viewing their own
// already-submitted response ("View Response").
const getMyEventFeedback = async (req, res) => {
  try {
    const doc = await EventFeedback.findOne({ event_id: req.params.id, alumni_id: req.user.id }).lean();
    if (!doc) return res.status(404).json({ message: 'No feedback found.' });
    res.json({ feedback: doc });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/attendance/:eventId/feedback — full feedback summary for
// one event: counts, response rate, average ratings, and every individual
// response. One query per collection (no N+1 — the per-response averages
// are computed in memory from the same `responses` array already fetched).
const getEventFeedbackSummary = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId, 'title event_datetime end_datetime college capacity').lean();
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (req.user.college && event.college && event.college !== req.user.college) {
      return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
    }

    // Matches the exact same (unfiltered) count already shown elsewhere as
    // "Total Attendees" (getAttendanceStats/getEventDetails) so this modal's
    // numbers never contradict the View Event modal for the same event.
    const [totalAttendees, responses] = await Promise.all([
      AttendanceLog.countDocuments({ event_id: eventId }),
      EventFeedback.find({ event_id: eventId })
        .populate('alumni_id', 'firstName lastName course')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const totalResponses = responses.length;
    const responseRate = totalAttendees > 0 ? Math.round((totalResponses / totalAttendees) * 10000) / 100 : 0;

    const averageCategoryRatings = {};
    CATEGORY_KEYS.forEach((key) => {
      averageCategoryRatings[key] = average(responses.map((r) => r.ratings?.[key]));
    });

    res.json({
      event: {
        _id: event._id,
        title: event.title,
        event_datetime: event.event_datetime,
        end_datetime: event.end_datetime,
      },
      total_attendees: totalAttendees,
      total_responses: totalResponses,
      response_rate: responseRate,
      average_rating: average(responses.map((r) => r.rating)),
      average_category_ratings: averageCategoryRatings,
      responses: responses.map((r) => ({
        _id: r._id,
        name: r.alumni_id ? `${r.alumni_id.firstName} ${r.alumni_id.lastName}` : 'Unknown',
        course: r.alumni_id?.course || '',
        rating: r.rating,
        ratings: r.ratings || {},
        feedback: r.feedback || '',
        submittedAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('getEventFeedbackSummary error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  isEventEnded,
  submitEventFeedback,
  getMyEventFeedback,
  getEventFeedbackSummary,
};
