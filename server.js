const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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
  'https://emergency-frontend-gx2k.vercel.app'
];

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
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
    connectedClients,
    mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Mount Incidents Routes
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
