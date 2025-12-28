# 🚨 EmergencyHub Backend

Backend API for real-time emergency incident reporting platform powered by Google Gemini AI.

## Features

- **Express 5.x** REST API
- **MongoDB Atlas** with geospatial indexing
- **Socket.IO** for real-time updates
- **Google Gemini AI** for incident analysis & duplicate detection
- **Priority Scoring Algorithm** for responder queue
- **Multer** file upload support
- **Bcrypt** password hashing for responders

## Tech Stack

- Node.js 18+
- Express 5.x
- MongoDB (Mongoose 8.x)
- Socket.IO 4.8
- Google Generative AI (Gemini 2.5 Flash)
- Multer for media uploads

## Project Structure

```
backend/
├── server.js              # Main server with Socket.IO
├── models/
│   ├── Incident.js        # Incident schema with geospatial index
│   └── Responder.js       # Responder/admin schema
├── routes/
│   └── incidents.js       # All incident API endpoints
├── utils/
│   ├── ai.js              # Gemini AI integration
│   └── priorityScorer.js  # Priority calculation algorithm
└── uploads/               # Media file storage
```

## Environment Variables

Create `.env` file:

```env
PORT=5000
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/emergencyhub
GEMINI_API_KEY=your_gemini_api_key_here
```

## Installation

```bash
npm install
```

## Running

```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

## API Endpoints

### Incidents

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/incidents/report` | Create incident (multipart/form-data) |
| GET | `/api/incidents` | List incidents with filters |
| GET | `/api/incidents/stats` | Dashboard statistics |
| GET | `/api/incidents/priority-queue` | Priority-sorted queue |
| GET | `/api/incidents/:id` | Get single incident |
| PATCH | `/api/incidents/:id/upvote` | Increment upvotes |
| PATCH | `/api/incidents/:id/verify` | Mark as verified (admin) |
| PATCH | `/api/incidents/:id/status` | Update status (admin) |
| DELETE | `/api/incidents/:id` | Delete incident (admin) |

### Query Parameters (GET /api/incidents)

- `type` - Filter by incident type (Fire, Accident, Medical, Crime, Infrastructure)
- `status` - Filter by status (Reported, Verified, In Progress, Resolved)
- `severity` - Filter by severity (Critical, High, Medium, Low)
- `lat` & `lng` - Center point for geospatial search
- `radius` - Search radius in km (default: 50)
- `startDate` & `endDate` - Date range filter
- `limit` - Results per page (default: 50)
- `page` - Page number (default: 1)
- `sortByPriority` - Sort by priority score (true/false)

## Socket.IO Events

### Client → Server
- `join-responders` - Join responder room for priority alerts

### Server → Client
- `new-incident` - New incident created
- `incident-updated` - Incident status/details updated
- `incident-deleted` - Incident removed
- `upvote_update` - Upvote count changed
- `incident_verified` - Incident marked as verified
- `new_incident_alert` (responders room) - High-priority alert

## AI Features

### Incident Analysis
Gemini AI automatically analyzes each report and provides:
- **Severity** classification (Critical/High/Medium/Low)
- **Suggested Category** if type is misclassified
- **Estimated Response Time** in minutes
- **Key Details** extracted from description
- **Tags** for categorization
- **Summary** for quick overview

### Duplicate Detection
AI compares new incidents with nearby reports (500m radius, 2 hours) to:
- Identify potential duplicates with confidence scores
- Auto-merge exact matches (100m, 30 min) by incrementing upvotes
- Return duplicate warnings to client

## Priority Scoring Algorithm

Incidents ranked by score (0-200):

- **Severity Weight** (0-100 points)
  - Critical: 100
  - High: 70
  - Medium: 40
  - Low: 20

- **Time Decay** (0-30 points)
  - Fresh reports score higher
  - Exponential decay over 24 hours

- **Upvotes** (0-20 points)
  - +2 points per upvote (capped at 20)

- **Verification Bonus** (+15 points)
  - Admin-verified incidents prioritized

- **Distance Penalty**
  - -1 point per kilometer from responder
  - Only applied if responder location provided

## Models

### Incident Schema
- `type`: Fire, Accident, Medical, Crime, Infrastructure
- `description`: Text description
- `location`: GeoJSON Point with 2dsphere index
- `severity`: Critical, High, Medium, Low
- `status`: Reported, Verified, In Progress, Dispatched, Resolved, Closed
- `ai_analysis`: Object with AI-generated insights
- `mediaUrl`: Path to uploaded media file
- `upvotes`: Community confirmation count
- `verified`: Boolean (admin-verified)
- `reportedBy`: Reporter name/ID
- `assignedTo`: Responder ID
- `responderNotes`: Admin notes
- `timestamp`: Report time

### Responder Schema
- `name`, `email`, `password` (hashed)
- `role`: responder, admin, dispatcher
- `assignedIncidents`: Array of incident IDs
- `location`: Current coordinates
- `status`: active, off-duty
- `department`: fire, police, medical, etc.

## Dependencies

```json
{
  "@google/generative-ai": "^0.21.0",
  "bcryptjs": "^2.4.3",
  "cors": "^2.8.5",
  "dotenv": "^16.4.5",
  "express": "^5.0.0",
  "mongoose": "^8.8.3",
  "multer": "^1.4.5-lts.1",
  "socket.io": "^4.8.1"
}
```

## License

ISC
