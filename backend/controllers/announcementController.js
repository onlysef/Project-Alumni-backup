const Announcement = require('../models/Announcement');
const ActivityLog  = require('../models/ActivityLog');
const User = require('../models/User');
const { isJunkText } = require('../utils/textQuality');

async function resolveUserName(userId) {
  try {
    const user = await User.findById(userId).select('firstName lastName');
    return user ? `${user.firstName} ${user.lastName}` : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// Shared projection every branch of the getAnnouncements union below must
// end on — $unionWith requires each side to converge on the same field set,
// or rows from whichever branch is missing a field just silently omit it
// instead of erroring, which reads as a data bug rather than a merge bug.
const ANNOUNCEMENT_UNION_PROJECT = {
  title: 1, description: 1, type: 1, imageUrl: 1, location: 1,
  createdAt: 1, updatedAt: 1, createdBy: 1, posterName: 1, source: 1,
  likesCount: 1, commentsCount: 1, sharesCount: 1,
  isLikedByMe: 1, isSharedByMe: 1, hasImage: 1,
  // Event/Job-only fields, carried through so the frontend's edit modal can
  // pre-fill them — absent on Announcement rows (and on whichever of these
  // two the row isn't), which projects as simply missing, not an error.
  event_datetime: 1, end_datetime: 1, capacity: 1, jobType: 1, status: 1,
  // Job-only structured fields (replaced the single free-text `description`
  // a Job posting used to have — Announcement/Event still use `description`
  // above, unaffected).
  jobDescription: 1, keyResponsibilities: 1, qualifications: 1, preferredSkills: 1, salaryRange: 1,
};

// $lookup + $let + $concat pattern shared by every branch below to resolve
// "posterName" from whichever ref field that collection actually uses
// (Announcement.createdBy / Event.created_by / Job.postedBy) — factored out
// once instead of copy-pasted three times with three different field names.
function posterNameStages(refField) {
  return [
    { $lookup: { from: 'users', localField: refField, foreignField: '_id', as: '_poster' } },
    { $addFields: {
      posterName: {
        $let: {
          vars: { p: { $arrayElemAt: ['$_poster', 0] } },
          in: { $trim: { input: { $concat: [{ $ifNull: ['$$p.firstName', ''] }, ' ', { $ifNull: ['$$p.lastName', ''] }] } } },
        },
      },
    }},
  ];
}

// GET /api/admin/announcements — merges 3 distinct collections into one feed
// (Announcement, plus coordinator-created Event and employer-created Job)
// via $unionWith. Coordinators/employers have no admin-style "announcement"
// composer of their own — their real activity lives in Event/Job — so
// admin's "Posted Announcements" only ever showed admin's OWN posts,
// nothing coordinators or employers actually published. Event/Job rows are
// tagged source: 'event'/'job' (vs 'announcement') so the frontend can route
// Edit to the right modal/endpoint for each (updateEventAdmin/updateJobAdmin
// below) — they have no likedBy/comments/sharedBy of their own, so like/
// comment/share stay disabled for them, but title/description/etc. are
// editable here directly, without leaving for Event Management/Job Connect.
const getAnnouncements = async (req, res) => {
  try {
    const { Types } = require('mongoose');
    const userId = req.user?.id ? new Types.ObjectId(req.user.id) : null;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    // The $lookup (posterNameStages) used to run here, on every document in
    // all 3 collections, BEFORE $sort/$skip/$limit ever threw most of them
    // away — and the whole thing ran a second time for $count. That's 6
    // rounds of $lookup work (3 collections x 2 passes) for what's usually a
    // 20-row page: a growing dataset means this cost scaled with the TOTAL
    // row count, not the page size, which is exactly the wrong shape and the
    // actual cause of admin's "Posted Announcements" getting slower over
    // time. `createdBy` here is already normalized to the same field name
    // across all 3 sources — the one real $lookup now runs once, only on the
    // page actually being returned, in the section below.
    const unionPipeline = [
      { $addFields: {
        likesCount:    { $cond: [{ $isArray: '$likedBy' },  { $size: '$likedBy' },  0] },
        commentsCount: { $cond: [{ $isArray: '$comments' }, { $size: '$comments' }, 0] },
        sharesCount:   { $cond: [{ $isArray: '$sharedBy' }, { $size: '$sharedBy' }, 0] },
        isLikedByMe:   userId ? { $in: [userId, { $ifNull: ['$likedBy',  []] }] } : false,
        isSharedByMe:  userId ? { $in: [userId, { $ifNull: ['$sharedBy', []] }] } : false,
        hasImage:      { $gt: [{ $strLenCP: { $ifNull: ['$imageUrl', ''] } }, 0] },
        source:        'announcement',
      }},
      { $project: ANNOUNCEMENT_UNION_PROJECT },
      { $unionWith: {
        coll: 'events',
        pipeline: [
          { $addFields: {
            type: 'Event',
            imageUrl: { $ifNull: ['$image', ''] },
            createdBy: '$created_by',
            likesCount: 0, commentsCount: 0, sharesCount: 0,
            isLikedByMe: false, isSharedByMe: false,
            hasImage: { $gt: [{ $strLenCP: { $ifNull: ['$image', ''] } }, 0] },
            source: 'event',
          }},
          { $project: ANNOUNCEMENT_UNION_PROJECT },
        ],
      }},
      { $unionWith: {
        coll: 'jobs',
        pipeline: [
          { $addFields: {
            type: 'Job Posting',
            imageUrl: '',
            createdBy: '$postedBy',
            likesCount: 0, commentsCount: 0, sharesCount: 0,
            isLikedByMe: false, isSharedByMe: false,
            hasImage: false,
            source: 'job',
          }},
          { $project: ANNOUNCEMENT_UNION_PROJECT },
        ],
      }},
    ];

    const [pageRows, totalRows] = await Promise.all([
      Announcement.aggregate([
        ...unionPipeline,
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        ...posterNameStages('createdBy'),
        { $project: { _poster: 0 } },
      ]),
      Announcement.aggregate([...unionPipeline, { $count: 'total' }]),
    ]);
    const total = totalRows[0]?.total ?? 0;

    res.json({ announcements: pageRows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('getAnnouncements error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/announcements — a deliberately separate, lean function
// from getAnnouncements above, NOT a shared call with different params.
// routes/alumni.js used to point straight at getAnnouncements — harmless
// before it grew the 3-collection $unionWith (Announcement + Event + Job,
// each with its own $lookup to resolve a poster name) for the admin-only
// merged feed, but the alumni News/Events tab doesn't show source/posterName
// at all, so every alumni page load was paying for that admin-only join
// work for nothing — the actual reported slowdown. Alumni only ever need
// real Announcement documents anyway (Event/Job rows would show up as
// out-of-place "News" cards with no like/comment/share of their own).
const getAlumniAnnouncements = async (req, res) => {
  try {
    const { Types } = require('mongoose');
    const userId = req.user?.id ? new Types.ObjectId(req.user.id) : null;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    const [announcements, total] = await Promise.all([
      Announcement.aggregate([
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $addFields: {
          likesCount:    { $cond: [{ $isArray: '$likedBy' },  { $size: '$likedBy' },  0] },
          commentsCount: { $cond: [{ $isArray: '$comments' }, { $size: '$comments' }, 0] },
          sharesCount:   { $cond: [{ $isArray: '$sharedBy' }, { $size: '$sharedBy' }, 0] },
          isLikedByMe:   userId ? { $in: [userId, { $ifNull: ['$likedBy',  []] }] } : false,
          isSharedByMe:  userId ? { $in: [userId, { $ifNull: ['$sharedBy', []] }] } : false,
          hasImage:      { $gt: [{ $strLenCP: { $ifNull: ['$imageUrl', ''] } }, 0] },
        }},
        { $project: {
          title: 1, description: 1, type: 1, imageUrl: 1, location: 1,
          createdAt: 1, updatedAt: 1,
          likesCount: 1, commentsCount: 1, sharesCount: 1,
          isLikedByMe: 1, isSharedByMe: 1, hasImage: 1,
        }},
      ]),
      Announcement.countDocuments(),
    ]);

    res.json({ announcements, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('getAlumniAnnouncements error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/announcements/events/:id — lets admin edit an Event
// (normally only its Coordinator can, scoped to their own college) directly
// from the merged feed above. Deliberately its own admin-only function
// rather than reusing eventController.updateEvent — that one enforces
// college ownership whenever req.user.college is set, which is exactly the
// restriction an admin editing ANY college's event must NOT be subject to.
const updateEventAdmin = async (req, res) => {
  try {
    const Event = require('../models/Event');
    const { title, description, location, event_datetime, end_datetime, capacity } = req.body;
    const updates = {};
    if (title          !== undefined) updates.title          = title.trim();
    if (description    !== undefined) updates.description    = description.trim();
    if (location       !== undefined) updates.location       = location.trim();
    if (event_datetime !== undefined) updates.event_datetime = new Date(event_datetime);
    if (end_datetime   !== undefined) updates.end_datetime   = end_datetime ? new Date(end_datetime) : null;
    if (capacity       !== undefined) updates.capacity       = Number(capacity) || 0;

    const event = await Event.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    res.json({ message: 'Event updated.', event });
  } catch (err) {
    console.error('updateEventAdmin error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/announcements/jobs/:id — lets admin edit a Job posting
// (normally only the Employer who posted it can) directly from the merged
// feed above. jobController.updateJob is scoped with
// `Job.findOne({ _id, postedBy: req.user.id })`, which would always 404 for
// an admin (their id never matches a real employer's postedBy) — a separate
// admin function that looks up by id alone is needed, not a reuse.
const updateJobAdmin = async (req, res) => {
  try {
    const Job = require('../models/Job');
    // Mirrors jobController.postJob/updateJob's own checks — this admin path
    // bypasses those (it goes through Job.findByIdAndUpdate directly, not
    // the employer controller), so without repeating the same validation
    // here an admin edit could blank out the description or set a bogus
    // jobType that Mongoose's enum would otherwise reject with an opaque 500.
    const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
    const OPTIONAL_TEXT_FIELDS = ['keyResponsibilities', 'qualifications', 'preferredSkills', 'salaryRange', 'location'];
    const { title, jobDescription, keyResponsibilities, qualifications, preferredSkills, salaryRange, jobType, location } = req.body;
    if (jobType !== undefined && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ message: `Invalid job type. Must be one of: ${JOB_TYPES.join(', ')}.` });
    }
    const invalidField = OPTIONAL_TEXT_FIELDS.find((f) => req.body[f] !== undefined && typeof req.body[f] !== 'string');
    if (invalidField) return res.status(400).json({ message: `${invalidField} must be text.` });
    if (jobDescription !== undefined && (typeof jobDescription !== 'string' || !jobDescription.trim())) {
      return res.status(400).json({ message: 'A job description is required.' });
    }
    // Same keyboard-mashing guard as jobController.postJob/updateJob.
    const JUNK_FIELD_RULES = {
      title:               { requireWord: true,  minLength: 3, blockAtSymbol: true },
      jobDescription:      { requireWord: true,  minLength: 15, requireMultiWord: true },
      keyResponsibilities: { requireWord: true,  requireMultiWord: true },
      qualifications:      { requireWord: true,  requireMultiWord: true },
      preferredSkills:     { requireWord: true,  requireMultiWord: true },
      location:            { requireWord: true,  blockAtSymbol: true, blockLongDigitRun: true },
      salaryRange:         { requireWord: false, requireDigitOrPhrase: true },
    };
    const JUNK_FIELD_MESSAGES = {
      title: 'That doesn\'t look like a real job title.',
      jobDescription: 'The job description looks like random text. Please write an actual description of the role.',
      keyResponsibilities: 'Key responsibilities looks like random text. Please list the actual duties for this role.',
      qualifications: 'Qualifications & requirements looks like random text. Please list the actual qualifications needed.',
      preferredSkills: 'Preferred skills looks like random text. Please list actual skills.',
      location: 'That doesn\'t look like a real location.',
      salaryRange: 'That doesn\'t look like a real salary range.',
    };
    const junkField = Object.keys(JUNK_FIELD_RULES).find(
      (f) => req.body[f] !== undefined && req.body[f] !== '' && isJunkText(req.body[f], JUNK_FIELD_RULES[f])
    );
    if (junkField) return res.status(400).json({ message: JUNK_FIELD_MESSAGES[junkField] });

    const updates = {};
    if (title       !== undefined) {
      if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ message: 'Title is required.' });
      updates.title = title.trim();
    }
    if (jobDescription      !== undefined) updates.jobDescription      = jobDescription;
    if (keyResponsibilities !== undefined) updates.keyResponsibilities = keyResponsibilities;
    if (qualifications      !== undefined) updates.qualifications      = qualifications;
    if (preferredSkills     !== undefined) updates.preferredSkills     = preferredSkills;
    if (salaryRange         !== undefined) updates.salaryRange         = salaryRange;
    if (jobType     !== undefined) updates.jobType     = jobType;
    if (location    !== undefined) updates.location    = location;

    const job = await Job.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    // Same title-sync as the employer's own updateJob — keeps applicants'
    // snapshotted job title from silently going stale after an admin edit.
    if (title !== undefined) {
      const JobApplication = require('../models/JobApplication');
      await JobApplication.updateMany({ job_id: job._id }, { title: job.title });
    }

    res.json({ message: 'Job updated.', job });
  } catch (err) {
    console.error('updateJobAdmin error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/announcements/events/:id — admin deleting any Event from
// the merged feed. Same cleanup as coordinator eventController.deleteEvent
// (an Event alone left behind orphaned interest/notification/attendance/
// feedback rows pointing at nothing), just without the college-ownership
// check, which only ever applied to a coordinator's own scope anyway.
const deleteEventAdmin = async (req, res) => {
  try {
    const Event = require('../models/Event');
    const EventInterested = require('../models/EventInterested');
    const Notification = require('../models/Notification');
    const AttendanceLog = require('../models/AttendanceLog');
    const EventFeedback = require('../models/EventFeedback');

    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    await EventInterested.deleteMany({ event_id: req.params.id });
    await Notification.deleteMany({ event_id: req.params.id });
    await AttendanceLog.deleteMany({ event_id: req.params.id });
    await EventFeedback.deleteMany({ event_id: req.params.id });
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    console.error('deleteEventAdmin error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/announcements/jobs/:id — admin deleting any Job from the
// merged feed. Keeps jobController.deleteJob's "never hard-delete a posting
// with real applicant history" safety check (close it instead) — that rule
// protects the applicants' own data, not the employer's ownership, so it
// applies just as much to an admin-initiated delete.
const deleteJobAdmin = async (req, res) => {
  try {
    const Job = require('../models/Job');
    const JobApplication = require('../models/JobApplication');

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    const applicantCount = await JobApplication.countDocuments({ job_id: job._id });
    if (applicantCount > 0) {
      return res.status(409).json({
        message: `This post has ${applicantCount} applicant${applicantCount === 1 ? '' : 's'}. Close it instead of deleting so applicant records aren't lost.`,
      });
    }

    await job.deleteOne();
    res.json({ message: 'Job deleted.' });
  } catch (err) {
    console.error('deleteJobAdmin error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/announcements
const createAnnouncement = async (req, res) => {
  try {
    const { title, description, type, imageUrl, location } = req.body;
    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required.' });
    }
    const announcement = await Announcement.create({
      title: title.trim(),
      description: description.trim(),
      type: type || 'News',
      imageUrl: imageUrl || '',
      location: (location || '').trim(),
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
    const { title, description, type, imageUrl, location } = req.body;
    const updates = {};
    if (title       !== undefined) updates.title       = title.trim();
    if (description !== undefined) updates.description = description.trim();
    if (type        !== undefined) updates.type        = type;
    if (imageUrl    !== undefined) updates.imageUrl    = imageUrl;
    if (location    !== undefined) updates.location    = location.trim();

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

    res.json({ liked, likesCount: ann.likedBy.length });
  } catch (err) {
    console.error('toggleLike error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/announcements/:id/comments
const getComments = async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id)
      .select('comments')
      .populate('comments.user', 'firstName lastName avatarUrl');
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    // `userName` on each comment is a plain string frozen at post time — if
    // that commenter later changes their name (e.g. via Accounts), every
    // past comment kept showing the old name forever. Resolving the live
    // User record here reflects a name change retroactively, falling back
    // to the frozen text only if the commenter's account was deleted. Same
    // reasoning applies to avatarUrl, which isn't stored on the comment at
    // all — always read live so a profile photo added/changed after the
    // comment was posted still shows up.
    const comments = ann.comments.map((c) => {
      const obj = c.toObject();
      if (c.user && c.user.firstName) obj.userName = `${c.user.firstName} ${c.user.lastName}`;
      obj.avatarUrl = c.user?.avatarUrl || '';
      return obj;
    });
    res.json({ comments });
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

    const user = await User.findById(req.user.id).select('firstName lastName avatarUrl');
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Admin';

    const ann = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { user: req.user.id, userName, text: text.trim() } } },
      { new: true, select: 'comments title' }
    );
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    const newComment = { ...ann.comments[ann.comments.length - 1].toObject(), avatarUrl: user?.avatarUrl || '' };

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

// PUT /api/{admin,alumni}/announcements/:id/comment/:commentId — unlike
// delete, editing is owner-only even for admins: moderating means removing
// a comment, never putting words in someone else's mouth.
const updateComment = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Comment text is required.' });

    const ann = await Announcement.findById(req.params.id).select('comments');
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found.' });
    if (String(comment.user) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You can only edit your own comment.' });
    }

    comment.text     = text.trim();
    comment.editedAt = new Date();
    await ann.save();
    res.json({ comment: { _id: comment._id, text: comment.text, editedAt: comment.editedAt } });
  } catch (err) {
    console.error('updateComment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/{admin,alumni}/announcements/:id/comment/:commentId — admins
// moderate, so any comment (alumni, coordinator, or another admin) can be
// removed; everyone else may only remove their own.
const deleteComment = async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id).select('comments');
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });

    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found.' });
    if (req.user.role !== 'admin' && String(comment.user) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You can only delete your own comment.' });
    }

    comment.deleteOne();
    await ann.save();
    res.json({ commentsCount: ann.comments.length });
  } catch (err) {
    console.error('deleteComment error:', err);
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

    res.json({ shared: true, sharesCount: ann.sharedBy.length });
  } catch (err) {
    console.error('trackShare error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/announcements/activity — recent post interactions only.
const getRecentActivity = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const fullHistory = req.query.hours === 'all';
    const requestedHours = parseInt(req.query.hours);
    const hours = fullHistory ? null : (Number.isFinite(requestedHours)
      ? Math.min(168, Math.max(1, requestedHours))
      : 24);
    const match = fullHistory
      ? {}
      : { createdAt: { $gte: new Date(Date.now() - hours * 60 * 60 * 1000) } };
    const activities = await ActivityLog.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('user_name action announcement_title announcement_id createdAt');
    res.json({ activities, windowHours: hours, fullHistory });
  } catch (err) {
    console.error('getRecentActivity error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/announcements/recent  — 5 most recent with imageUrl (for sidebar)
const getRecentAnnouncements = async (req, res) => {
  try {
    const { Types } = require('mongoose');
    const userId = req.user?.id ? new Types.ObjectId(req.user.id) : null;
    const limit  = Math.min(10, Math.max(1, parseInt(req.query.limit) || 5));

    const announcements = await Announcement.aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      { $addFields: {
        likesCount:    { $cond: [{ $isArray: '$likedBy' },  { $size: '$likedBy' },  0] },
        commentsCount: { $cond: [{ $isArray: '$comments' }, { $size: '$comments' }, 0] },
        sharesCount:   { $cond: [{ $isArray: '$sharedBy' }, { $size: '$sharedBy' }, 0] },
        isLikedByMe:   userId ? { $in: [userId, { $ifNull: ['$likedBy',  []] }] } : false,
        isSharedByMe:  userId ? { $in: [userId, { $ifNull: ['$sharedBy', []] }] } : false,
      }},
      { $project: {
        title: 1, description: 1, type: 1, imageUrl: 1,
        createdAt: 1,
        likesCount: 1, commentsCount: 1, sharesCount: 1,
        isLikedByMe: 1, isSharedByMe: 1,
      }},
    ]);
    res.json({ announcements });
  } catch (err) {
    console.error('getRecentAnnouncements error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/announcements/:id  — full data including imageUrl (for modal)
const getAnnouncement = async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id)
      .select('title description type imageUrl location createdAt updatedAt likedBy sharedBy comments')
      .populate('comments.user', 'avatarUrl')
      .lean();
    if (!ann) return res.status(404).json({ message: 'Announcement not found.' });
    const userId = String(req.user?.id || '');
    res.json({
      announcement: {
        ...ann,
        comments:      ann.comments.map((c) => ({ ...c, avatarUrl: c.user?.avatarUrl || '' })),
        likesCount:    ann.likedBy?.length  ?? 0,
        commentsCount: ann.comments?.length ?? 0,
        sharesCount:   ann.sharedBy?.length ?? 0,
        isLikedByMe:   ann.likedBy?.some(id => String(id) === userId) ?? false,
        isSharedByMe:  ann.sharedBy?.some(id => String(id) === userId) ?? false,
      },
    });
  } catch (err) {
    console.error('getAnnouncement error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getAnnouncements, getAlumniAnnouncements, getAnnouncement, getRecentAnnouncements,
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  toggleLike, getComments, addComment, updateComment, deleteComment, trackShare, getRecentActivity,
  updateEventAdmin, updateJobAdmin, deleteEventAdmin, deleteJobAdmin,
};
