const mongoose = require('mongoose');

const partnershipSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  type:             { type: String, enum: [
    'Information Technology & BPO',
    'Manufacturing',
    'Banking & Finance',
    'Healthcare',
    'Retail & Trade',
    'Education',
    'Government',
    'Construction & Engineering',
    'Hospitality & Tourism',
    'Agriculture',
    'Others',
  ], required: true },
  // Set at self-registration (registerPartner); admin-created partnerships
  // via the Add/Edit Partnership form no longer collect this, so it can't
  // stay required or every admin-side create/update would fail validation.
  contact:          { type: String, default: '', trim: true },
  status:      { type: String, enum: ['Active', 'Pending', 'Archived'], default: 'Pending' },
  description: { type: String, default: '' },
}, { timestamps: true });

partnershipSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Partnership', partnershipSchema);
