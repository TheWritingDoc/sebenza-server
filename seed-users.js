const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run seed script in production');
  process.exit(1);
}

const rawUsers = [
  { name: 'Calvin', email: 'calvin@sebenza.app', role: 'client', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Brandon', email: 'brandon@sebenza.app', role: 'provider', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Adrian', email: 'adrian@sebenza.app', role: 'admin', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 1000 },
  { name: 'Leonard', email: 'leonard@sebenza.app', role: 'provider', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Morne', email: 'morne@sebenza.app', role: 'client', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Glen', email: 'glen@sebenza.app', role: 'provider', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 },
  { name: 'Jesus Forever', email: 'jesusforever@sebenza.app', role: 'client', location: { coordinates: [28.0473, -26.2041], lat: -26.2041, lng: 28.0473 }, credits: 500 }
];

async function seedUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sebenza');
    console.log('Connected to MongoDB');

    // Clear existing users
    await User.deleteMany({});
    console.log('Cleared existing users');

    // Hash passwords and build user records
    const plainPassword = process.env.SEED_PASSWORD || 'ChangeMe123!';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const users = rawUsers.map(u => ({ ...u, password: hashedPassword }));

    // Insert new users
    const result = await User.insertMany(users);
    console.log(`Created ${result.length} users:`);
    result.forEach(u => console.log(`  - ${u.name} (${u.email})`));
    console.log(`All users have the password from SEED_PASSWORD env (default: ChangeMe123!)`);

    await mongoose.disconnect();
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

seedUsers();
