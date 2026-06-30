const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 5001;
const JWT_SECRET = 'watchtogether_super_secret_key_2026';
const DB_PATH = path.join(__dirname, 'db.json');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Helper functions for reading/writing DB
function readDb() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database:', err);
    return { users: [] };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing database:', err);
  }
}

// REST API endpoints
app.post('/api/register', (req, res) => {
  const { username, password, nickname, avatar } = req.body;
  if (!username || !password || !nickname) {
    return res.status(400).json({ error: 'Please provide username, password, and nickname' });
  }

  const db = readDb();
  const existingUser = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existingUser) {
    return res.status(400).json({ error: 'Username already taken' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const newUser = {
    id: '_' + Math.random().toString(36).substr(2, 9),
    username,
    password: hashedPassword,
    nickname,
    avatar: avatar || 'default',
    favorites: [],
    history: []
  };

  db.users.push(newUser);
  writeDb(db);

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      nickname: newUser.nickname,
      avatar: newUser.avatar,
      favorites: newUser.favorites,
      history: newUser.history
    }
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide username and password' });
  }

  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      favorites: user.favorites || [],
      history: user.history || []
    }
  });
});

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

app.get('/api/profile', authenticateToken, (req, res) => {
  const db = readDb();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar,
    favorites: user.favorites || [],
    history: user.history || []
  });
});

app.put('/api/profile', authenticateToken, (req, res) => {
  const { nickname, avatar, favorites, history } = req.body;
  const db = readDb();
  const userIndex = db.users.findIndex(u => u.id === req.user.id);
  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

  const user = db.users[userIndex];
  if (nickname) user.nickname = nickname;
  if (avatar) user.avatar = avatar;
  if (favorites) user.favorites = favorites;
  if (history) user.history = history;

  db.users[userIndex] = user;
  writeDb(db);

  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar,
    favorites: user.favorites,
    history: user.history
  });
});

// In-memory Room State
// Structure:
// rooms = {
//   [roomId]: {
//     id: roomId,
//     name: string,
//     isPublic: boolean,
//     hostSocketId: string,
//     videoState: { url, currentTime, playing, isScreenShare },
//     users: {
//       [socketId]: { socketId, nickname, avatar, userId }
//     }
//   }
// }
const rooms = {};

// Helper to get active public rooms
app.get('/api/rooms', (req, res) => {
  const publicRoomsList = Object.values(rooms)
    .filter(room => room.isPublic)
    .map(room => ({
      id: room.id,
      name: room.name,
      userCount: Object.keys(room.users).length,
      currentVideoUrl: room.videoState.url || 'None',
      playing: room.videoState.playing,
    }));
  res.json(publicRoomsList);
});

// Socket.io handlers
io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join-room', ({ roomId, nickname, avatar, userId, roomName, isPublic }) => {
    socket.join(roomId);
    currentRoomId = roomId;

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        name: roomName || `${nickname}'s Watch Party`,
        isPublic: isPublic !== undefined ? isPublic : true,
        hostSocketId: socket.id,
        videoState: {
          url: '',
          currentTime: 0,
          playing: false,
          isScreenShare: false,
        },
        users: {},
      };
    }

    const room = rooms[roomId];

    // Add user to room state
    room.users[socket.id] = {
      socketId: socket.id,
      nickname: nickname || 'Anonymous',
      avatar: avatar || 'avatar-1',
      userId: userId || null,
      cameraOn: true,
      micOn: true,
    };

    // If room has no active host (e.g. host disconnected earlier), designate this user
    if (!room.hostSocketId || !room.users[room.hostSocketId]) {
      room.hostSocketId = socket.id;
    }

    // Broadcast updated user list to everyone in the room
    io.to(roomId).emit('room-update', {
      roomId,
      roomName: room.name,
      isPublic: room.isPublic,
      hostSocketId: room.hostSocketId,
      users: Object.values(room.users),
      videoState: room.videoState,
    });

    // Notify others in room
    socket.to(roomId).emit('chat-message', {
      id: '_' + Math.random().toString(36).substr(2, 9),
      text: `${nickname || 'Someone'} has joined the room.`,
      sender: 'System',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      avatar: 'system',
    });

    // Emit initial player sync state to the new joiner
    socket.emit('video-state-update', room.videoState);
  });

  // Chat message exchange
  socket.on('chat-message', ({ text, sender, avatar }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    io.to(currentRoomId).emit('chat-message', {
      id: '_' + Math.random().toString(36).substr(2, 9),
      text,
      sender,
      avatar,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  });

  // Reaction burst
  socket.on('emoji-reaction', ({ emoji, sender }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    io.to(currentRoomId).emit('emoji-reaction', {
      emoji,
      sender,
    });
  });

  // Video State Sync
  socket.on('video-state-change', (newState) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];

    // Check if the user is the host
    const isHost = room.hostSocketId === socket.id;
    if (!isHost) {
      // Send error back or ignore. In a watch party, the host controls the stream.
      return;
    }

    // Update server side state
    room.videoState = {
      ...room.videoState,
      ...newState,
    };

    // Broadcast update to all other room members
    socket.to(currentRoomId).emit('video-state-update', room.videoState);
  });

  // Update room metadata (privacy/name)
  socket.on('update-room-meta', ({ name, isPublic }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];

    // Only host can modify
    if (room.hostSocketId !== socket.id) return;

    if (name !== undefined) room.name = name;
    if (isPublic !== undefined) room.isPublic = isPublic;

    io.to(currentRoomId).emit('room-update', {
      roomId: room.id,
      roomName: room.name,
      isPublic: room.isPublic,
      hostSocketId: room.hostSocketId,
      users: Object.values(room.users),
      videoState: room.videoState,
    });
  });

  // WebRTC mesh peer discovery/signaling
  socket.on('request-peers', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    // Return all client socket IDs in the room except current sender
    const peers = Object.keys(room.users).filter(id => id !== socket.id);
    socket.emit('peers-list', peers);
  });

  socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('webrtc-offer', {
      senderSocketId: socket.id,
      offer,
    });
  });

  socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      answer,
    });
  });

  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate,
    });
  });

  // WebRTC Screen-sharing signaling
  socket.on('webrtc-offer-screen', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('webrtc-offer-screen', {
      senderSocketId: socket.id,
      offer,
    });
  });

  socket.on('webrtc-answer-screen', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc-answer-screen', {
      senderSocketId: socket.id,
      answer,
    });
  });

  socket.on('webrtc-ice-candidate-screen', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate-screen', {
      senderSocketId: socket.id,
      candidate,
    });
  });

  // Camera/Microphone state updates broadcasting
  socket.on('update-media-status', ({ cameraOn, micOn }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    const roomUser = room.users[socket.id];
    if (roomUser) {
      if (cameraOn !== undefined) roomUser.cameraOn = cameraOn;
      if (micOn !== undefined) roomUser.micOn = micOn;
      
      io.to(currentRoomId).emit('room-update', {
        roomId: room.id,
        roomName: room.name,
        isPublic: room.isPublic,
        hostSocketId: room.hostSocketId,
        users: Object.values(room.users),
        videoState: room.videoState,
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    const disconnectingUser = room.users[socket.id];

    if (disconnectingUser) {
      const { nickname } = disconnectingUser;
      delete room.users[socket.id];

      // Broadcast system message
      io.to(currentRoomId).emit('chat-message', {
        id: '_' + Math.random().toString(36).substr(2, 9),
        text: `${nickname} has left the room.`,
        sender: 'System',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatar: 'system',
      });

      const userCount = Object.keys(room.users).length;
      if (userCount === 0) {
        // Clean up empty room
        delete rooms[currentRoomId];
      } else {
        // If host left, designate a new host from remaining users
        if (room.hostSocketId === socket.id) {
          room.hostSocketId = Object.keys(room.users)[0];
          io.to(currentRoomId).emit('chat-message', {
            id: '_' + Math.random().toString(36).substr(2, 9),
            text: `${room.users[room.hostSocketId].nickname} is now the host.`,
            sender: 'System',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            avatar: 'system',
          });

          // If the previous host was screen-sharing, stop the screen share state
          if (room.videoState.isScreenShare) {
            room.videoState = {
              url: '',
              currentTime: 0,
              playing: false,
              isScreenShare: false,
            };
          }
        }

        // Send updated state to remaining users
        io.to(currentRoomId).emit('room-update', {
          roomId: room.id,
          roomName: room.name,
          isPublic: room.isPublic,
          hostSocketId: room.hostSocketId,
          users: Object.values(room.users),
          videoState: room.videoState,
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
