import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    name: { type: String, required: true },
    dob: { type: Date, required: true },
    gender: { type: String, enum: ['man', 'woman', 'prefer_not_to_say'], default: 'prefer_not_to_say' },
    country: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);