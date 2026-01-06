const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Configure EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load all test JSON files from tests directory into memory
const testsDir = path.join(__dirname, 'tests');
let tests = {};

function loadTests() {
  try {
    const files = fs.readdirSync(testsDir);
    tests = {};
    
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const filePath = path.join(testsDir, file);
        const testData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        tests[testData.metadata.id] = testData;
      }
    });
    
    console.log(`Loaded ${Object.keys(tests).length} test(s)`);
  } catch (error) {
    console.error('Error loading tests:', error);
  }
}

// Load tests on startup
loadTests();

// In-memory room state
const rooms = {};

// Generate unique four-digit numeric room code
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

// Routes
app.get('/', (req, res) => {
  // Pass all test metadata to index page, grouped by category
  const testMetadata = Object.values(tests).map(test => test.metadata);
  
  // Group tests by category (case-sensitive sort)
  const testsByCategory = {};
  testMetadata.forEach(test => {
    const category = test.category || 'Uncategorized';
    if (!testsByCategory[category]) {
      testsByCategory[category] = [];
    }
    testsByCategory[category].push(test);
  });
  
  // Sort categories (case-sensitive)
  const sortedCategories = Object.keys(testsByCategory).sort();
  
  // Sort tests within each category by name
  sortedCategories.forEach(category => {
    testsByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
  });
  
  res.render('index', { testsByCategory, sortedCategories });
});

// Keep /room/:code route for direct access (optional, mainly for index.ejs now)
app.get('/room/:code', (req, res) => {
  // Redirect to home - all room functionality is now in index.ejs
  res.redirect('/');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Host creates a room
  socket.on('host-room', (data) => {
    const { testId } = data;
    
    if (!tests[testId]) {
      socket.emit('error', { message: 'Invalid test selected' });
      return;
    }
    
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      code: roomCode,
      hostSocketId: socket.id,
      testId: testId,
      test: tests[testId],
      currentQuestionIndex: -1,
      gameStarted: false,
      gameEnded: false,
      players: {},
      playerAnswers: {},
      playerScores: {}, // Track scores for each player
      questionStartTime: null, // Track when current question started
      maxPossiblePoints: 0 // Track maximum possible points
    };
    
    socket.join(roomCode);
    socket.emit('room-created', { roomCode });
    console.log(`Room ${roomCode} created by host ${socket.id}`);
  });

  // Player joins a room
  socket.on('join-room', (data) => {
    const { roomCode, displayName } = data;
    
    if (!rooms[roomCode]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    if (rooms[roomCode].gameEnded) {
      socket.emit('error', { message: 'Game has ended' });
      return;
    }
    
    // Check if display name is already taken in this room
    const existingNames = Object.values(rooms[roomCode].players).map(p => p.displayName);
    if (existingNames.includes(displayName)) {
      socket.emit('error', { message: 'Display name already taken' });
      return;
    }
    
    rooms[roomCode].players[socket.id] = {
      socketId: socket.id,
      displayName: displayName
    };
    
    socket.join(roomCode);
    socket.emit('room-joined', { roomCode });
    
    // Notify host and other players
    io.to(roomCode).emit('player-joined', {
      playerId: socket.id,
      displayName: displayName,
      playerCount: Object.keys(rooms[roomCode].players).length
    });
    
    console.log(`Player ${displayName} (${socket.id}) joined room ${roomCode}`);
  });

  // Leave room
  socket.on('leave-room', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];
    
    if (!room) {
      return;
    }
    
    // If host leaves, immediately disband the room
    if (room.hostSocketId === socket.id) {
      // Notify all players that the host disconnected
      io.to(roomCode).emit('host-disconnected');
      // Delete the room immediately
      delete rooms[roomCode];
      socket.leave(roomCode);
      console.log(`Room ${roomCode} disbanded (host left)`);
      return;
    }
    
    // If player leaves, remove from players
    if (room.players[socket.id]) {
      delete room.players[socket.id];
      delete room.playerAnswers[socket.id];
      socket.leave(roomCode);
      io.to(roomCode).emit('player-left', {
        playerId: socket.id,
        playerCount: Object.keys(room.players).length
      });
      console.log(`Player ${socket.id} left room ${roomCode}`);
    }
  });

  // Host starts the game
  socket.on('start-game', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];
    
    if (!room || room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }
    
    room.gameStarted = true;
    room.currentQuestionIndex = 0;
    room.playerAnswers = {};
    room.playerScores = {};
    // Initialize scores for all players
    for (const playerId in room.players) {
      room.playerScores[playerId] = 0;
    }
    // Calculate max possible points (all correct at t=0: 10 points per question)
    room.maxPossiblePoints = room.test.questions.length * 10;
    room.questionStartTime = Date.now();
    
    // Send first question to all players
    const question = room.test.questions[0];
    io.to(roomCode).emit('question-started', {
      questionIndex: 0,
      question: question,
      totalQuestions: room.test.questions.length,
      startTime: room.questionStartTime
    });
    
    console.log(`Game started in room ${roomCode}`);
  });

  // Host advances to next question
  socket.on('advance-question', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];
    
    if (!room || room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }
    
    // Calculate max possible points based on questions answered
    const questionsAnswered = room.currentQuestionIndex + 1;
    const maxPossiblePoints = questionsAnswered * 10;
    
    if (room.currentQuestionIndex >= room.test.questions.length - 1) {
      // End game
      room.gameEnded = true;
      io.to(roomCode).emit('game-ended', {
        finalScores: calculateScores(room)
      });
    } else {
      // Move to next question
      room.currentQuestionIndex++;
      room.playerAnswers = {};
      room.questionStartTime = Date.now();
      
      const question = room.test.questions[room.currentQuestionIndex];
      io.to(roomCode).emit('question-started', {
        questionIndex: room.currentQuestionIndex,
        question: question,
        totalQuestions: room.test.questions.length,
        startTime: room.questionStartTime
      });
    }
    
    // Send updated leaderboard
    io.to(room.hostSocketId).emit('leaderboard-update', {
      scores: calculateScores(room),
      maxPossiblePoints: maxPossiblePoints
    });
    
    console.log(`Question advanced in room ${roomCode} to index ${room.currentQuestionIndex}`);
  });

  // Player submits an answer
  socket.on('submit-answer', (data) => {
    const { roomCode, answer } = data;
    const room = rooms[roomCode];
    
    if (!room || !room.players[socket.id]) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }
    
    if (room.currentQuestionIndex < 0 || !room.gameStarted || room.gameEnded) {
      socket.emit('error', { message: 'Game not in progress' });
      return;
    }
    
    // Store answer (only first submission counts)
    if (!room.playerAnswers[socket.id]) {
      const currentTime = Date.now();
      const elapsedSeconds = (currentTime - room.questionStartTime) / 1000;
      const currentQuestion = room.test.questions[room.currentQuestionIndex];
      const isCorrect = answer === currentQuestion.answer;
      
      // Calculate points
      let points = 0;
      if (elapsedSeconds <= 60) {
        if (isCorrect) {
          points = 10 - (elapsedSeconds / 6);
        } else {
          points = -3 + (elapsedSeconds / 20);
        }
      }
      // Round to 2 decimal places
      points = Math.round(points * 100) / 100;
      
      // Update player score
      if (!room.playerScores[socket.id]) {
        room.playerScores[socket.id] = 0;
      }
      room.playerScores[socket.id] = Math.round((room.playerScores[socket.id] + points) * 100) / 100;
      
      room.playerAnswers[socket.id] = {
        answer: answer,
        time: elapsedSeconds,
        correct: isCorrect,
        points: points
      };
      
      // Calculate max possible points based on questions answered (not total questions)
      const questionsAnswered = room.currentQuestionIndex + 1; // +1 because we're 0-indexed
      const maxPossiblePoints = questionsAnswered * 10;
      
      // Notify player that answer was received
      socket.emit('answer-received', { 
        locked: true,
        correct: isCorrect,
        points: points,
        totalPoints: room.playerScores[socket.id],
        maxPossiblePoints: maxPossiblePoints,
        selectedAnswer: answer
      });
      
      // Notify host of submission
      io.to(room.hostSocketId).emit('player-answered', {
        playerId: socket.id,
        displayName: room.players[socket.id].displayName,
        answeredCount: Object.keys(room.playerAnswers).length,
        totalPlayers: Object.keys(room.players).length
      });
      
      // Send updated leaderboard to host
      io.to(room.hostSocketId).emit('leaderboard-update', {
        scores: calculateScores(room),
        maxPossiblePoints: maxPossiblePoints
      });
    }
  });

  // Host ends the game
  socket.on('end-game', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];
    
    if (!room || room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }
    
    room.gameEnded = true;
    io.to(roomCode).emit('game-ended', {
      finalScores: calculateScores(room)
    });
    
    console.log(`Game ended in room ${roomCode}`);
  });

  // Get room role (host or player)
  socket.on('get-room-role', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    // Check if this socket is the host (hostSocketId might be null if host disconnected)
    const isHost = room.hostSocketId === socket.id;
    const isPlayer = !!room.players[socket.id];
    
    // Calculate max possible points based on questions answered
    const questionsAnswered = room.currentQuestionIndex >= 0 ? room.currentQuestionIndex + 1 : 0;
    const maxPossiblePoints = questionsAnswered * 10;
    
    socket.emit('room-role', {
      isHost: isHost,
      isPlayer: isPlayer,
      playerCount: Object.keys(room.players).length,
      gameStarted: room.gameStarted,
      gameEnded: room.gameEnded,
      currentQuestionIndex: room.currentQuestionIndex,
      currentPoints: isPlayer ? (room.playerScores[socket.id] || 0) : undefined,
      maxPossiblePoints: maxPossiblePoints
    });
  });


  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
  
      // Host disconnected: immediately disband the room
      if (room.hostSocketId === socket.id) {
        // Notify all players that the host disconnected
        io.to(roomCode).emit('host-disconnected');
        // Delete the room immediately
        delete rooms[roomCode];
        socket.leave(roomCode);
        console.log(`Room ${roomCode} disbanded (host disconnected)`);
        break;
      }
  
      // Player disconnected
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        delete room.playerAnswers[socket.id];
        io.to(roomCode).emit('player-left', {
          playerId: socket.id,
          playerCount: Object.keys(room.players).length
        });
        console.log(`Player ${socket.id} left room ${roomCode}`);
      }
    }
  });  
});

// Calculate scores for all players
function calculateScores(room) {
  const scores = {};
  
  for (const playerId in room.players) {
    scores[playerId] = {
      displayName: room.players[playerId].displayName,
      score: room.playerScores[playerId] || 0
    };
  }
  
  // Sort by score (descending)
  const sortedScores = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
  const sortedScoresObj = {};
  sortedScores.forEach(([playerId, data]) => {
    sortedScoresObj[playerId] = data;
  });
  
  return sortedScoresObj;
}




// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
