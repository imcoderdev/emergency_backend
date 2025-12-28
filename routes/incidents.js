const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Incident = require('../models/Incident');
const { analyzeIncident, detectDuplicates } = require('../utils/ai');
const { sortIncidentsByPriority, calculatePriority, getPriorityLevel } = require('../utils/priorityScorer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image and video files are allowed'));
  }
});

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * POST /report - Create new incident (multipart form data)
 */
router.post('/report', upload.single('media'), async (req, res) => {
  try {
    const { type, description, reportedBy } = req.body;
    let location = req.body.location;

    // Parse location if it's a string
    if (typeof location === 'string') {
      location = JSON.parse(location);
    }

    // Validate required fields
    if (!type || !description || !location || !location.lat || !location.lng) {
      return res.status(400).json({
        error: 'Missing required fields: type, description, location (lat, lng)'
      });
    }

    // Validate type
    const validTypes = ['Fire', 'Accident', 'Medical', 'Crime', 'Infrastructure'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Get existing incidents for duplicate detection
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const existingIncidents = await Incident.find({
      timestamp: { $gte: twoHoursAgo }
    }).lean();

    // Check for duplicates using AI
    const duplicates = await detectDuplicates(
      { type, description, location },
      existingIncidents
    );

    // Check for nearby similar incidents (100m, 30min) for auto-merge
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentIncidents = await Incident.find({
      type: type,
      timestamp: { $gte: thirtyMinutesAgo }
    });

    let matchedIncident = null;
    for (const incident of recentIncidents) {
      const distance = calculateDistance(
        location.lat,
        location.lng,
        incident.location.lat,
        incident.location.lng
      );

      if (distance <= 100) {
        matchedIncident = incident;
        break;
      }
    }

    // If exact match found, increment upvotes
    if (matchedIncident) {
      matchedIncident.upvotes += 1;
      await matchedIncident.save();

      if (req.io) {
        req.io.emit('upvote_update', {
          incidentId: matchedIncident._id,
          upvotes: matchedIncident.upvotes,
          type: matchedIncident.type,
          location: matchedIncident.location
        });
      }

      return res.status(200).json({
        status: 'merged',
        incident: matchedIncident,
        message: 'Your report was merged with an existing incident nearby'
      });
    }

    // Analyze with AI
    const aiAnalysis = await analyzeIncident(description, type);

    // Create new incident
    const newIncident = new Incident({
      type,
      description,
      location: {
        type: 'Point',
        coordinates: [location.lng, location.lat],
        lat: location.lat,
        lng: location.lng,
        address: location.address || ''
      },
      severity: aiAnalysis.severity,
      ai_analysis: aiAnalysis,
      reportedBy: reportedBy || 'Anonymous',
      mediaUrl: req.file ? `/uploads/${req.file.filename}` : null,
      upvotes: 1,
      status: 'Reported',
      verified: false,
      timestamp: new Date()
    });

    await newIncident.save();

    // Emit socket event
    if (req.io) {
      req.io.emit('new_incident', {
        incident: newIncident,
        priority: calculatePriority(newIncident.toObject())
      });

      // Notify responders specifically
      req.io.to('responders').emit('new_incident_alert', {
        incident: newIncident,
        priority: calculatePriority(newIncident.toObject()),
        priorityLevel: getPriorityLevel(calculatePriority(newIncident.toObject()))
      });
    }

    return res.status(201).json({
      status: 'created',
      incident: newIncident,
      aiAnalysis: aiAnalysis,
      duplicates: duplicates.length > 0 ? duplicates : null
    });

  } catch (error) {
    console.error('Error reporting incident:', error);
    return res.status(500).json({
      error: 'Failed to report incident',
      message: error.message
    });
  }
});

/**
 * GET / - Get all incidents with filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      type,
      status,
      severity,
      lat,
      lng,
      radius = 50, // km
      startDate,
      endDate,
      limit = 50,
      page = 1,
      sortByPriority
    } = req.query;

    // Build query
    const query = {};

    if (type && type !== 'all') {
      query.type = type;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (severity && severity !== 'all') {
      query.severity = severity;
    }

    if (startDate) {
      query.timestamp = { ...query.timestamp, $gte: new Date(startDate) };
    }

    if (endDate) {
      query.timestamp = { ...query.timestamp, $lte: new Date(endDate) };
    }

    // Geospatial query if lat/lng provided
    if (lat && lng) {
      query['location'] = {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseFloat(radius) * 1000 // Convert km to meters
        }
      };
    }

    // Execute query
    let incidents = await Incident.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Sort by priority if requested
    if (sortByPriority === 'true') {
      const responderLocation = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null;
      incidents = sortIncidentsByPriority(incidents, responderLocation);
    }

    const total = await Incident.countDocuments(query);

    return res.status(200).json({
      count: incidents.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      incidents
    });

  } catch (error) {
    console.error('Error fetching incidents:', error);
    return res.status(500).json({
      error: 'Failed to fetch incidents',
      message: error.message
    });
  }
});

/**
 * GET /stats - Get incident statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const total = await Incident.countDocuments();
    const critical = await Incident.countDocuments({ severity: 'Critical' });
    const high = await Incident.countDocuments({ severity: 'High' });
    const inProgress = await Incident.countDocuments({ status: 'In Progress' });
    const resolved = await Incident.countDocuments({ status: 'Resolved' });
    const pending = await Incident.countDocuments({ status: { $in: ['Pending', 'Reported'] } });

    // Get counts by type
    const byType = await Incident.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    // Get recent 24h stats
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24h = await Incident.countDocuments({ timestamp: { $gte: dayAgo } });

    return res.status(200).json({
      total,
      critical,
      high,
      inProgress,
      resolved,
      pending,
      last24h,
      byType: byType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    return res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * GET /priority-queue - Get incidents sorted by priority
 */
router.get('/priority-queue', async (req, res) => {
  try {
    const { lat, lng, limit = 20 } = req.query;

    // Get active incidents only
    const incidents = await Incident.find({
      status: { $nin: ['Resolved', 'Closed'] }
    }).lean();

    const responderLocation = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null;
    const sortedIncidents = sortIncidentsByPriority(incidents, responderLocation)
      .slice(0, parseInt(limit))
      .map(inc => ({
        ...inc,
        priorityLevel: getPriorityLevel(inc.priority)
      }));

    return res.status(200).json({
      count: sortedIncidents.length,
      incidents: sortedIncidents
    });

  } catch (error) {
    console.error('Error fetching priority queue:', error);
    return res.status(500).json({ error: 'Failed to fetch priority queue' });
  }
});

/**
 * GET /:id - Get single incident
 */
router.get('/:id', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id).lean();
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Add priority score
    incident.priority = calculatePriority(incident);
    incident.priorityLevel = getPriorityLevel(incident.priority);

    return res.status(200).json({ incident });

  } catch (error) {
    console.error('Error fetching incident:', error);
    return res.status(500).json({ error: 'Failed to fetch incident' });
  }
});

/**
 * PATCH /:id/upvote - Increment upvotes
 */
router.patch('/:id/upvote', async (req, res) => {
  try {
    const incident = await Incident.findByIdAndUpdate(
      req.params.id,
      { $inc: { upvotes: 1 } },
      { new: true }
    );

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Emit socket event
    if (req.io) {
      req.io.emit('upvote_update', {
        incidentId: incident._id,
        upvotes: incident.upvotes,
        type: incident.type
      });
    }

    return res.status(200).json({
      success: true,
      upvotes: incident.upvotes
    });

  } catch (error) {
    console.error('Error upvoting incident:', error);
    return res.status(500).json({ error: 'Failed to upvote incident' });
  }
});

/**
 * PATCH /:id/verify - Mark as verified (admin only)
 */
router.patch('/:id/verify', async (req, res) => {
  try {
    const incident = await Incident.findByIdAndUpdate(
      req.params.id,
      { 
        verified: true, 
        status: 'Verified' 
      },
      { new: true }
    );

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Emit socket event
    if (req.io) {
      req.io.emit('incident_verified', {
        incidentId: incident._id,
        verified: true
      });
    }

    return res.status(200).json({
      success: true,
      incident
    });

  } catch (error) {
    console.error('Error verifying incident:', error);
    return res.status(500).json({ error: 'Failed to verify incident' });
  }
});

/**
 * PATCH /:id/status - Update status and add notes
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, responderNotes, assignedTo } = req.body;

    const validStatuses = ['Reported', 'Verified', 'In Progress', 'Dispatched', 'Resolved', 'Closed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (responderNotes) updateData.responderNotes = responderNotes;
    if (assignedTo) updateData.assignedTo = assignedTo;

    const incident = await Incident.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Emit socket event
    if (req.io) {
      req.io.emit('incident_updated', {
        incidentId: incident._id,
        status: incident.status,
        updatedAt: incident.updatedAt
      });
    }

    return res.status(200).json({
      success: true,
      incident
    });

  } catch (error) {
    console.error('Error updating incident status:', error);
    return res.status(500).json({ error: 'Failed to update incident status' });
  }
});

/**
 * DELETE /:id - Delete incident (admin only)
 */
router.delete('/:id', async (req, res) => {
  try {
    const incident = await Incident.findByIdAndDelete(req.params.id);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Emit socket event
    if (req.io) {
      req.io.emit('incident_deleted', {
        incidentId: req.params.id
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Incident deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting incident:', error);
    return res.status(500).json({ error: 'Failed to delete incident' });
  }
});

module.exports = router;
