import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    type: { type: String, default: 'report' },
    user_email: { type: String, required: true },
    content_id: { type: String },
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending' },
    admin_notes: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Report', reportSchema);