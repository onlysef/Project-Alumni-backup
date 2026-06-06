const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { createUser, getUsers, updateUser, deleteUser } = require('../controllers/adminController');

// All routes below require a valid token AND admin role
router.use(protect, authorize('admin'));

router.post('/users',       createUser);
router.get('/users',        getUsers);
router.patch('/users/:id',  updateUser);
router.delete('/users/:id', deleteUser);

module.exports = router;
