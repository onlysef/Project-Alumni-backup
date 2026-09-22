const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected successfully.');
  } catch (err) {
    // Don't kill the process here: on Vercel, every cold start calls this
    // once, and exiting turns one transient Atlas hiccup into a hard 500 for
    // every route on that instance. The driver keeps monitoring the topology
    // in the background and mongoose buffers queries until it reconnects, so
    // logging and returning lets in-flight cold starts recover on their own.
    console.error('MongoDB connection failed:', err.message);
  }
};

module.exports = connectDB;
