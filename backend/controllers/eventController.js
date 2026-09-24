const Event          = require('../models/Event');
const EventInterested = require('../models/EventInterested');
const Notification   = require('../models/Notification');
const AttendanceLog  = require('../models/AttendanceLog');
const EventFeedback  = require('../models/EventFeedback');
const User           = require('../models/User');
const { isEventEnded } = require('./feedbackController');

const COLLEGE_CODES = ['CPAG', 'CCS', 'COS', 'CIT', 'COE', 'CBA', 'COED', 'CASS', 'CCJE', 'CAFA'];

// The `college` field (who can manage this event in the coordinator UI —
// getEvents/getAttendanceEvents filter by it) used to always default to the
// creator's own college, ignoring `visibility` (the audience field alumni
// routes filter by) entirely. That meant an admin picking a specific
// college in the "Colleges" dropdown produced an event that college's
// alumni could see (getAlumniEvents reads visibility) but that college's
// coordinators could never see or manage (getEvents reads college) — nobody
// could take attendance for it. A coordinator always owns events under
// their own college regardless of visibility, same as before; only an
// admin's choice of a specific college now carries through to `college`.
function resolveEventCollege(user, visibility) {
  if (user.college) return user.college;
  return COLLEGE_CODES.includes(visibility) ? visibility : '';
}

// resolveEventCollege() above only locks down the MANAGEMENT field
// (`college` — who can edit/take attendance) to the coordinator's own
// college; it never restricted the AUDIENCE field (`visibility` — who sees
// it in getAlumniEvents). A coordinator could set visibility to a different
// college's code entirely (e.g. a CPAG coordinator posting `visibility:
// 'CCS'`), producing an event only CCS alumni see, that CCS's own
// coordinators have no access to manage — a college-scope bypass via the
// audience field instead of the management field. 'Public'/'Private'/'All
// Alumni' are all still allowed unrestricted since none of them single out
// a SPECIFIC other college.
function assertVisibilityAllowed(user, visibility) {
  if (!user.college || !visibility) return null;
  const isCollegeSpecific = COLLEGE_CODES.includes(visibility) || /\sAlumni$/.test(visibility);
  if (!isCollegeSpecific) return null;
  const ownCollegeVariant = visibility === user.college || visibility === `${user.college} Alumni`;
  if (ownCollegeVariant) return null;
  return `You can only target your own college (${user.college}) or a general audience (Public / All Alumni) — not "${visibility}".`;
}

// createEvent's "New Event" broadcast used to notify EVERY active alumnus
// regardless of the event's visibility — a college-scoped event (visibility
// 'CPAG', say) still paged alumni in every other college, even though
// getAlumniEvents would never actually show them that event. Mirrors
// getAlumniEvents' own visibility→audience mapping so a notification only
// ever reaches alumni who can actually see the event it's about.
function notifiableAlumniFilter(visibility) {
  if (visibility === 'Public' || visibility === 'All Alumni') return { role: 'alumni', status: 'active' };
  const collegeMatch = visibility && visibility.match(/^([A-Z]+)(?:\sAlumni)?$/);
  const college = collegeMatch && COLLEGE_CODES.includes(collegeMatch[1]) ? collegeMatch[1] : null;
  if (college) return { role: 'alumni', status: 'active', college };
  return null; // 'Private' (or any unrecognized value) — no one sees this event, so no one is notified
}

// GET /coordinator/events
const getEvents = async (req, res) => {
  try {
    // Coordinators only see events for their college; admins see all
    const filter = req.user.college ? { college: req.user.college } : {};
    const events = await Event.find(filter).sort({ event_datetime: -1 }).lean();

    const eventIds = events.map(e => e._id);
    const counts = await EventInterested.aggregate([
      { $match: { event_id: { $in: eventIds } } },
      { $group: { _id: '$event_id', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[String(c._id)] = c.count; });

    res.json({
      events: events.map(e => ({
        ...e,
        interested_count: countMap[String(e._id)] || 0,
      })),
    });
  } catch (err) {
    console.error('getEvents error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /coordinator/events
const createEvent = async (req, res) => {
  try {
    const { title, description, image, location, event_datetime, end_datetime, visibility, capacity } = req.body;
    if (!title?.trim())    return res.status(400).json({ message: 'Title is required.' });
    if (!event_datetime)   return res.status(400).json({ message: 'Date & time is required.' });

    const eventVisibility = visibility || 'Public';
    const visibilityError = assertVisibilityAllowed(req.user, eventVisibility);
    if (visibilityError) return res.status(403).json({ message: visibilityError });

    const event = await Event.create({
      title:          title.trim(),
      description:    description?.trim() || '',
      image:          image || '',
      location:       location?.trim()    || '',
      event_datetime: new Date(event_datetime),
      end_datetime:   end_datetime ? new Date(end_datetime) : null,
      visibility:     eventVisibility,
      capacity:       Number(capacity) || 0,
      college:        resolveEventCollege(req.user, eventVisibility),
      created_by:     req.user.id,
    });

    // Respond immediately — notifications run in background
    res.status(201).json({ event: { ...event.toObject(), interested_count: 0 } });

    const notifyFilter = notifiableAlumniFilter(eventVisibility);
    if (!notifyFilter) return;
    User.find(notifyFilter, '_id').lean()
      .then(alumni => {
        if (!alumni.length) return;
        return Notification.insertMany(alumni.map(a => ({
          user_id:  a._id,
          title:    'New Event',
          message:  `A new event has been posted: "${event.title}"`,
          is_read:  false,
          event_id: event._id,
          type:     'event',
        })));
      })
      .catch(() => {});
  } catch (err) {
    console.error('createEvent error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /coordinator/events/:id
const updateEvent = async (req, res) => {
  try {
    const { title, description, image, location, event_datetime, end_datetime, visibility, capacity } = req.body;

    // Coordinators can only edit events belonging to their college — but a
    // coordinator who created an event before its college field was set
    // (or otherwise left blank/mismatched) couldn't manage their own event
    // under a college-only check, so the creator is always let through too.
    if (req.user.college) {
      const existing = await Event.findById(req.params.id, 'college created_by').lean();
      if (!existing) return res.status(404).json({ message: 'Event not found.' });
      const ownsIt = String(existing.created_by) === String(req.user.id);
      if (!ownsIt && existing.college !== req.user.college) {
        return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
      }
    }

    const updates = {};
    if (title          !== undefined) updates.title          = title.trim();
    if (description    !== undefined) updates.description    = description.trim();
    if (image          !== undefined) updates.image          = image || '';
    if (location       !== undefined) updates.location       = location.trim();
    if (event_datetime !== undefined) updates.event_datetime = new Date(event_datetime);
    if (end_datetime   !== undefined) updates.end_datetime   = end_datetime ? new Date(end_datetime) : null;
    if (visibility     !== undefined) {
      const visibilityError = assertVisibilityAllowed(req.user, visibility);
      if (visibilityError) return res.status(403).json({ message: visibilityError });
      updates.visibility = visibility;
      updates.college    = resolveEventCollege(req.user, visibility);
    }
    if (capacity       !== undefined) updates.capacity       = Number(capacity) || 0;

    const event = await Event.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    const interested_count = await EventInterested.countDocuments({ event_id: event._id });
    res.json({ event: { ...event.toObject(), interested_count } });
  } catch (err) {
    console.error('updateEvent error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /coordinator/events/:id
const deleteEvent = async (req, res) => {
  try {
    // Coordinators can only delete events belonging to their college — same
    // creator-fallback as updateEvent above.
    if (req.user.college) {
      const existing = await Event.findById(req.params.id, 'college created_by').lean();
      if (!existing) return res.status(404).json({ message: 'Event not found.' });
      const ownsIt = String(existing.created_by) === String(req.user.id);
      if (!ownsIt && existing.college !== req.user.college) {
        return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
      }
    }

    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    await EventInterested.deleteMany({ event_id: req.params.id });
    await Notification.deleteMany({ event_id: req.params.id });
    await AttendanceLog.deleteMany({ event_id: req.params.id });
    await EventFeedback.deleteMany({ event_id: req.params.id });
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    console.error('deleteEvent error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/events/:id/interested
const getInterestedAlumni = async (req, res) => {
  try {
    // Coordinators can only view interest for events belonging to their
    // college — updateEvent/deleteEvent above already guard this same way
    // (with the same creator-fallback); without it, a coordinator who
    // knows/guesses another college's event ID could read that college's
    // interested-alumni list directly.
    if (req.user.college) {
      const event = await Event.findById(req.params.id, 'college created_by').lean();
      if (!event) return res.status(404).json({ message: 'Event not found.' });
      const ownsIt = String(event.created_by) === String(req.user.id);
      if (!ownsIt && event.college !== req.user.college) {
        return res.status(403).json({ message: 'Access denied. This event belongs to another college.' });
      }
    }

    const records = await EventInterested.find({ event_id: req.params.id })
      .populate('alumni_id', 'firstName lastName email course')
      .sort({ createdAt: -1 })
      .lean();

    const alumni = records.map(r => ({
      _id:          r.alumni_id?._id,
      name:         r.alumni_id ? `${r.alumni_id.firstName} ${r.alumni_id.lastName}` : 'Unknown',
      email:        r.alumni_id?.email  || '',
      course:       r.alumni_id?.course || '',
      interestedAt: r.createdAt,
    }));

    res.json({ alumni, total: alumni.length });
  } catch (err) {
    console.error('getInterestedAlumni error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/events — read-only, scoped to what this alumni can see
// (public events, events open to all alumni, and events scoped to their
// own college) rather than the coordinator/admin-only getEvents above.
const getAlumniEvents = async (req, res) => {
  try {
    const college = req.user.college || '';
    const visibilities = ['Public', 'All Alumni'];
    if (college) visibilities.push(college, `${college} Alumni`);

    const events = await Event.find({ visibility: { $in: visibilities } })
      .sort({ event_datetime: -1 })
      .lean();

    const eventIds = events.map((e) => e._id);
    const [counts, mine, myAttendance, myFeedback] = await Promise.all([
      EventInterested.aggregate([
        { $match: { event_id: { $in: eventIds } } },
        { $group: { _id: '$event_id', count: { $sum: 1 } } },
      ]),
      EventInterested.find({ event_id: { $in: eventIds }, alumni_id: req.user.id }).select('event_id').lean(),
      // Scoped to this one alumnus across all their visible events — two
      // bulk queries here instead of a per-event lookup, same batching
      // pattern as `mine` above.
      AttendanceLog.find({ event_id: { $in: eventIds }, alumni_id: req.user.id }).select('event_id status').lean(),
      EventFeedback.find({ event_id: { $in: eventIds }, alumni_id: req.user.id }).select('event_id').lean(),
    ]);
    const countMap = {};
    counts.forEach((c) => { countMap[String(c._id)] = c.count; });
    const mySet = new Set(mine.map((m) => String(m.event_id)));
    // A logged "Absent" row means the coordinator recorded this alumnus as
    // expected-but-not-present — that's not attendance, so it doesn't count
    // toward feedback eligibility below.
    const attendedMap = {};
    myAttendance.forEach((a) => { attendedMap[String(a.event_id)] = a.status !== 'Absent'; });
    const feedbackSubmittedSet = new Set(myFeedback.map((f) => String(f.event_id)));

    // Sent immediately — the reminder/feedback notification bookkeeping
    // below is pure background housekeeping the alumnus never sees directly
    // (it just makes a Notification show up later), so there's no reason to
    // make every single events-page load wait on 2 extra queries + 2
    // conditional inserts before the page can render. It used to run before
    // res.json, adding real, avoidable latency to every load.
    res.json({
      events: events.map((e) => {
        const attended = !!attendedMap[String(e._id)];
        // "Not Available" until the event has ended AND this alumnus
        // attended — the frontend never has to independently decide this,
        // it just renders whatever the backend already resolved.
        let feedbackStatus = 'not_available';
        if (isEventEnded(e) && attended) {
          feedbackStatus = feedbackSubmittedSet.has(String(e._id)) ? 'submitted' : 'available';
        }
        return {
          ...e,
          interested_count: countMap[String(e._id)] || 0,
          isInterestedByMe: mySet.has(String(e._id)),
          attended,
          feedbackStatus,
        };
      }),
    });

    // There's no scheduler/cron in this app to fire a reminder exactly N
    // hours before an event, so the reminder is generated lazily here: any
    // time this alumnus loads their events, check their interested events
    // for ones starting within 24h and create the reminder Notification if
    // one hasn't already gone out for that alumnus+event pair.
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dueSoon = events.filter((e) => mySet.has(String(e._id)) && new Date(e.event_datetime) > now && new Date(e.event_datetime) <= soon);
    if (dueSoon.length) {
      const alreadySent = await Notification.find({
        user_id: req.user.id,
        type: 'reminder_due',
        event_id: { $in: dueSoon.map((e) => e._id) },
      }).select('event_id').lean();
      const sentSet = new Set(alreadySent.map((n) => String(n.event_id)));
      const toCreate = dueSoon
        .filter((e) => !sentSet.has(String(e._id)))
        .map((e) => ({
          user_id:  req.user.id,
          title:    'Event Starting Soon',
          message:  `"${e.title}" is happening soon — ${new Date(e.event_datetime).toLocaleString('en-PH', { month: 'long', day: '2-digit', hour: 'numeric', minute: '2-digit' })}${e.location ? ` at ${e.location}` : ''}.`,
          is_read:  false,
          event_id: e._id,
          type:     'reminder_due',
        }));
      if (toCreate.length) await Notification.insertMany(toCreate);
    }

    // Same lazy-generation approach as the reminder above — there's no
    // scheduler to fire this right when an event ends, so it's checked
    // whenever this alumnus next loads their events: any event they
    // attended that has since ended, with feedback still not submitted,
    // gets a one-time "Feedback Available" notification.
    const feedbackReady = events.filter((e) => attendedMap[String(e._id)] && isEventEnded(e) && !feedbackSubmittedSet.has(String(e._id)));
    if (feedbackReady.length) {
      const alreadyNotified = await Notification.find({
        user_id: req.user.id,
        type: 'feedback_available',
        event_id: { $in: feedbackReady.map((e) => e._id) },
      }).select('event_id').lean();
      const notifiedSet = new Set(alreadyNotified.map((n) => String(n.event_id)));
      const toNotify = feedbackReady
        .filter((e) => !notifiedSet.has(String(e._id)))
        .map((e) => ({
          user_id:  req.user.id,
          title:    'Feedback Available',
          message:  `"${e.title}" has ended — share your feedback to help us plan better events.`,
          is_read:  false,
          event_id: e._id,
          type:     'feedback_available',
        }));
      if (toNotify.length) await Notification.insertMany(toNotify);
    }
  } catch (err) {
    console.error('getAlumniEvents error:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/events/:id/interested  (alumni-accessible — separate route)
const toggleInterested = async (req, res) => {
  try {
    const existing = await EventInterested.findOne({
      event_id:  req.params.id,
      alumni_id: req.user.id,
    });

    if (existing) {
      await existing.deleteOne();
      return res.json({ interested: false });
    }

    await EventInterested.create({ event_id: req.params.id, alumni_id: req.user.id });

    // Notify the event creator (coordinator)
    const event = await Event.findById(req.params.id).lean();
    if (event) {
      const alumni = await User.findById(req.user.id, 'firstName lastName').lean();
      await Notification.create({
        user_id:  event.created_by,
        title:    'Alumni Interested',
        message:  `${alumni ? `${alumni.firstName} ${alumni.lastName}` : 'An alumni'} marked interest in "${event.title}"`,
        is_read:  false,
        event_id: event._id,
        type:     'interested',
      });

      // Confirm the "Remind" click actually did something — the button
      // toggling isInterestedByMe alone was invisible to the alumnus once
      // they left the events page; this gives them a real notification
      // that a reminder is now set for this event.
      await Notification.create({
        user_id:  req.user.id,
        title:    'Reminder Set',
        message:  `You'll get a reminder for "${event.title}" on ${new Date(event.event_datetime).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: '2-digit' })}.`,
        is_read:  false,
        event_id: event._id,
        type:     'reminder_set',
      });
    }

    res.json({ interested: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ interested: true });
    console.error('toggleInterested error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/notifications
const getCoordinatorNotifications = async (req, res) => {
  try {
    // `unread` must count ALL unread notifications, not just those within
    // the 20 most recently fetched — counting after the .limit(20) silently
    // undercounts the badge whenever more than 20 unread notifications
    // exist (e.g. 30 unread but only 12 of the latest 20 are unread shows
    // "12" instead of "30").
    const [notifs, unread] = await Promise.all([
      Notification.find({ user_id: req.user.id }).sort({ createdAt: -1 }).limit(20).lean(),
      Notification.countDocuments({ user_id: req.user.id, is_read: false }),
    ]);
    res.json({ notifications: notifs, unread });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /coordinator/notifications/read
const markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user_id: req.user.id, is_read: false }, { is_read: true });
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getInterestedAlumni,
  getAlumniEvents,
  toggleInterested,
  getCoordinatorNotifications,
  markNotificationsRead,
};
