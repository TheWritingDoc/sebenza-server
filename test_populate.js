const mongoose = require(\"mongoose\");
const jwt = require(\"jsonwebtoken\");
const Service = require(\"./models/Service\");

mongoose.connect(process.env.MONGODB_URI || \"mongodb://localhost:27017/gshop\", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log(\"Connected\");
    try {
      const services = await Service.find({ available: true }).populate(\"providerId\", \"name rating verified\");
      console.log(\"Services fetched:\", services.length);
      console.log(JSON.stringify(services[0], null, 2));
    } catch (e) {
      console.error(\"Error:\", e.message);
    }
    process.exit(0);
  })
  .catch(e => { console.error(\"DB Error:\", e.message); process.exit(1); });
