const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Enable CORS for cross-platform compatibility
app.use(cors({
  origin: ["*"],
  credentials: true
}));

const io = socketIo(server, {
  cors: {
    origin: ["*"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.json());

// Store connected users and rooms
const users = new Map();
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    
    // Store user info
    users.set(socket.id, {
      id: socket.id,
      name: userName,
      roomId: roomId
    });

    // Add to room
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });

    // Send list of existing users in room
    const roomUsers = Array.from(rooms.get(roomId))
      .filter(id => id !== socket.id)
      .map(id => users.get(id))
      .filter(user => user);

    socket.emit('existing-users', roomUsers);
  });

  // WebRTC signaling
  socket.on('offer', ({ offer, targetUserId }) => {
    socket.to(targetUserId).emit('offer', {
      offer,
      fromUserId: socket.id,
      fromUserName: users.get(socket.id)?.name
    });
  });

  socket.on('answer', ({ answer, targetUserId }) => {
    socket.to(targetUserId).emit('answer', {
      answer,
      fromUserId: socket.id
    });
  });

  socket.on('ice-candidate', ({ candidate, targetUserId }) => {
    socket.to(targetUserId).emit('ice-candidate', {
      candidate,
      fromUserId: socket.id
    });
  });

  // Chat messages
  socket.on('send-message', ({ message, roomId }) => {
    const user = users.get(socket.id);
    if (user) {
      io.to(roomId).emit('receive-message', {
        message,
        userName: user.name,
        userId: socket.id,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const user = users.get(socket.id);
    if (user) {
      const roomId = user.roomId;
      
      // Remove from room
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
        }
      }

      // Notify others in room
      socket.to(roomId).emit('user-left', {
        userId: socket.id,
        userName: user.name
      });
    }

    users.delete(socket.id);
  });
});

// REST endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/rooms/:roomId/users', (req, res) => {
  const roomId = req.params.roomId;
  const roomUsers = rooms.has(roomId) ? 
    Array.from(rooms.get(roomId)).map(id => users.get(id)).filter(user => user) : [];
  
  res.json({ users: roomUsers });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Video call server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

module.exports = app;