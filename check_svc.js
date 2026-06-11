const mongoose = require("mongoose");
const Service = require("./models/Service");
mongoose.connect("mongodb://localhost:27017/gshop").then(async () => {
  const count = await Service.countDocuments();
  console.log("Services count:", count);
  const svcs = await Service.find().limit(3).lean();
  svcs.forEach(s => console.log("- " + s.title + " loc:" + JSON.stringify(s.location)));
  process.exit(0);
});
