import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    user_email: { type: String, required: true },
    plan: { type: String, enum: ['Individual', 'Student', 'Duo'], default: 'Individual' },
    status: { type: String, enum: ['active', 'expired'], default: 'active' },
    end_date: { type: Date },
    amount: { type: Number, default: 219 },
  },
  { timestamps: true }
);

export default mongoose.model('Subscription', subscriptionSchema);