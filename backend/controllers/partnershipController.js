const Partnership = require('../models/Partnership');
const Job         = require('../models/Job');

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
    const { name, type, contact, status, description } = req.body;
    if (!name || !type || !contact) {
      return res.status(400).json({ message: 'name, type, and contact are required.' });
    }
    const partnership = await Partnership.create({ name, type, contact, status, description });
    res.status(201).json({ partnership });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/partnerships/:id
const updatePartnership = async (req, res) => {
  try {
    const { name, type, contact, status, description } = req.body;
    const partnership = await Partnership.findByIdAndUpdate(
      req.params.id,
      { name, type, contact, status, description },
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
    res.json({ message: 'Partnership deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getPartnerships, createPartnership, updatePartnership, deletePartnership };
