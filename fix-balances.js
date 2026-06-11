const mongoose = require('mongoose');
async function fix() {
  await mongoose.connect('mongodb://localhost:27017/gshop');
  const User = require('./models/User');
  const result = await User.updateMany({ randBalance: { $lte: 0 } }, { $set: { randBalance: 1000 } });
  console.log('Updated', result.modifiedCount, 'users with 0 randBalance to 1000');
  await mongoose.disconnect();
}
fix().catch(e => { console.error(e); process.exit(1); });
