const Job         = require('../models/Job');
const Partnership = require('../models/Partnership');

// POST /api/employer/jobs  — employer posts a job
const postJob = async (req, res) => {
  try {
    const { title, description, partnershipId, jobType, location } = req.body;
    if (!title || !partnershipId) {
      return res.status(400).json({ message: 'title and partnershipId are required.' });
    }
    const partnership = await Partnership.findById(partnershipId);
    if (!partnership) return res.status(404).json({ message: 'Partnership not found.' });

    const job = await Job.create({
      title, description, partnershipId, jobType, location,
      postedBy: req.user.id,
    });
    res.status(201).json({ job });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/employer/jobs  — employer sees own jobs
const getMyJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ postedBy: req.user.id })
      .populate('partnershipId', 'name')
      .sort({ createdAt: -1 });
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/employer/partnerships  — list active partnerships for the job post form dropdown
const getActivePartnerships = async (req, res) => {
  try {
    const partnerships = await Partnership.find({ status: { $ne: 'Archived' } }, 'name type').sort({ name: 1 });
    res.json({ partnerships });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/employer/jobs/:id/close  — employer closes a job
const closeJob = async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, postedBy: req.user.id });
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    job.status = 'closed';
    await job.save();
    res.json({ job });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/employer/jobs/:id  — employer deletes own job
const deleteJob = async (req, res) => {
  try {
    const job = await Job.findOneAndDelete({ _id: req.params.id, postedBy: req.user.id });
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    res.json({ message: 'Job deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/jobs  — admin sees all jobs
const getAllJobs = async (req, res) => {
  try {
    const jobs = await Job.find()
      .populate('partnershipId', 'name')
      .populate('postedBy', 'firstName lastName email')
      .sort({ createdAt: -1 });
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { postJob, getMyJobs, getActivePartnerships, closeJob, deleteJob, getAllJobs };
