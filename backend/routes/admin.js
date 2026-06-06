const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { createUser, getUsers, updateUser, deleteUser, importUsers, upload } = require('../controllers/adminController');
const { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, bumpSocial } = require('../controllers/announcementController');

// All routes below require a valid token AND admin role
router.use(protect, authorize('admin'));

router.post('/users',               createUser);
router.post('/users/import',        upload.single('file'), importUsers);
router.get('/users',                getUsers);
router.patch('/users/:id',          updateUser);
router.delete('/users/:id',         deleteUser);

router.get('/announcements',             getAnnouncements);
router.post('/announcements',            createAnnouncement);
router.patch('/announcements/:id',       updateAnnouncement);
router.delete('/announcements/:id',      deleteAnnouncement);
router.post('/announcements/:id/bump',   bumpSocial);

module.exports = router;
