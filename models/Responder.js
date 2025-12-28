const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const responderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'responder'],
    default: 'responder'
  },
  assignedIncidents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Incident'
  }],
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },
  status: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'available'
  },
  department: {
    type: String,
    enum: ['Police', 'Fire', 'Medical', 'Traffic', 'General'],
    default: 'General'
  },
  phone: {
    type: String
  }
}, {
  timestamps: true
});

// Hash password before saving
responderSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
responderSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Create 2dsphere index for geospatial queries
responderSchema.index({ location: '2dsphere' });

const Responder = mongoose.model('Responder', responderSchema);

module.exports = Responder;
