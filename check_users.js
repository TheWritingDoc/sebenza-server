
const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/gshop')
  .then(async () => {
    const users = await mongoose.connection.collection('users').find({}, { 
      projection: { name: 1, email: 1, surname: 1, createdAt: 1 } 
    }).sort({ createdAt: -1 }).toArray();
    console.log(JSON.stringify(users, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
