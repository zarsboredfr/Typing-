const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const LEGACY_FILE = path.join(__dirname, 'data.json');

function readJson(file, fallback = []) {
  if (!fs.existsSync(file)) {
    writeJson(file, fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function migrateLegacyData() {
  if (!fs.existsSync(LEGACY_FILE)) return;
  if (fs.existsSync(USERS_FILE) && fs.existsSync(MESSAGES_FILE) && fs.existsSync(SESSIONS_FILE)) return;

  try {
    const legacy = readJson(LEGACY_FILE, { users: [], messages: [], sessions: [] });
    writeJson(USERS_FILE, legacy.users || []);
    writeJson(MESSAGES_FILE, legacy.messages || []);
    writeJson(SESSIONS_FILE, legacy.sessions || []);
  } catch (error) {
    console.error('Failed to migrate legacy data:', error);
  }
}

function ensureFiles() {
  migrateLegacyData();
  readJson(USERS_FILE, []);
  readJson(MESSAGES_FILE, []);
  readJson(SESSIONS_FILE, []);
}

function loadUsers() {
  return readJson(USERS_FILE, []);
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function loadMessages() {
  return readJson(MESSAGES_FILE, []);
}

function saveMessages(messages) {
  writeJson(MESSAGES_FILE, messages);
}

function loadSessions() {
  return readJson(SESSIONS_FILE, []);
}

function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function sanitizeText(text) {
  return typeof text === 'string' ? text.trim().slice(0, 500) : '';
}

function validateEmail(email) {
  return typeof email === 'string' && /^\S+@\S+\.\S+$/.test(email);
}

function validatePassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[!@#$%^&*(),.?"'{}\[\]\/\\<>~`_+=|-]/.test(password);
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return '';
  return cookieHeader.split(';').map((part) => part.trim()).reduce((value, part) => {
    const [key, val] = part.split('=');
    if (key === name) return decodeURIComponent(val || '');
    return value;
  }, '');
}

function createSession(userId) {
  const token = uuidv4();
  const sessions = loadSessions();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  sessions.push({ token, userId, expiresAt });
  saveSessions(sessions);
  return token;
}

function getUserFromToken(token) {
  if (!token) return null;
  const sessions = loadSessions();
  const active = sessions.filter((item) => !item.expiresAt || item.expiresAt > Date.now());
  if (active.length !== sessions.length) {
    saveSessions(active);
  }
  const session = active.find((item) => item.token === token);
  if (!session) return null;
  const users = loadUsers();
  return users.find((user) => user.id === session.userId) || null;
}

function getTokenFromRequest(req) {
  const headerToken = (req.headers.authorization || '').split(' ')[1];
  if (headerToken) return headerToken;
  return getCookieValue(req.headers.cookie, 'typingAuth');
}

function getTokenFromSocket(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return authToken;
  return getCookieValue(socket.handshake.headers.cookie, 'typingAuth');
}

function setAuthCookie(res, token) {
  const isSecure = process.env.NODE_ENV === 'production';
  res.cookie('typingAuth', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  const isSecure = process.env.NODE_ENV === 'production';
  res.clearCookie('typingAuth', {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
  });
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email,
    avatar: user.avatar || '',
    bio: user.bio || '',
    createdAt: user.createdAt || null,
    friends: user.friends || [],
  };
}

function updateUser(userId, updates) {
  const users = loadUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) return null;
  Object.assign(user, updates);
  saveUsers(users);
  return user;
}

ensureFiles();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again later.' },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many signup attempts, please try again later.' },
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Too many messages, slow down a bit.' },
});

const onlineUsers = new Map();

function getUniqueOnlineUsers() {
  const users = new Map();
  for (const { userId, username } of onlineUsers.values()) {
    users.set(userId, { userId, username });
  }
  return Array.from(users.values());
}

function broadcastOnlineUsers() {
  io.emit('onlineUsers', getUniqueOnlineUsers());
}

io.use((socket, next) => {
  const token = getTokenFromSocket(socket);
  const user = getUserFromToken(token);
  if (!user) {
    return next(new Error('Unauthorized'));
  }
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  onlineUsers.set(socket.id, { userId: user.id, username: user.username });
  broadcastOnlineUsers();

  socket.on('typing', (payload) => {
    const isTyping = !!payload?.isTyping;
    socket.broadcast.emit('typing', { username: user.username, isTyping });
  });

  socket.on('message', (payload, callback) => {
    const text = sanitizeText(payload?.text);
    if (!text) {
      return callback?.({ error: 'Message text is required.' });
    }
    const messages = loadMessages();
    const message = {
      id: uuidv4(),
      author: user.username,
      userId: user.id,
      avatar: user.avatar || `https://api.dicebear.com/initials/svg?seed=${encodeURIComponent(user.username)}`,
      text,
      createdAt: Date.now(),
    };
    messages.push(message);
    saveMessages(messages);
    io.emit('message', message);
    callback?.({ status: 'ok', message });
  });

  socket.on('deleteMessage', (payload, callback) => {
    const messageId = payload?.id;
    if (!messageId) {
      return callback?.({ error: 'Message id is required.' });
    }
    const messages = loadMessages();
    const message = messages.find((msg) => msg.id === messageId);
    if (!message) {
      return callback?.({ error: 'Message not found.' });
    }
    if (message.userId !== user.id) {
      return callback?.({ error: 'Not authorized to delete this message.' });
    }
    const updated = messages.filter((msg) => msg.id !== messageId);
    saveMessages(updated);
    io.emit('messageDeleted', { id: messageId });
    callback?.({ status: 'ok' });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
    socket.broadcast.emit('typing', { username: user.username, isTyping: false });
  });
});

app.post('/api/signup', signupLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '').trim();

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required.' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character.' });
  }

  const users = loadUsers();
  if (users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email already exists.' });
  }
  if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already exists.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username,
    displayName: displayName || username,
    email,
    password: hashedPassword,
    avatar: `https://api.dicebear.com/initials/svg?seed=${encodeURIComponent(username)}`,
    bio: '',
    createdAt: Date.now(),
    friends: [],
    failedLoginAttempts: 0,
    lockedUntil: null,
  };
  users.push(user);
  saveUsers(users);
  const token = createSession(user.id);
  setAuthCookie(res, token);
  return res.json({ user: publicUser(user), token });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const users = loadUsers();
  const user = users.find((item) => item.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    return res.status(403).json({ error: 'Account locked due to too many failed login attempts. Try again later.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= 5) {
      user.lockedUntil = Date.now() + 30 * 60 * 1000;
    }
    saveUsers(users);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  saveUsers(users);

  const token = createSession(user.id);
  setAuthCookie(res, token);
  return res.json({ user: publicUser(user), token });
});

app.get('/api/messages', (req, res) => {
  const messages = loadMessages();
  return res.json({ messages });
});

app.get('/api/me', (req, res) => {
  const auth = getTokenFromRequest(req);
  const user = getUserFromToken(auth);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.json({ user: publicUser(user) });
});

app.get('/api/users/:id', (req, res) => {
  const auth = getTokenFromRequest(req);
  const currentUser = getUserFromToken(auth);
  const users = loadUsers();
  const targetId = req.params.id;
  const targetUser = users.find((item) => item.id === targetId);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }
  const profile = publicUser(targetUser);
  let friendSince = null;
  if (currentUser) {
    const friend = (currentUser.friends || []).find((item) => item.userId === targetId);
    if (friend) {
      friendSince = friend.since;
    }
  }
  return res.json({ profile, friendSince });
});

app.post('/api/friends/:id', (req, res) => {
  const auth = getTokenFromRequest(req);
  const currentUser = getUserFromToken(auth);
  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const targetId = req.params.id;
  if (targetId === currentUser.id) {
    return res.status(400).json({ error: 'Cannot add yourself as a friend.' });
  }
  const users = loadUsers();
  const targetUser = users.find((item) => item.id === targetId);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }
  currentUser.friends = currentUser.friends || [];
  targetUser.friends = targetUser.friends || [];
  if (currentUser.friends.some((item) => item.userId === targetId)) {
    return res.status(400).json({ error: 'Already friends.' });
  }
  const since = Date.now();
  currentUser.friends.push({ userId: targetId, since });
  targetUser.friends.push({ userId: currentUser.id, since });
  saveUsers(users);
  return res.json({ status: 'ok', since });
});

app.post('/api/logout', (req, res) => {
  const auth = getTokenFromRequest(req);
  const sessions = loadSessions().filter((session) => session.token !== auth);
  saveSessions(sessions);
  clearAuthCookie(res);
  return res.json({ status: 'ok' });
});

app.post('/api/logout-all', (req, res) => {
  const auth = getTokenFromRequest(req);
  const user = getUserFromToken(auth);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sessions = loadSessions().filter((session) => session.userId !== user.id);
  saveSessions(sessions);
  clearAuthCookie(res);
  return res.json({ status: 'ok' });
});

app.put('/api/me', (req, res) => {
  const auth = getTokenFromRequest(req);
  const user = getUserFromToken(auth);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const displayName = String(req.body.displayName || '').trim();
  const email = String(req.body.email || '').trim();
  const avatar = String(req.body.avatar || '').trim();
  const bio = String(req.body.bio || '').trim();

  if (!displayName || !email) {
    return res.status(400).json({ error: 'Display name and email are required.' });
  }
  if (displayName.length > 30) {
    return res.status(400).json({ error: 'Display name must be 30 characters or fewer.' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const users = loadUsers();
  if (users.some((item) => item.id !== user.id && item.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email already exists.' });
  }

  const updated = updateUser(user.id, {
    displayName,
    email,
    avatar: avatar || user.avatar,
    bio,
  });

  if (!updated) {
    return res.status(500).json({ error: 'Unable to update profile.' });
  }

  return res.json({ user: publicUser(updated) });
});

app.put('/api/me/password', async (req, res) => {
  const auth = getTokenFromRequest(req);
  const user = getUserFromToken(auth);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const currentPassword = String(req.body.currentPassword || '').trim();
  const newPassword = String(req.body.newPassword || '').trim();

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  const passwordMatches = await bcrypt.compare(currentPassword, user.password);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 8 characters and include an uppercase letter, a number, and a special character.' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  updateUser(user.id, { password: hashedPassword });
  return res.json({ status: 'ok' });
});

app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Typing… backend running on http://localhost:${port}`);
});
