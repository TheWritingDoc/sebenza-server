const fs = require('fs');
let c = fs.readFileSync('routes/services.js', 'utf8');
c = c.replace(
  /const { lat, lng, radius = 50 } = req.query;/,
  'const token = req.headers.authorization?.split(\x27 \x27)[1];\n    let isAuthenticated = false;\n    if (token) {\n      try {\n        jwt.verify(token, process.env.JWT_SECRET || \x27your-secret-key\x27);\n        isAuthenticated = true;\n      } catch (e) { /* invalid token */ }\n    }\n    \n    const { lat, lng, radius } = req.query;\n    // FREE users: 1km max, Authenticated: 50km max\n    const maxRadius = isAuthenticated ? 50 : 1;\n    const requestedRadius = parseFloat(radius) || maxRadius;\n    const radiusNum = Math.min(requestedRadius, maxRadius);'
);
fs.writeFileSync('routes/services.js', c);
console.log('Done');
