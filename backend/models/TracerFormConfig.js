const mongoose = require('mongoose');

const tracerFormConfigSchema = new mongoose.Schema({
  college:   { type: String, default: '' },
  config:    { type: mongoose.Schema.Types.Mixed, required: true },
  version:   { type: Number, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

tracerFormConfigSchema.index({ college: 1 }, { unique: true });

module.exports = mongoose.model('TracerFormConfig', tracerFormConfigSchema);
