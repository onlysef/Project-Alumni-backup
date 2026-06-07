const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { createUser, getUsers, updateUser, deleteUser, importUsers, upload } = require('../controllers/adminController');
const {
  getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  toggleLike, getComments, addComment, trackShare,
} = require('../controllers/announcementController');
const {
  getPartnerships, createPartnership, updatePartnership, deletePartnership,
} = require('../controllers/partnershipController');
const { getAllJobs } = require('../controllers/jobController');

// All routes below require a valid token AND admin role
router.use(protect, authorize('admin'));

router.post('/users',               createUser);
router.post('/users/import',        upload.single('file'), importUsers);
router.get('/users',                getUsers);
router.patch('/users/:id',          updateUser);
router.delete('/users/:id',         deleteUser);

router.get('/announcements',                    getAnnouncements);
router.post('/announcements',                   createAnnouncement);
router.patch('/announcements/:id',              updateAnnouncement);
router.delete('/announcements/:id',             deleteAnnouncement);
router.post('/announcements/:id/like',          toggleLike);
router.get('/announcements/:id/comments',       getComments);
router.post('/announcements/:id/comment',       addComment);
router.post('/announcements/:id/share',         trackShare);

router.get('/partnerships',        getPartnerships);
router.post('/partnerships',       createPartnership);
router.patch('/partnerships/:id',  updatePartnership);
router.delete('/partnerships/:id', deletePartnership);

router.get('/jobs', getAllJobs);

module.exports = router;
