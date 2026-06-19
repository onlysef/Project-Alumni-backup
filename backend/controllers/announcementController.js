const Announcement = require('../models/Announcement');
const ActivityLog  = require('../models/ActivityLog');
const User = require('../models/User');

async function resolveUserName(userId) {
  try {
    const user = await User.findById(userId).select('firstName lastName');
    return user ? `${user.firstName} ${user.lastName}` : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// GET /api/admin/announcements
const getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.aggregate([
      { $sort: { createdAt: -1 } },
      { $addFields: {
        likesCount:    { $cond: [{ $isArray: '$likedBy' },   { $size: '$likedBy' },   0] },
        commentsCount: { $cond: [{ $isArray: '$comments' },  { $size: '$comments' },  0] },
        sharesCount:   { $cond: [{ $isArray: '$sharedBy' },  { $size: '$sharedBy' },  0] },
      }},
      { $project: {
        title: 1, description: 1, type: 1, imageUrl: 1,
        createdAt: 1, updatedAt: 1, createdBy: 1,
        likedBy: 1, sharedBy: 1,
        likesCount: 1, commentsCount: 1, sharesCount: 1,
      }},
    ]);
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

// POST /api/admin/announcements/:id/like  — toggles like for the calling user
const toggleLike = async (req, res) => {
  try {
    const userId = req.user.id;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    const idx = ann.likedBy.findIndex(id => id.toString() === userId);
    let liked;
    if (idx === -1) {
      ann.likedBy.push(userId);
      liked = true;
    } else {
      ann.likedBy.splice(idx, 1);
      liked = false;
    }
    await ann.save();

    if (liked) {
      const userName = await resolveUserName(userId);
      await ActivityLog.deleteOne({ user_id: userId, action: 'liked', announcement_id: ann._id });
      ActivityLog.create({
        user_id:            userId,
        user_name:          userName,
        action:             'liked',
        announcement_id:    ann._id,
        announcement_title: ann.title,
      }).catch(() => {});
    } else {
      ActivityLog.deleteOne({ user_id: userId, action: 'liked', announcement_id: ann._id }).catch(() => {});
    }

    res.json({ liked, likesCount: ann.likedBy.length, likedBy: ann.likedBy });
  } catch (err) {
    console.error('toggleLike error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/announcements/:id/comments
const getComments = async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id).select('comments');
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });
    res.json({ comments: ann.comments });
  } catch (err) {
    console.error('getComments error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/announcements/:id/comment
const addComment = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Comment text is required.' });

    const user = await User.findById(req.user.id).select('firstName lastName');
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Admin';

    const ann = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { user: req.user.id, userName, text: text.trim() } } },
      { new: true, select: 'comments title' }
    );
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    const newComment = ann.comments[ann.comments.length - 1];

    ActivityLog.create({
      user_id:            req.user.id,
      user_name:          userName,
      action:             'commented on',
      announcement_id:    ann._id,
      announcement_title: ann.title || 'a post',
    }).catch(() => {});

    res.json({ comment: newComment, commentsCount: ann.comments.length });
  } catch (err) {
    console.error('addComment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/announcements/:id/share  — records a share once per user
const trackShare = async (req, res) => {
  try {
    const userId = req.user.id;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    const alreadyShared = ann.sharedBy.some(id => id.toString() === userId);
    if (!alreadyShared) {
      ann.sharedBy.push(userId);
      await ann.save();

      const userName = await resolveUserName(userId);
      ActivityLog.create({
        user_id:            userId,
        user_name:          userName,
        action:             'shared',
        announcement_id:    ann._id,
        announcement_title: ann.title,
      }).catch(() => {});
    }

    res.json({ shared: true, sharesCount: ann.sharedBy.length, sharedBy: ann.sharedBy });
  } catch (err) {
    console.error('trackShare error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/announcements/activity  — last 20 post interactions
const getRecentActivity = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const activities = await ActivityLog.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('user_name action announcement_title createdAt');
    res.json({ activities });
  } catch (err) {
    console.error('getRecentActivity error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  toggleLike, getComments, addComment, trackShare, getRecentActivity,
};
