const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://gshop-admin:Rhino1234@gshop-cluster.gmhlj.mongodb.net/gshop-dev?retryWrites=true&w=majority';

async function check() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');
  
  // Find the most recently created user
  const User = require('./models/User');
  const user = await User.findOne().sort({ createdAt: -1 });
  
  if (user) {
    console.log('\nUser:', user.email);
    console.log('Location in DB:', JSON.stringify(user.location, null, 2));
  }
  
  await mongoose.disconnect();
}

check().catch(console.error);
