const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getEmploymentRecords, getEmploymentActivity } = require('../controllers/employmentController');
const User = require('../models/User');
const AlumniEmployment = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');

router.use(protect, authorize('admin', 'coordinator'));

// Must declare /activity before plain /employment to avoid route collision
router.get('/employment/activity', getEmploymentActivity);
router.get('/employment',          getEmploymentRecords);

router.get('/alumni', async (req, res) => {
  try {
    const { course, year, search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);

    const match = { role: 'alumni' };
    if (course) match.course = course;
    if (year)   match.graduationYear = Number(year);

    let users = await User.find(match, 'firstName lastName email course graduationYear').sort({ lastName: 1 }).lean();

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
      };
    });

    res.json({ contacts, pagination: { page, limit, total, pages } });
  } catch (err) {
    console.error('coordinator /alumni error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
