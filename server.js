const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === 'production';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ============================================
// PRODUCTION SECURITY MIDDLEWARE
// ============================================

// Security headers with Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false // Disable CSP for API
}));

// Compression for responses
app.use(compression());

// Rate limiting - General API limiter
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isProduction && req.ip === '::1' // Skip in dev for localhost
});

// Strict rate limiter for incident reporting (prevent spam)
const reportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 reports per 5 minutes
  message: { error: 'Too many incident reports. Please wait before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false
});

// AI analysis rate limiter (expensive operations)
const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 AI requests per minute
  message: { error: 'AI analysis rate limit exceeded. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply general limiter to all routes
app.use(generalLimiter);

// Socket.IO setup with CORS
const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'https://emergency-frontend-gx2k.vercel.app'
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://emergency-frontend-gx2k.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    // In development, allow all localhost origins
    if (process.env.NODE_ENV !== 'production' && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json()); // JSON parsing middleware
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Attach Socket.IO to requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => console.log('MongoDB Connected'))
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    console.log('Server will continue running without MongoDB connection');
  });

// Handle MongoDB connection errors after initial connection
mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err.message);
});

// Track connected clients
let connectedClients = 0;

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  connectedClients++;
  console.log(`User Connected. Total clients: ${connectedClients}`);

  // Join responder room
  socket.on('joinResponderRoom', () => {
    socket.join('responders');
    console.log('Responder joined responder room');
  });

  // Leave responder room
  socket.on('leaveResponderRoom', () => {
    socket.leave('responders');
    console.log('Responder left responder room');
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`User Disconnected. Total clients: ${connectedClients}`);
  });
});

// Helper functions for socket emissions
const emitToAll = (event, data) => {
  io.emit(event, data);
};

const emitToResponders = (event, data) => {
  io.to('responders').emit(event, data);
};

// Import Routes
const incidentsRouter = require('./routes/incidents');

// Routes
// Root Route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Emergency Incident Reporting Platform API',
    status: 'Running',
    version: '1.0.0',
    environment: isProduction ? 'production' : 'development',
    connectedClients,
    endpoints: {
      health: 'GET /api/health',
      incidents: 'GET /api/incidents',
      incidentStats: 'GET /api/incidents/stats',
      priorityQueue: 'GET /api/incidents/priority-queue',
      reportIncident: 'POST /api/incidents/report',
      upvoteIncident: 'PATCH /api/incidents/:id/upvote',
      verifyIncident: 'PATCH /api/incidents/:id/verify',
      updateStatus: 'PATCH /api/incidents/:id/status',
      deleteIncident: 'DELETE /api/incidents/:id'
    }
  });
});

// Health Check Route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development',
    connectedClients,
    mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Mount Incidents Routes with specific rate limiters
app.use('/api/incidents/report', reportLimiter); // Stricter limit for reporting
app.use('/api/incidents/analyze', aiLimiter); // AI analysis limit
app.use('/api/incidents/:id/analyze', aiLimiter); // AI analysis limit
app.use('/api/incidents', incidentsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Server Initialization
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, server, io, emitToAll, emitToResponders };
