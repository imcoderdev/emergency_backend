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

    // Validate type - expanded to include all categories
    const validTypes = ['Fire', 'Accident', 'Medical', 'Crime', 'Infrastructure', 'Natural', 'Other'];
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

    // Analyze with AI (include image if uploaded)
    const imagePath = req.file ? `uploads/${req.file.filename}` : null;
    const aiAnalysis = await analyzeIncident(description, type, imagePath);

    // Log image analysis results if available
    if (aiAnalysis.imageAnalysis) {
      console.log('Image Analysis Result:', {
        isEmergency: aiAnalysis.imageAnalysis.isEmergency,
        confidence: aiAnalysis.imageAnalysis.confidence,
        detectedContent: aiAnalysis.imageAnalysis.detectedContent
      });
    }

    // Calculate priority score based on AI analysis and image
    let priorityScore = 50; // Base score
    console.log('Priority Calculation - Starting with base:', priorityScore);
    console.log('Priority Calculation - AI Severity:', aiAnalysis.severity);
    
    // Severity contribution (up to 40 points)
    const severityScores = { Critical: 40, High: 30, Medium: 20, Low: 10 };
    const severityBonus = severityScores[aiAnalysis.severity] || 20;
    priorityScore += severityBonus;
    console.log('Priority Calculation - Severity bonus:', severityBonus, '-> Total:', priorityScore);
    
    // Image analysis contribution
    if (aiAnalysis.imageAnalysis) {
      console.log('Priority Calculation - Image analysis found:', aiAnalysis.imageAnalysis);
      if (aiAnalysis.imageAnalysis.isEmergency) {
        // Real emergency image - boost score based on confidence
        const imageBonus = Math.round(aiAnalysis.imageAnalysis.confidence * 0.2);
        priorityScore += imageBonus;
        console.log('Priority Calculation - Emergency image bonus:', imageBonus, '-> Total:', priorityScore);
      } else {
        // Not a real emergency image - reduce score significantly
        priorityScore -= 30;
        console.log('Priority Calculation - Non-emergency image penalty: -30 -> Total:', priorityScore);
        // Also downgrade severity if image doesn't show emergency
        if (aiAnalysis.severity === 'Critical') {
          aiAnalysis.severity = 'Medium';
        } else if (aiAnalysis.severity === 'High') {
          aiAnalysis.severity = 'Medium';
        }
      }
    } else {
      console.log('Priority Calculation - No image analysis present');
    }
    
    // Clamp score between 10-100
    priorityScore = Math.max(10, Math.min(100, priorityScore));
    console.log('Priority Calculation - FINAL SCORE:', priorityScore);
    
    // Add priority score to AI analysis
    aiAnalysis.priorityScore = priorityScore;
    console.log('Priority Calculation - Added to ai_analysis:', JSON.stringify(aiAnalysis, null, 2));

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
 * GET /check-duplicates - Check for potential duplicate incidents
 * Query params: type, lat, lng, timestamp (optional), description (optional)
 */
router.get('/check-duplicates', async (req, res) => {
  try {
    const { type, lat, lng, description = '' } = req.query;

    // Validate required params
    if (!type || !lat || !lng) {
      return res.status(400).json({
        error: 'Missing required query parameters: type, lat, lng'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    // Get incidents from last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    // Find nearby incidents using MongoDB geospatial query
    const nearbyIncidents = await Incident.find({
      timestamp: { $gte: twoHoursAgo },
      status: { $nin: ['Resolved', 'Closed'] },
      'location.coordinates': {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: 500 // 500 meters
        }
      }
    }).lean();

    if (nearbyIncidents.length === 0) {
      return res.status(200).json({
        duplicates: [],
        message: 'No nearby incidents found'
      });
    }

    // Calculate similarity scores for each nearby incident
    const duplicates = nearbyIncidents.map(incident => {
      // Distance calculation
      const distance = calculateDistance(latitude, longitude, incident.location.lat, incident.location.lng);
      
      // Distance score: 100 at 0m, 50 at 500m
      const distanceScore = Math.max(0, 100 - (distance / 5));
      
      // Time score: 100 at 0min, 50 at 2hrs
      const timeDiff = Date.now() - new Date(incident.timestamp).getTime();
      const timeScore = Math.max(0, 100 - (timeDiff / (2 * 60 * 60 * 10)));
      
      // Type match bonus
      const typeBonus = incident.type === type ? 20 : 0;
      
      // Calculate confidence
      const confidence = Math.round((distanceScore + timeScore + typeBonus) / 2.2);

      return {
        _id: incident._id,
        type: incident.type,
        description: incident.description,
        location: incident.location,
        timestamp: incident.timestamp,
        severity: incident.severity,
        status: incident.status,
        upvotes: incident.upvotes,
        verified: incident.verified,
        confidence: Math.min(100, confidence),
        distance: Math.round(distance)
      };
    }).filter(d => d.confidence > 40) // Only return if confidence > 40%
      .sort((a, b) => b.confidence - a.confidence);

    // Use AI for description comparison if provided
    if (description && duplicates.length > 0) {
      const aiDuplicates = await detectDuplicates(
        { type, description, location: { lat: latitude, lng: longitude } },
        nearbyIncidents
      );

      // Merge AI confidence with distance-based confidence
      duplicates.forEach(dup => {
        const aiMatch = aiDuplicates.find(ai => ai.incidentId?.toString() === dup._id.toString());
        if (aiMatch) {
          dup.confidence = Math.round((dup.confidence + aiMatch.confidence) / 2);
          dup.aiReason = aiMatch.reason;
        }
      });

      duplicates.sort((a, b) => b.confidence - a.confidence);
    }

    return res.status(200).json({
      duplicates,
      count: duplicates.length,
      message: duplicates.length > 0 
        ? `Found ${duplicates.length} potential duplicate(s)` 
        : 'No duplicates found'
    });

  } catch (error) {
    console.error('Error checking duplicates:', error);
    return res.status(500).json({
      error: 'Failed to check duplicates',
      message: error.message
    });
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
 * POST /:id/analyze - Re-analyze incident with AI
 * Returns fresh AI analysis for the incident
 */
router.post('/:id/analyze', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Run AI analysis
    const aiAnalysis = await analyzeIncident(incident.description, incident.type);
    
    // Update incident with new AI analysis
    incident.ai_analysis = aiAnalysis;
    incident.severity = aiAnalysis.severity;
    await incident.save();

    // Calculate priority
    const priority = calculatePriority(incident.toObject());
    const priorityLevel = getPriorityLevel(priority);

    return res.status(200).json({
      success: true,
      incident: incident,
      aiAnalysis: aiAnalysis,
      priority: priority,
      priorityLevel: priorityLevel
    });

  } catch (error) {
    console.error('Error analyzing incident:', error);
    return res.status(500).json({ 
      error: 'Failed to analyze incident',
      message: error.message 
    });
  }
});

/**
 * POST /analyze-text - Analyze text without creating incident
 * Useful for pre-submission analysis
 */
router.post('/analyze-text', async (req, res) => {
  try {
    const { description, type } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    // Run AI analysis
    const aiAnalysis = await analyzeIncident(description, type || 'General');

    return res.status(200).json({
      success: true,
      analysis: aiAnalysis
    });

  } catch (error) {
    console.error('Error analyzing text:', error);
    return res.status(500).json({ 
      error: 'Failed to analyze text',
      message: error.message 
    });
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
