/**
 * Priority Scoring Algorithm for Emergency Incidents
 * Used to rank incidents for responder attention
 */

/**
 * Calculate priority score for an incident
 * @param {Object} incident - The incident object
 * @param {Object} responderLocation - Optional { lat, lng } of responder
 * @returns {number} - Priority score (0-200 range)
 */
function calculatePriority(incident, responderLocation = null) {
  let score = 0;

  // 1. Severity Score (max 100 points)
  const severityScores = {
    'Critical': 100,
    'High': 70,
    'Medium': 40,
    'Low': 10
  };
  score += severityScores[incident.severity] || 40;

  // 2. Time Decay (max 30 points)
  // Newer incidents get higher scores, decreases by 5 points every 10 minutes
  const ageInMinutes = (Date.now() - new Date(incident.timestamp).getTime()) / (1000 * 60);
  const timeScore = Math.max(0, 30 - Math.floor(ageInMinutes / 10) * 5);
  score += timeScore;

  // 3. Upvote Boost (max 20 points)
  // More upvotes = higher priority (community validation)
  const upvoteScore = Math.min(incident.upvotes * 2, 20);
  score += upvoteScore;

  // 4. Distance Penalty (if responder location provided)
  if (responderLocation && incident.location) {
    const distance = calculateDistance(
      responderLocation.lat,
      responderLocation.lng,
      incident.location.lat,
      incident.location.lng
    );
    const distanceInKm = distance / 1000;
    // Subtract 2 points per km, max 30 point penalty
    const distancePenalty = Math.min(distanceInKm * 2, 30);
    score -= distancePenalty;
  }

  // 5. Verification Bonus (+15 points if verified)
  if (incident.verified) {
    score += 15;
  }

  // 6. Status Adjustment
  // Lower priority for already in-progress incidents
  if (incident.status === 'In Progress') {
    score -= 20;
  } else if (incident.status === 'Resolved') {
    score -= 50;
  }

  // 7. Type-based urgency bonus
  const typeBonus = {
    'Medical': 10,
    'Fire': 10,
    'Crime': 5,
    'Accident': 5,
    'Infrastructure': 0
  };
  score += typeBonus[incident.type] || 0;

  // Ensure score is within 0-200 range
  return Math.max(0, Math.min(200, Math.round(score)));
}

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Sort incidents by priority score
 * @param {Array} incidents - Array of incident objects
 * @param {Object} responderLocation - Optional { lat, lng } of responder
 * @returns {Array} - Sorted incidents with priority field added
 */
function sortIncidentsByPriority(incidents, responderLocation = null) {
  return incidents
    .map(incident => ({
      ...incident,
      priority: calculatePriority(incident, responderLocation)
    }))
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Get priority level label based on score
 * @param {number} score - Priority score
 * @returns {string} - Priority level label
 */
function getPriorityLevel(score) {
  if (score >= 120) return 'CRITICAL';
  if (score >= 90) return 'HIGH';
  if (score >= 60) return 'MEDIUM';
  return 'LOW';
}

module.exports = {
  calculatePriority,
  sortIncidentsByPriority,
  getPriorityLevel,
  calculateDistance
};
