const Partnership = require('../models/Partnership');
const Job         = require('../models/Job');
const User        = require('../models/User');

// GET /api/admin/partnerships
const getPartnerships = async (req, res) => {
  try {
    const partnerships = await Partnership.find().sort({ createdAt: -1 });
    const active  = partnerships.filter(p => p.status === 'Active').length;
    const pending = partnerships.filter(p => p.status === 'Pending').length;
    const jobOpportunities = await Job.countDocuments({ status: 'open' });
    res.json({ partnerships, stats: { active, pending, jobOpportunities } });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/partnerships
const createPartnership = async (req, res) => {
  try {
    const { name, type, status, description, contact } = req.body;
    if (!name || !type) {
      return res.status(400).json({ message: 'name and type are required.' });
    }
    const partnership = await Partnership.create({ name, type, status, description, contact });
    res.status(201).json({ partnership });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/partnerships/:id
const updatePartnership = async (req, res) => {
  try {
    const { name, type, status, description, contact } = req.body;
    const partnership = await Partnership.findByIdAndUpdate(
      req.params.id,
      { name, type, status, description, contact },
      { new: true, runValidators: true }
    );
    if (!partnership) return res.status(404).json({ message: 'Partnership not found.' });
    res.json({ partnership });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/partnerships/:id
const deletePartnership = async (req, res) => {
  try {
    const partnership = await Partnership.findByIdAndDelete(req.params.id);
    if (!partnership) return res.status(404).json({ message: 'Partnership not found.' });

    // Deleting a Partnership used to leave two things dangling: any
    // employer account still pointing at it via User.partnershipId (postJob
    // re-checks that FK on every post, so those accounts silently lost the
    // ability to post with no indication why), and any Job already posted
    // under it (still open, still visible to alumni, with populate()
    // resolving its company to null). Unlinking the accounts and closing —
    // not deleting — the jobs matches the same "never hard-delete a posting
    // with real applicant history" policy jobController.deleteJob already
    // follows for a single job.
    await Promise.allSettled([
      User.updateMany({ partnershipId: partnership._id }, { partnershipId: null }),
      Job.updateMany({ partnershipId: partnership._id, status: 'open' }, { status: 'closed' }),
    ]);

    res.json({ message: 'Partnership deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getPartnerships, createPartnership, updatePartnership, deletePartnership };
