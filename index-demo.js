const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'gshop-demo-secret-key';

// ── In-memory storage ─────────────────────────────────────────────────────────
const users = [];
const services = [];
const transactions = [];
const notifications = [];
let userIdCounter = 1;
let serviceIdCounter = 1;
let transactionIdCounter = 1;
let notificationIdCounter = 1;

// ── Socket.IO: userId → socketId map ─────────────────────────────────────────
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('register', (userId) => {
    onlineUsers[String(userId)] = socket.id;
    console.log(`User ${userId} online (socket ${socket.id})`);
  });
  socket.on('disconnect', () => {
    for (const [uid, sid] of Object.entries(onlineUsers)) {
      if (sid === socket.id) { delete onlineUsers[uid]; break; }
    }
  });
});

function notifyUser(userId, type, message, data = {}) {
  const notif = {
    _id: String(notificationIdCounter++),
    userId: String(userId),
    type, message, data,
    read: false,
    createdAt: new Date().toISOString()
  };
  notifications.push(notif);
  const sid = onlineUsers[String(userId)];
  if (sid) {
    io.to(sid).emit('notification', notif);
    console.log(`[NOTIFY] Pushed to user ${userId} (socket ${sid})`);
  } else {
    console.log(`[NOTIFY] User ${userId} offline — queued`);
  }
  return notif;
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Auth middleware ───────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  let token = req.header('x-auth-token');
  if (!token && req.headers.authorization) {
    token = req.headers.authorization.replace('Bearer ', '').trim();
  }
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcDist(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function safeUser(u) { const { password, ...rest } = u; return rest; }

// ── Register (both paths) ─────────────────────────────────────────────────────
async function registerHandler(req, res) {
  const { name, email, phone, password, location, skills } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'User already exists' });

  const user = {
    _id: String(userIdCounter++),
    name, email,
    phone: phone || '',
    password: await bcrypt.hash(password, 10),
    location: location || null,
    skills: skills || [],
    credits: 100,
    escrowCredits: 0,
    rating: 5,
    verified: false,
    phoneVerified: false,
    status: 'online',  // online, offline, after_hours
    availableUntil: null  // ISO date for after_hours mode
  };
  users.push(user);
  console.log(`[REG] User ${user._id} "${user.name}" | total=${users.length}`);

  const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: safeUser(user) });
}

async function loginHandler(req, res) {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: safeUser(user) });
}

app.post('/api/auth/register', registerHandler);
app.post('/api/register',      registerHandler);
app.post('/api/auth/login',    loginHandler);
app.post('/api/login',         loginHandler);

app.get('/api/auth/me', auth, (req, res) => {
  const user = users.find(u => u._id === req.user.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(safeUser(user));
});

app.get('/api/profile', auth, (req, res) => {
  const user = users.find(u => u._id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
// Update user online/offline/after-hours status
app.put('/api/users/status', auth, (req, res) => {
  const user = users.find(u => u._id === req.user.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  
  const { status, availableUntil } = req.body;
  if (status) user.status = status;
  if (availableUntil) user.availableUntil = availableUntil;
  
  res.json({ status: user.status, availableUntil: user.availableUntil });
});

// Get user status
app.get('/api/users/status/:id', (req, res) => {
  const user = users.find(u => u._id === req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ 
    status: user.status || 'online', 
    availableUntil: user.availableUntil,
    isAvailable: user.status === 'online' || (user.status === 'after_hours' && user.availableUntil && new Date(user.availableUntil) > new Date())
  });
});
  res.json(safeUser(user));
});

// ── Categories ────────────────────────────────────────────────────────────────
app.get('/api/categories', (req, res) => res.json([
  'Plumbing','Electrical','Carpentry','Painting','Cleaning',
  'Gardening','Cooking','Tutoring','Computer Repair','Sewing',
  'Driving','Babysitting','Elderly Care','Pet Care','Other'
]));

// ── Services ──────────────────────────────────────────────────────────────────
app.post('/api/services', auth, (req, res) => {
  const user = users.find(u => u._id === req.user.userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  const svc = {
    _id: String(serviceIdCounter++),
    providerId: { _id: user._id, name: user.name, rating: user.rating, location: user.location },
    title: req.body.title,
    description: req.body.description,
    category: req.body.category,
    // NEW: Scheduling & pricing options
    pricingType: req.body.pricingType || 'fixed',
    credits: req.body.pricingType === 'quote' ? null : (Number(req.body.credits) || 1),
    quotedPrice: null,
    scheduledDate: req.body.scheduledDate || null,
    estimatedDuration: req.body.estimatedDuration || null,
    location: req.body.location || user.location,
    available: true,
    createdAt: new Date().toISOString()
  };
  services.push(svc);
  console.log(`[SVC] Created "${svc.title}" (${svc.pricingType}) by ${user.name}`);
  res.json(svc);
});

// NEW: Provider submits a quote for their quote-based service
app.put('/api/services/:id/quote', auth, (req, res) => {
  const svc = services.find(s => s._id === req.params.id);
  if (!svc) return res.status(404).json({ message: 'Service not found' });
  const pid = typeof svc.providerId === 'object' ? svc.providerId._id : svc.providerId;
  if (pid !== req.user.userId) return res.status(403).json({ message: 'Not your service' });
  if (svc.pricingType !== 'quote') return res.status(400).json({ message: 'Not a quote-based service' });
  
  svc.quotedPrice = Number(req.body.quotedPrice);
  svc.credits = svc.quotedPrice;
  console.log(`[QUOTE] Service ${svc._id} quoted at ${svc.quotedPrice} credits`);
  res.json(svc);
});

app.get('/api/services', auth, (req, res) => {
  res.json(services.map(s => {
    const pid = typeof s.providerId === 'object' ? s.providerId._id : s.providerId;
    const prov = users.find(u => u._id === pid);
    return { ...s, providerId: prov ? { _id: prov._id, name: prov.name } : s.providerId };
  }));
});

app.get('/api/services/my-services', auth, (req, res) => {
  const uid = req.user.userId;
  res.json(services.filter(s => {
    const pid = typeof s.providerId === 'object' ? s.providerId._id : s.providerId;
    return pid === uid;
  }));
});

app.get('/api/services/nearby', auth, (req, res) => {
  const { lat, lng, radius = 50 } = req.query;
  const uid = req.user.userId;
  res.json(services.map(s => {
    const pid = typeof s.providerId === 'object' ? s.providerId._id : s.providerId;
    const prov = users.find(u => u._id === pid);
    const loc = (typeof s.providerId === 'object' && s.providerId.location) || prov?.location;
    const dist = (loc && lat && lng) ? calcDist(+lat, +lng, loc.lat, loc.lng) : 999;
    return { ...s, providerId: prov ? { _id: prov._id, name: prov.name } : s.providerId, distance: Math.round(dist*10)/10 };
  }).filter(s => {
    const pid = typeof s.providerId === 'object' ? s.providerId._id : s.providerId;
    return pid !== uid && s.distance <= +radius;
  }).sort((a,b) => a.distance - b.distance));
});

// ── Transactions + Notifications ──────────────────────────────────────────────
app.post('/api/transactions/request', auth, (req, res) => {
  const { serviceId } = req.body;
  const requester = users.find(u => u._id === req.user.userId);
  if (!requester) return res.status(401).json({ message: 'Session expired' });

  const svc = services.find(s => s._id === serviceId);
  if (!svc) return res.status(404).json({ message: 'Service not found' });

  const isQuote = svc.pricingType === 'quote';
  const credits = isQuote ? null : svc.credits;

  // For fixed price: check + deduct credits now
  // For quote: just hold, deduct later when quote accepted
  if (!isQuote) {
    if (requester.credits < svc.credits)
      return res.status(400).json({ message: 'Insufficient credits' });
    requester.credits -= svc.credits;
    requester.escrowCredits = (requester.escrowCredits || 0) + svc.credits;
  }

  const providerId = typeof svc.providerId === 'object' ? svc.providerId._id : svc.providerId;
  const providerName = typeof svc.providerId === 'object' ? svc.providerId.name : (users.find(u => u._id === providerId)?.name || 'Provider');

  const tx = {
    _id: String(transactionIdCounter++),
    requesterId: { _id: requester._id, name: requester.name },
    providerId:  { _id: providerId, name: providerName },
    serviceId: svc,
    credits: credits,
    quotedPrice: null,  // set later for quote-based
    status: isQuote ? 'quoting' : 'pending',
    createdAt: new Date().toISOString()
  };
  transactions.push(tx);

  // ── Notify provider ──────────────────────────────────────────────────────
  notifyUser(
    providerId,
    isQuote ? 'quote_requested' : 'service_request',
    isQuote 
      ? `${requester.name} wants a quote for: "${svc.title}"`
      : `${requester.name} wants your service: "${svc.title}" (${svc.credits} credits)`,
    { transactionId: tx._id, requesterName: requester.name, serviceTitle: svc.title, isQuote }
  );

  console.log(`[TX ${tx._id}] ${requester.name} → ${providerName} for "${svc.title}" (${isQuote ? 'QUOTE' : 'FIXED'})`);
  res.json(tx);
});

// NEW: Provider submits a quote for a transaction
app.put('/api/transactions/:id/quote', auth, (req, res) => {
  const t = transactions.find(x => x._id === req.params.id);
  if (!t) return res.status(404).json({ message: 'Not found' });
  if (t.providerId._id !== req.user.userId) return res.status(403).json({ message: 'Not authorized' });
  if (t.status !== 'quoting') return res.status(400).json({ message: 'Not in quoting phase' });

  const quotedCredits = Number(req.body.quotedCredits);
  if (!quotedCredits || quotedCredits < 1) return res.status(400).json({ message: 'Invalid quote' });

  t.quotedPrice = quotedCredits;
  t.status = 'quote_pending';  // waiting for requester to accept

  notifyUser(
    t.requesterId._id,
    'quote_received',
    `${t.providerId.name} sent you a quote: ${quotedCredits} credits for "${t.serviceId.title}"`,
    { transactionId: t._id, quotedCredits }
  );

  res.json(t);
});

// NEW: Requester accepts the quote
app.put('/api/transactions/:id/accept-quote', auth, (req, res) => {
  const t = transactions.find(x => x._id === req.params.id);
  if (!t) return res.status(404).json({ message: 'Not found' });
  if (t.requesterId._id !== req.user.userId) return res.status(403).json({ message: 'Not authorized' });
  if (t.status !== 'quote_pending') return res.status(400).json({ message: 'No quote pending' });

  const requester = users.find(u => u._id === t.requesterId._id);
  if (requester.credits < t.quotedPrice)
    return res.status(400).json({ message: 'Insufficient credits for quote' });

  // Deduct credits now
  requester.credits -= t.quotedPrice;
  requester.escrowCredits = (requester.escrowCredits || 0) + t.quotedPrice;
  t.credits = t.quotedPrice;
  t.status = 'pending';  // Now goes to normal pending (provider needs to accept)

  notifyUser(
    t.providerId._id,
    'quote_accepted',
    `${t.requesterId.name} accepted your quote (${t.quotedPrice} credits). Accept the job?`,
    { transactionId: t._id }
  );

  res.json(t);
});

app.put('/api/transactions/:id/accept', auth, (req, res) => {
  const t = transactions.find(x => x._id === req.params.id);
  if (!t) return res.status(404).json({ message: 'Not found' });
  if (t.providerId._id !== req.user.userId) return res.status(403).json({ message: 'Not authorized' });
  t.status = 'accepted';
  notifyUser(t.requesterId._id, 'request_accepted',
    `${t.providerId.name} accepted your request for "${t.serviceId.title}"`,
    { transactionId: t._id });
  res.json(t);
});

app.put('/api/transactions/:id/reject', auth, (req, res) => {
  const t = transactions.find(x => x._id === req.params.id);
  if (!t) return res.status(404).json({ message: 'Not found' });
  if (t.providerId._id !== req.user.userId) return res.status(403).json({ message: 'Not authorized' });
  // Refund
  const requester = users.find(u => u._id === t.requesterId._id);
  if (requester) { requester.credits += t.credits; requester.escrowCredits = Math.max(0, (requester.escrowCredits||0) - t.credits); }
  t.status = 'rejected';
  notifyUser(t.requesterId._id, 'request_rejected',
    `${t.providerId.name} declined your request. Credits refunded.`,
    { transactionId: t._id, credits: t.credits });
  res.json(t);
});

app.put('/api/transactions/:id/complete', auth, (req, res) => {
  const t = transactions.find(x => x._id === req.params.id);
  if (!t) return res.status(404).json({ message: 'Not found' });
  const requester = users.find(u => u._id === t.requesterId._id);
  const provider  = users.find(u => u._id === t.providerId._id);
  if (requester) requester.escrowCredits = Math.max(0, (requester.escrowCredits||0) - t.credits);
  if (provider)  provider.credits += t.credits;
  t.status = 'completed';
  if (req.body.rating) t.rating = req.body.rating;
  notifyUser(t.providerId._id, 'job_completed',
    `Job "${t.serviceId.title}" complete. ${t.credits} credits added to your balance!`,
    { transactionId: t._id, credits: t.credits });
  res.json({ transaction: t, requesterCredits: requester?.credits });
});

app.get('/api/transactions', auth, (req, res) => {
  const uid = req.user.userId;
  res.json(transactions.filter(t => t.requesterId._id === uid || t.providerId._id === uid));
});
app.get('/api/transactions/my-transactions', auth, (req, res) => {
  const uid = req.user.userId;
  res.json(transactions.filter(t => t.requesterId._id === uid || t.providerId._id === uid));
});

// ── Notifications ─────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  const uid = req.user.userId;
  res.json(notifications.filter(n => n.userId === uid).reverse());
});
app.put('/api/notifications/read-all', auth, (req, res) => {
  notifications.filter(n => n.userId === req.user.userId).forEach(n => { n.read = true; });
  res.json({ ok: true });
});
app.put('/api/notifications/:id/read', auth, (req, res) => {
  const n = notifications.find(x => x._id === req.params.id && x.userId === req.user.userId);
  if (!n) return res.status(404).json({ message: 'Not found' });
  n.read = true;
  res.json(n);
});

// ── Workers ───────────────────────────────────────────────────────────────────
app.get('/api/users/workers', auth, (req, res) => {
  const { lat, lng } = req.query;
  res.json(users.map(u => ({
    userId: u._id, name: u.name, skills: u.skills, location: u.location,
    distance: (u.location && lat && lng) ? Math.round(calcDist(+lat,+lng,u.location.lat,u.location.lng)*10)/10 : null
  })));
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status: 'OK', mode: 'LIVE',
  users: users.length, services: services.length,
  transactions: transactions.length,
  online: Object.keys(onlineUsers).length
}));

// ── Serve React ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client/build')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});


// TEMP: Migration to fix existing user credits to 100
app.post('/api/migrate/credits', (req, res) => {
  let updated = 0;
  users.forEach(u => {
    if (u.credits === 10) {
      u.credits = 100;
      updated++;
    }
  });
  res.json({ message: `Updated ${updated} users to 100 credits`, totalUsers: users.length });
});

// TEMP: Fix specific user credits
app.post('/api/fix-my-credits', auth, (req, res) => {
  const user = users.find(u => u._id === req.user.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const oldCredits = user.credits;
  user.credits = 100;
  res.json({ message: 'Credits updated', oldCredits, newCredits: 100 });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`GShop LIVE on port ${PORT} — no demo data, Socket.IO enabled`);
});







