const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
mongoose.connect('mongodb://gshop-mongodb:27017/gshop', { tls: false })
  .then(() => mongoose.connection.db.collection('users').updateOne(
    { email: 'alexa@admin.com' },
    { $set: { password: bcrypt.hashSync('830908', 10) } }
  ))
  .then(r => { console.log('Password reset:', r.modifiedCount, 'docs updated'); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
