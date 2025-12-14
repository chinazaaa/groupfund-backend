const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
// CORS configuration - allow multiple origins for development and production
const allowedOrigins = [
  'https://groupfund.app',
  'https://www.groupfund.app',
  'http://localhost:5173',
  'http://localhost:19006',
  'http://localhost:3000',
];

// Add FRONTEND_URL from environment if it exists and isn't already in the list
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // In production, check against allowed origins
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'GroupFund API is running' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/members', require('./routes/members'));
app.use('/api/birthdays', require('./routes/birthdays'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/migrations', require('./routes/migrations'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
