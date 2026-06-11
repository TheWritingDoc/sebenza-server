const mongoose = require("mongoose");
const Service = require("./models/Service");

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/gshop");
    console.log("Connected to MongoDB");
    
    const totalServices = await Service.countDocuments();
    const availableServices = await Service.countDocuments({ available: true });
    const withLocation = await Service.countDocuments({ available: true, "location.lat": { $exists: true }, "location.lng": { $exists: true } });
    const withValidLocation = await Service.countDocuments({ available: true, "location.lat": { $ne: null }, "location.lng": { $ne: null } });
    const withNonZeroLocation = await Service.countDocuments({ available: true, "location.lat": { $ne: 0 }, "location.lng": { $ne: 0 } });
    
    console.log("Total services:", totalServices);
    console.log("Available services:", availableServices);
    console.log("With location.lat/lng exists:", withLocation);
    console.log("With valid (non-null) location:", withValidLocation);
    console.log("With non-zero location:", withNonZeroLocation);
    
    const samples = await Service.find({ available: true }).limit(5).lean();
    console.log("\nSample services location data:");
    samples.forEach((s, i) => {
      console.log("Service " + (i+1) + ": id=" + s._id + ", lat=" + (s.location?.lat || "null") + ", lng=" + (s.location?.lng || "null"));
    });
    
    await mongoose.disconnect();
    console.log("\nDisconnected");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

check();
