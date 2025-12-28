const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Initialize Google Generative AI with API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Convert image file to base64 for Gemini
 * @param {string} imagePath - Path to the image file
 * @returns {Object} - Object with mimeType and base64 data
 */
function imageToBase64(imagePath) {
  try {
    const absolutePath = path.resolve(imagePath);
    if (!fs.existsSync(absolutePath)) {
      console.log('Image file not found:', absolutePath);
      return null;
    }
    
    const imageBuffer = fs.readFileSync(absolutePath);
    const base64Data = imageBuffer.toString('base64');
    
    // Determine MIME type from extension
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    
    return {
      inlineData: {
        mimeType: mimeTypes[ext] || 'image/jpeg',
        data: base64Data
      }
    };
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return null;
  }
}

/**
 * Analyze an incident description and optional image using Google's Gemini AI
 * @param {string} description - The incident description to analyze
 * @param {string} type - The incident type
 * @param {string} imagePath - Optional path to image file
 * @returns {Object} - Analysis result with severity, tags, summary, and more
 */
async function analyzeIncident(description, type = '', imagePath = null) {
  try {
    // Get the generative model (gemini-2.5-flash supports vision)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Build the prompt parts
    const parts = [];
    
    // Check if we have an image to analyze
    const hasImage = imagePath && fs.existsSync(path.resolve(imagePath));
    
    if (hasImage) {
      const imageData = imageToBase64(imagePath);
      if (imageData) {
        parts.push(imageData);
        console.log('Image included in AI analysis:', imagePath);
      }
    }

    // Create the text prompt - different based on whether image is included
    let prompt;
    if (hasImage) {
      prompt = `Analyze this emergency incident report WITH the attached image.

IMPORTANT: Carefully analyze the IMAGE to determine:
1. Does the image actually show an emergency (fire, accident, medical emergency, crime, etc.)?
2. Does the image match the reported incident type "${type}"?
3. Is this a real emergency photo or a random/fake image?

Return ONLY a JSON object with:
- severity (Critical/High/Medium/Low) - based on what you SEE in the image AND description
- imageAnalysis: {
    isEmergency: (true/false - does image show an actual emergency?),
    matchesDescription: (true/false - does image match the description?),
    confidence: (0-100 - how confident are you this is a real emergency photo?),
    detectedContent: (what do you actually see in the image?)
  }
- suggestedCategory (if the type "${type}" seems wrong based on image, suggest correct one from: Fire, Accident, Medical, Crime, Natural, Other)
- estimatedResponseTime (in minutes, number)
- keyDetails (array of important points from BOTH description AND image)
- tags (array of relevant keywords)
- summary (short 1-2 sentence summary including what's visible in image)

If the image does NOT show a real emergency or looks fake/random:
- Set severity to "Low"
- Set imageAnalysis.isEmergency to false
- Set imageAnalysis.confidence to a low number

Incident Type: ${type}
Description: "${description}"

Return ONLY valid JSON, no markdown or extra text.`;
    } else {
      prompt = `Analyze this emergency incident and return ONLY a JSON object with:
- severity (Critical/High/Medium/Low)
- suggestedCategory (if the type "${type}" seems wrong, suggest correct one from: Fire, Accident, Medical, Crime, Natural, Other)
- estimatedResponseTime (in minutes, number)
- keyDetails (array of important points extracted from description)
- tags (array of relevant keywords)
- summary (short 1-2 sentence summary)

Incident Type: ${type}
Description: "${description}"

Return ONLY valid JSON, no markdown or extra text.`;
    }
    
    parts.push({ text: prompt });

    // Generate content with image if available
    const result = await model.generateContent(parts);
    const response = await result.response;
    const text = response.text();

    console.log('Gemini AI Response:', text.substring(0, 500));

    // Try to parse JSON from the response
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

      // If image was analyzed but doesn't match, adjust severity
      if (analysis.imageAnalysis) {
        if (!analysis.imageAnalysis.isEmergency || analysis.imageAnalysis.confidence < 30) {
          console.log('Image analysis indicates non-emergency or low confidence');
          // Don't override to Critical/High if image doesn't support it
          if (analysis.severity === 'Critical') {
            analysis.severity = 'Medium';
          }
        }
      }

      return analysis;
    } else {
      throw new Error('Unable to parse JSON from AI response');
    }

  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    
    // Determine severity based on incident type when AI fails
    const typeSeverityMap = {
      'Fire': 'High',
      'Medical': 'High', 
      'Accident': 'High',
      'Crime': 'Medium',
      'Natural': 'High',
      'Other': 'Medium',
      'Infrastructure': 'Low'
    };
    
    const fallbackSeverity = typeSeverityMap[type] || 'Medium';
    
    // Return default values on error with type-based severity
    return {
      severity: fallbackSeverity,
      suggestedCategory: null,
      estimatedResponseTime: type === 'Fire' ? 8 : type === 'Medical' ? 5 : 12,
      keyDetails: [`${type} emergency reported`, 'Location captured', 'Awaiting responder dispatch'],
      tags: ['emergency', type.toLowerCase()],
      summary: `${type} emergency incident reported. AI analysis temporarily unavailable.`,
      aiStatus: 'fallback' // Flag to indicate AI was unavailable
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
