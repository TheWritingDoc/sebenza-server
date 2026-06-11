const mongoose = require('mongoose');
const User = require('./models/User');

const users = [
  { name: 'Calvin', email: 'calvin@gshop.app', password: 'password123', role: 'client', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Brandon', email: 'brandon@gshop.app', password: 'password123', role: 'provider', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Adrian', email: 'adrian@gshop.app', password: 'password123', role: 'admin', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 1000 },
  { name: 'Leonard', email: 'leonard@gshop.app', password: 'password123', role: 'provider', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Morne', email: 'morne@gshop.app', password: 'password123', role: 'client', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Glen', email: 'glen@gshop.app', password: 'password123', role: 'provider', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Jesus Forever', email: 'jesusforever@gshop.app', password: 'password123', role: 'client', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 }
];

async function seedUsers() {
  try {
    await mongoose.connect('mongodb://localhost:27017/gshop');
    console.log('Connected to MongoDB');
    
    // Clear existing users
    await User.deleteMany({});
    console.log('Cleared existing users');
    
    // Insert new users
    const result = await User.insertMany(users);
    console.log(`Created ${result.length} users:`);
    result.forEach(u => console.log(`  - ${u.name} (${u.email})`));
    
    await mongoose.disconnect();
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

seedUsers();
