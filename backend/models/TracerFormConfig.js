const mongoose = require('mongoose');

const tracerFormConfigSchema = new mongoose.Schema({
  config:    { type: mongoose.Schema.Types.Mixed, required: true },
  version:   { type: Number, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('TracerFormConfig', tracerFormConfigSchema);
