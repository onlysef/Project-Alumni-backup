const Announcement = require('../models/Announcement');

// GET /api/admin/announcements
const getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json({ announcements });
  } catch (err) {
    console.error('getAnnouncements error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/announcements
const createAnnouncement = async (req, res) => {
  try {
    const { title, description, type, imageUrl } = req.body;
    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required.' });
    }
    const announcement = await Announcement.create({
      title: title.trim(),
      description: description.trim(),
      type: type || 'News',
      imageUrl: imageUrl || '',
      createdBy: req.user.id,
    });
    res.status(201).json({ message: 'Announcement created.', announcement });
  } catch (err) {
    console.error('createAnnouncement error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/announcements/:id
const updateAnnouncement = async (req, res) => {
  try {
    const { title, description, type, imageUrl } = req.body;
    const updates = {};
    if (title       !== undefined) updates.title       = title.trim();
    if (description !== undefined) updates.description = description.trim();
    if (type        !== undefined) updates.type        = type;
    if (imageUrl    !== undefined) updates.imageUrl    = imageUrl;

    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    );
    if (!announcement) return res.status(404).json({ message: 'Announcement not found.' });
    res.json({ message: 'Announcement updated.', announcement });
  } catch (err) {
    console.error('updateAnnouncement error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/announcements/:id
const deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ message: 'Announcement not found.' });
    res.json({ message: 'Announcement deleted.' });
  } catch (err) {
    console.error('deleteAnnouncement error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/announcements/:id/bump
// body: { field: 'likes' | 'comments' | 'shares' }
const bumpSocial = async (req, res) => {
  try {
    const { field } = req.body;
    if (!['likes', 'comments', 'shares'].includes(field)) {
      return res.status(400).json({ message: 'Invalid field.' });
    }
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $inc: { [field]: 1 } },
      { new: true }
    );
    if (!announcement) return res.status(404).json({ message: 'Announcement not found.' });
    res.json({ announcement });
  } catch (err) {
    console.error('bumpSocial error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, bumpSocial };
