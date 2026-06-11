const mongoose = require('mongoose');
const User = require('./models/User');
const Job = require('./models/Job');
const Service = require('./models/Service');

async function testStats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gshop');
    
    const userCount = await User.countDocuments();
    const jobCount = await Job.countDocuments();
    const serviceCount = await Service.countDocuments();
    
    console.log('Stats:');
    console.log('  Users:', userCount);
    console.log('  Jobs:', jobCount);
    console.log('  Services:', serviceCount);
    
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

testStats();
