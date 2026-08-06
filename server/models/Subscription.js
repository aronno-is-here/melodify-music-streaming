import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    user_email: { type: String, required: true },
    status: { type: String, enum: ['active', 'expired'], default: 'active' },
    end_date: { type: Date },
    amount: { type: Number, default: 9.99 },
  },
  { timestamps: true }
);

export default mongoose.model('Subscription', subscriptionSchema);