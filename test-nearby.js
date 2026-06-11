const mongoose = require("mongoose");
const Service = require("./models/Service");

async function testNearby() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/gshop");
    console.log("Connected to MongoDB\n");
    
    // Simulate Gqeberha coordinates (user location)
    const lat = -33.96;
    const lng = 25.60;
    const radiusNum = 50;
    
    console.log("User location: lat=" + lat + ", lng=" + lng);
    console.log("Radius: " + radiusNum + "km\n");
    
    // Same query as /nearby endpoint
    const services = await Service.find({ available: true });
    console.log("Found " + services.length + " available services\n");
    
    // Same calculation as /nearby endpoint
    const nearbyServices = services.map(service => {
      const serviceLat = service.location?.lat;
      const serviceLng = service.location?.lng;
      
      console.log("Service: " + service.title?.substring(0, 30));
      console.log("  Raw location:", JSON.stringify(service.location));
      console.log("  serviceLat:", serviceLat, "(type:", typeof serviceLat + ")");
      console.log("  serviceLng:", serviceLng, "(type:", typeof serviceLng + ")");
      
      if (!serviceLat || !serviceLng) {
        console.log("  SKIPPED - missing lat/lng\n");
        return null;
      }

      // Haversine formula
      const R = 6371;
      const dLat = (serviceLat - lat) * Math.PI / 180;
      const dLng = (serviceLng - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat * Math.PI / 180) * Math.cos(serviceLat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;
      
      console.log("  Distance: " + distance.toFixed(2) + "km\n");

      return { ...service.toObject(), distance };
    }).filter(s => s && s.distance <= radiusNum);
    
    console.log("\n=== RESULTS ===");
    console.log("Services within " + radiusNum + "km: " + nearbyServices.length);
    nearbyServices.forEach(s => {
      console.log("  - " + s.title?.substring(0, 30) + " (" + s.distance.toFixed(2) + "km)");
    });
    
    await mongoose.disconnect();
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

testNearby();
