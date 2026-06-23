const Event          = require('../models/Event');
const EventInterested = require('../models/EventInterested');
const Notification   = require('../models/Notification');
const User           = require('../models/User');

// GET /coordinator/events
const getEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ event_datetime: -1 }).lean();

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
    const { title, description, location, event_datetime, visibility } = req.body;
    if (!title?.trim())    return res.status(400).json({ message: 'Title is required.' });
    if (!event_datetime)   return res.status(400).json({ message: 'Date & time is required.' });

    const event = await Event.create({
      title:          title.trim(),
      description:    description?.trim() || '',
      location:       location?.trim()    || '',
      event_datetime: new Date(event_datetime),
      visibility:     visibility || 'Public',
      created_by:     req.user.id,
    });

    // Notify all active alumni
    const alumni = await User.find({ role: 'alumni', status: 'active' }, '_id').lean();
    if (alumni.length > 0) {
      await Notification.insertMany(
        alumni.map(a => ({
          user_id:  a._id,
          title:    'New Event',
          message:  `A new event has been posted: "${event.title}"`,
          is_read:  false,
          event_id: event._id,
          type:     'event',
        }))
      );
    }

    res.status(201).json({ event: { ...event.toObject(), interested_count: 0 } });
  } catch (err) {
    console.error('createEvent error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /coordinator/events/:id
const updateEvent = async (req, res) => {
  try {
    const { title, description, location, event_datetime, visibility } = req.body;
    const updates = {};
    if (title          !== undefined) updates.title          = title.trim();
    if (description    !== undefined) updates.description    = description.trim();
    if (location       !== undefined) updates.location       = location.trim();
    if (event_datetime !== undefined) updates.event_datetime = new Date(event_datetime);
    if (visibility     !== undefined) updates.visibility     = visibility;

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
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    await EventInterested.deleteMany({ event_id: req.params.id });
    await Notification.deleteMany({ event_id: req.params.id });
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    console.error('deleteEvent error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /coordinator/events/:id/interested
const getInterestedAlumni = async (req, res) => {
  try {
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
    const notifs = await Notification.find({ user_id: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    const unread = notifs.filter(n => !n.is_read).length;
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
  toggleInterested,
  getCoordinatorNotifications,
  markNotificationsRead,
};
