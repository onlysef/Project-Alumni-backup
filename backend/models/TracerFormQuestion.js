const mongoose = require('mongoose');

const tracerFormQuestionSchema = new mongoose.Schema({
  question_text: { type: String, required: true, trim: true },
  field_type: {
    type:    String,
    enum:    ['text', 'textarea', 'select', 'radio', 'checkbox'],
    default: 'text',
  },
  options:      [{ type: String }],
  is_required:  { type: Boolean, default: false },
  is_active:    { type: Boolean, default: true },
  order_number: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('TracerFormQuestion', tracerFormQuestionSchema);
