const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['Fire', 'Accident', 'Medical', 'Crime', 'Infrastructure']
  },
  description: {
    type: String,
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true
    },
    lat: {
      type: Number,
      required: true
    },
    lng: {
      type: Number,
      required: true
    },
    address: {
      type: String,
      default: ''
    }
  },
  severity: {
    type: String,
    required: true,
    enum: ['Critical', 'High', 'Medium', 'Low']
  },
  status: {
    type: String,
    enum: ['Reported', 'Verified', 'In Progress', 'Dispatched', 'Resolved', 'Closed', 'Pending'],
    default: 'Reported'
  },
  ai_analysis: {
    type: Object,
    default: {}
  },
  reportedBy: {
    type: String,
    default: 'Anonymous'
  },
  mediaUrl: {
    type: String,
    default: null
  },
  upvotes: {
    type: Number,
    default: 1
  },
  verified: {
    type: Boolean,
    default: false
  },
  responderNotes: {
    type: String,
    default: ''
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Responder',
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Create 2dsphere index for geospatial queries
incidentSchema.index({ location: '2dsphere' });
incidentSchema.index({ timestamp: -1 });
incidentSchema.index({ type: 1, timestamp: -1 });
incidentSchema.index({ severity: 1, timestamp: -1 });

const Incident = mongoose.model('Incident', incidentSchema);

module.exports = Incident;

module.exports = Incident;
