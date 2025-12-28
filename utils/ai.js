const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Google Generative AI with API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Analyze an incident description using Google's Gemini AI
 * @param {string} description - The incident description to analyze
 * @param {string} type - The incident type
 * @returns {Object} - Analysis result with severity, tags, summary, and more
 */
async function analyzeIncident(description, type = '') {
  try {
    // Get the generative model (updated to gemini-1.5-flash for v1beta)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Create the prompt
    const prompt = `Analyze this emergency incident and return ONLY a JSON object with:
- severity (Critical/High/Medium/Low)
- suggestedCategory (if the type "${type}" seems wrong, suggest correct one from: Fire, Accident, Medical, Crime, Infrastructure)
- estimatedResponseTime (in minutes, number)
- keyDetails (array of important points extracted from description)
- tags (array of relevant keywords)
- summary (short 1-2 sentence summary)

Incident Type: ${type}
Description: "${description}"

Return ONLY valid JSON, no markdown or extra text.`;

    // Generate content
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Try to parse JSON from the response
    // Remove markdown code blocks if present
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      
      // Validate severity
      const validSeverities = ['Critical', 'High', 'Medium', 'Low'];
      if (!validSeverities.includes(analysis.severity)) {
        analysis.severity = 'Medium';
      }

      // Ensure tags is an array
      if (!Array.isArray(analysis.tags)) {
        analysis.tags = [];
      }

      // Ensure keyDetails is an array
      if (!Array.isArray(analysis.keyDetails)) {
        analysis.keyDetails = [];
      }

      // Ensure summary exists
      if (!analysis.summary) {
        analysis.summary = 'Emergency incident reported';
      }

      // Ensure estimatedResponseTime is a number
      if (typeof analysis.estimatedResponseTime !== 'number') {
        analysis.estimatedResponseTime = 15;
      }

      return analysis;
    } else {
      throw new Error('Unable to parse JSON from AI response');
    }

  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    
    // Return default values on error
    return {
      severity: 'Medium',
      suggestedCategory: null,
      estimatedResponseTime: 15,
      keyDetails: ['Emergency reported'],
      tags: ['emergency', 'incident'],
      summary: 'Emergency incident reported - AI analysis unavailable'
    };
  }
}

/**
 * Detect potential duplicate incidents
 * @param {Object} newIncident - The new incident to check
 * @param {Array} existingIncidents - Array of existing incidents to compare against
 * @returns {Array} - Array of potential duplicates with confidence scores
 */
async function detectDuplicates(newIncident, existingIncidents) {
  try {
    // Filter incidents within 500m radius and last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const nearbyIncidents = existingIncidents.filter(incident => {
      // Check time
      if (new Date(incident.timestamp) < twoHoursAgo) return false;
      
      // Check distance (500m)
      const distance = calculateDistance(
        newIncident.location.lat,
        newIncident.location.lng,
        incident.location.lat,
        incident.location.lng
      );
      
      return distance <= 500;
    });

    if (nearbyIncidents.length === 0) {
      return [];
    }

    // Use AI to compare descriptions
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const incidentSummaries = nearbyIncidents.map((inc, i) => 
      `${i + 1}. Type: ${inc.type}, Description: "${inc.description}"`
    ).join('\n');

    const prompt = `Compare this new incident report with existing nearby incidents and identify potential duplicates.

NEW INCIDENT:
Type: ${newIncident.type}
Description: "${newIncident.description}"

EXISTING NEARBY INCIDENTS:
${incidentSummaries}

Return ONLY a JSON array of objects with:
- index (1-based number of the matching incident)
- confidence (0-100, how likely they are duplicates)
- reason (brief explanation)

Only include incidents with confidence > 50. Return empty array [] if no duplicates found.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Parse JSON array
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      const duplicates = JSON.parse(jsonMatch[0]);
      
      // Map back to incident IDs
      return duplicates.map(dup => ({
        incidentId: nearbyIncidents[dup.index - 1]?._id,
        incident: nearbyIncidents[dup.index - 1],
        confidence: dup.confidence,
        reason: dup.reason
      })).filter(d => d.incidentId);
    }

    return [];

  } catch (error) {
    console.error('Duplicate Detection Error:', error.message);
    return [];
  }
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

module.exports = { analyzeIncident, detectDuplicates };
