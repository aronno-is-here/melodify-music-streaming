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
    bio: { type: String, default: '', maxlength: 500 },
    avatar: { type: String, default: '' },
    libraryVisibility: { type: String, enum: ['public', 'private'], default: 'private' },
  },
  { timestamps: true }
);

userSchema.index({ name: 'text', email: 'text' });

export default mongoose.model('User', userSchema);