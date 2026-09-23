const mongoose = require('mongoose');

const partnershipSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  // Not an enum — picking "Others" in the admin/self-registration UI lets
  // the submitter type a free-text industry name, which then becomes the
  // stored value directly (not the literal "Others").
  type:             { type: String, required: true, trim: true },
  // Set at self-registration (registerPartner); admin-created partnerships
  // via the Add/Edit Partnership form no longer collect this, so it can't
  // stay required or every admin-side create/update would fail validation.
  contact:          { type: String, default: '', trim: true },
  status:      { type: String, enum: ['Active', 'Pending', 'Archived'], default: 'Pending' },
  description: { type: String, default: '' },
}, { timestamps: true });

partnershipSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Partnership', partnershipSchema);
