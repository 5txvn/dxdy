// Global socket instance
let socket = null;
let isHost = false;
let currentRoomCode = null;
let answerLocked = false;
let timerInterval = null;
let currentPoints = 0;
let maxPossiblePoints = 0;
let questionStartTime = null;

// Initialize socket connection
function initSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
    
    socket.on('error', (data) => {
        showError(data.message);
    });
}

// View management functions
function showHomeView() {
    $('#home-view').removeClass('hidden');
    $('#join-form-view').addClass('hidden');
    $('#room-view').addClass('hidden');
}

function showJoinFormView() {
    $('#home-view').addClass('hidden');
    $('#join-form-view').removeClass('hidden');
    $('#room-view').addClass('hidden');
    $('#room-code').val('');
    $('#display-name').val('');
    $('#join-error-message').addClass('hidden');
}

function showRoomView() {
    $('#home-view').addClass('hidden');
    $('#join-form-view').addClass('hidden');
    $('#room-view').removeClass('hidden');
    // Hide leave room button - users can navigate away themselves
    $('#leave-room-btn').addClass('hidden');
}

function showHostView() {
    $('#host-view').removeClass('hidden');
    $('#player-view').addClass('hidden');
}

function showPlayerView() {
    $('#host-view').addClass('hidden');
    $('#player-view').removeClass('hidden');
    $('#waiting-screen').removeClass('hidden');
    $('#question-screen').addClass('hidden');
    $('#game-ended-screen').addClass('hidden');
}

// Initialize on page load
$(document).ready(function() {
    // Initialize socket
    if (!socket) {
        initSocket();
    }

    // Handle test button clicks
    $(document).on('click', '.test-btn', function() {
        const testId = $(this).data('test-id');
        const testName = $(this).data('test-name');
        
        if (!socket || !socket.connected) {
            showError('Connection error. Please wait and try again.');
            return;
        }
        
        // Disable all test buttons
        $('.test-btn').prop('disabled', true).addClass('opacity-50');
        
        // Show status
        $('#status-text').text(`Creating room for ${testName}...`);
        $('#status-message').removeClass('hidden');
        $('#error-message').addClass('hidden');
        
        // Emit host room event
        socket.emit('host-room', { testId: testId });
    });

    // Handle join room button
    $('#join-room-btn').on('click', function() {
        showJoinFormView();
    });

    // Handle back to home button
    $('#back-to-home-btn').on('click', function() {
        showHomeView();
    });

    // Leave room functionality removed - users can navigate away themselves

    // Handle join form submission
    $('#join-form').on('submit', function(e) {
        e.preventDefault();
        
        const roomCode = $('#room-code').val();
        const teamName = $('#team-name').val().trim();
        
        if (!roomCode || roomCode.length !== 4) {
            $('#join-error-message').text('Please enter a valid 4-digit room code').removeClass('hidden');
            return;
        }
        
        if (!teamName) {
            $('#join-error-message').text('Please enter a team name').removeClass('hidden');
            return;
        }
        
        if (!socket || !socket.connected) {
            $('#join-error-message').text('Connection error. Please wait and try again.').removeClass('hidden');
            return;
        }
        
        socket.emit('join-room', { roomCode: roomCode, displayName: teamName });
    });

    // Handle room creation
    socket.on('room-created', (data) => {
        const { roomCode } = data;
        
        // Hide status message
        $('#status-message').addClass('hidden');
        
        // Initialize room view as host
        initializeRoom(roomCode, true);
    });

    // Handle successful room join
    socket.on('room-joined', (data) => {
        const { roomCode } = data;
        initializeRoom(roomCode, false);
    });

    // Setup game events
    setupGameEvents();
});

// Initialize room view
function initializeRoom(roomCode, isHostUser) {
    currentRoomCode = roomCode;
    
    showRoomView();
    $('#room-code-header').text(roomCode);
    
    // Request role from server to confirm
    socket.emit('get-room-role', { roomCode: roomCode });
    
    // Handle role response
    socket.on('room-role', function handleRoleResponse(data) {
        isHost = data.isHost;
        
        if (isHost) {
            showHostView();
            setupHostEvents();
            const playerText = data.playerCount === 1 ? '1 player connected' : `${data.playerCount} players connected`;
            $('#player-count').text(playerText).removeClass('hidden');
            $('#timer-display').addClass('hidden');
            $('#total-players-count').text(data.playerCount);
            // Initialize leaderboard
            if (data.maxPossiblePoints) {
                maxPossiblePoints = data.maxPossiblePoints;
            }
        } else if (data.isPlayer) {
            showPlayerView();
            setupPlayerEvents();
            // Show timer in header for players
            $('#timer-display').removeClass('hidden');
            $('#player-count').addClass('hidden');
            // Initialize points
            if (data.currentPoints !== undefined) {
                currentPoints = data.currentPoints;
            }
            if (data.maxPossiblePoints) {
                maxPossiblePoints = data.maxPossiblePoints;
                updatePointsDisplay();
            }
        } else {
            showError('Room not found. Redirecting...');
            setTimeout(() => {
                showHomeView();
            }, 2000);
        }
        
        // Remove listener after handling
        socket.off('room-role', handleRoleResponse);
    });
}

function setupHostEvents() {
    $('#start-game-btn').off('click').on('click', function() {
        socket.emit('start-game', { roomCode: currentRoomCode });
    });
    
    $('#advance-question-btn').off('click').on('click', function() {
        stopTimer();
        socket.emit('advance-question', { roomCode: currentRoomCode });
    });
    
    $('#end-game-btn').off('click').on('click', function() {
        stopTimer();
        socket.emit('end-game', { roomCode: currentRoomCode });
    });
    
    // Make question clickable to reveal answer
    $(document).off('click', '#host-question-content').on('click', '#host-question-content', function() {
        socket.emit('reveal-answer', { roomCode: currentRoomCode });
    });
    
    $('#close-modal-btn').off('click').on('click', function() {
        $('#answer-modal').addClass('hidden');
    });
}

let lastSelectedAnswer = null;

function setupPlayerEvents() {
    // Answer selection
    $(document).off('click', '.choice-btn').on('click', '.choice-btn', function() {
        if (answerLocked) {
            return;
        }
        
        const answer = $(this).data('choice');
        lastSelectedAnswer = answer;
        socket.emit('submit-answer', { roomCode: currentRoomCode, answer: answer });
    });
}

// Timer functions
function startTimer(startTime) {
    stopTimer();
    questionStartTime = startTime || Date.now();
    const timerElement = $('#digital-timer');
    const timerDisplay = $('#timer-display');
    
    timerDisplay.removeClass('hidden');
    
    timerInterval = setInterval(() => {
        const elapsed = (Date.now() - questionStartTime) / 1000;
        const remaining = Math.max(0, 60 - elapsed);
        const seconds = Math.floor(remaining);
        
        timerElement.text(seconds.toString().padStart(2, '0'));
        
        if (remaining <= 0) {
            stopTimer();
            timerElement.text('00');
        }
    }, 100);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function setupGameEvents() {
    // Question started
    socket.on('question-started', (data) => {
        const { questionIndex, question, totalQuestions, startTime } = data;
        
        // Start timer
        startTimer(startTime);
        
        if (isHost) {
            // Host view
            $('#host-controls').addClass('hidden');
            $('#game-controls').removeClass('hidden');
            $('#current-question-num').text(questionIndex + 1);
            $('#total-questions').text(totalQuestions);
            $('#answered-count').text('0');
            
            // Display question for host
            $('#host-question-display').removeClass('hidden');
            $('#host-question-content').html(question.question);
            renderMathJax('#host-question-content');
            
            // Hide player count, show timer in header (replacing player count)
            $('#player-count').addClass('hidden');
            $('#timer-display').removeClass('hidden');
        } else {
            // Player view
            $('#waiting-screen').addClass('hidden');
            $('#question-screen').removeClass('hidden');
            $('#game-ended-screen').addClass('hidden');
            
            $('#player-question-num').text(questionIndex + 1);
            $('#player-total-questions').text(totalQuestions);
            answerLocked = false;
            lastSelectedAnswer = null;
            
            // Reset choice buttons styling
            $('.choice-btn').css({
                'background-color': '',
                'color': '',
                'border-color': ''
            }).removeClass('opacity-50 cursor-not-allowed');
            $('.choice-btn .choice-text').css('color', '#000000');
            $('.choice-btn span').css('color', '#1098f7');
            
            // Update points display
            updatePointsDisplay();
            
            // Display question
            $('#question-content').html(question.question);
            renderMathJax('#question-content');
            
            // Display choices
            const choicesContainer = $('#choices-container');
            choicesContainer.empty();
            
            for (const [letter, choiceText] of Object.entries(question.choices)) {
                const choiceBtn = $(`
                    <button class="choice-btn w-full bg-white hover:bg-gray-50 border-2 border-gray-300 hover:border-blue-500 rounded-lg p-4 text-left transition duration-200" 
                            data-choice="${letter}">
                        <div class="flex items-center">
                            <span class="font-semibold mr-3" style="color: #1098f7;">${letter.toUpperCase()}.</span>
                            <span class="choice-text" style="color: #000000;">${choiceText}</span>
                        </div>
                    </button>
                `);
                choicesContainer.append(choiceBtn);
            }
            
            // Render MathJax for choices
            renderMathJax('#choices-container');
        }
    });
    
    // Player answered (host only)
    socket.on('player-answered', (data) => {
        if (isHost) {
            $('#answered-count').text(data.answeredCount);
        }
    });
    
    // Answer received (player only)
    socket.on('answer-received', (data) => {
        if (data.locked) {
            answerLocked = true;
            stopTimer();
            currentPoints = data.totalPoints || 0;
            maxPossiblePoints = data.maxPossiblePoints || 0;
            
            // Update points display
            updatePointsDisplay();
            
            // Disable all buttons
            $('.choice-btn').off('click');
            
            // Highlight selected answer
            const answerToHighlight = data.selectedAnswer || lastSelectedAnswer;
            const selectedBtn = $(`.choice-btn[data-choice="${answerToHighlight || ''}"]`);
            if (selectedBtn.length) {
                // Remove opacity and muted styling from selected button
                selectedBtn.removeClass('opacity-50 cursor-not-allowed');
                
                if (data.correct) {
                    selectedBtn.css({
                        'background-color': '#1098f7',
                        'color': '#ffffff',
                        'border-color': '#1098f7'
                    });
                    // Make all text white
                    selectedBtn.find('.choice-text').css('color', '#ffffff');
                    selectedBtn.find('span').css('color', '#ffffff');
                    // Blue confetti
                    triggerConfetti('#1098f7');
                } else {
                    selectedBtn.css({
                        'background-color': '#000000',
                        'color': '#ffffff',
                        'border-color': '#000000'
                    });
                    // Make all text white
                    selectedBtn.find('.choice-text').css('color', '#ffffff');
                    selectedBtn.find('span').css('color', '#ffffff');
                    // No confetti for wrong answers
                }
            }
            
            // Disable other buttons (but keep them visible)
            $('.choice-btn').not(selectedBtn).addClass('opacity-50 cursor-not-allowed');
        }
    });
    
    // Answer revealed (host only)
    socket.on('answer-revealed', (data) => {
        $('#modal-correct-answer').text(data.correctAnswer.toUpperCase());
        $('#modal-correct-choice').html(data.correctChoice);
        $('#modal-explanation').html(data.explanation || 'No explanation provided.');
        $('#answer-modal').removeClass('hidden');
        renderMathJax('#modal-correct-choice');
        renderMathJax('#modal-explanation');
    });
    
    // Leaderboard update (host only)
    socket.on('leaderboard-update', (data) => {
        if (isHost) {
            updateLeaderboard(data.scores, data.maxPossiblePoints);
        }
    });
    
    // Player joined/left
    socket.on('player-joined', (data) => {
        if (isHost) {
            $('#total-players-count').text(data.playerCount);
            const playerText = data.playerCount === 1 ? '1 player connected' : `${data.playerCount} players connected`;
            $('#player-count').text(playerText);
        }
    });
    
    socket.on('player-left', (data) => {
        if (isHost) {
            $('#total-players-count').text(data.playerCount);
            const playerText = data.playerCount === 1 ? '1 player connected' : `${data.playerCount} players connected`;
            $('#player-count').text(playerText);
        }
    });
    
    // Game ended
    socket.on('game-ended', (data) => {
        if (isHost) {
            $('#game-controls').addClass('hidden');
            $('#host-controls').removeClass('hidden');
            alert('Game ended!');
        } else {
            $('#question-screen').addClass('hidden');
            $('#game-ended-screen').removeClass('hidden');
            
            // Display final scores (simplified)
            const scoresHtml = '<p>Thank you for playing!</p>';
            $('#final-scores').html(scoresHtml);
        }
    });
    
    // Host disconnected
    socket.on('host-disconnected', () => {
        showError('Host disconnected. Returning to home...');
        setTimeout(() => {
            showHomeView();
        }, 3000);
    });
}

// Utility functions
function showError(message) {
    const errorDiv = $('#error-message, #error-display');
    const errorText = $('#error-text');
    
    if (errorText.length) {
        errorText.text(message);
        $('#error-display').removeClass('hidden');
    } else {
        errorDiv.text(message);
        errorDiv.removeClass('hidden');
    }
    
    setTimeout(() => {
        errorDiv.addClass('hidden');
        $('#error-display').addClass('hidden');
    }, 5000);
}

function renderMathJax(selector) {
    // Wait a bit for DOM to update, then render MathJax
    setTimeout(() => {
        if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([selector]).catch((err) => {
                console.error('MathJax rendering error:', err);
            });
        }
    }, 100);
}

function updatePointsDisplay() {
    $('#answer-status').html(`${currentPoints.toFixed(2)}/<span id="max-points">${maxPossiblePoints}</span> points`);
}

function updateLeaderboard(scores, maxPoints) {
    const leaderboardContent = $('#leaderboard-content');
    leaderboardContent.empty();
    $('#leaderboard').removeClass('hidden');
    
    const sortedEntries = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
    
    if (sortedEntries.length === 0) {
        leaderboardContent.html('<p class="text-gray-600">No players yet</p>');
        return;
    }
    
    sortedEntries.forEach(([playerId, data], index) => {
        const rank = index + 1;
        
        const entry = $(`
            <div class="flex items-center justify-between p-3 mb-2 bg-white rounded-lg">
                <div class="flex items-center gap-3">
                    <span class="font-bold text-lg" style="color: #000000;">#${rank}</span>
                    <span class="font-semibold" style="color: #000000;">${data.displayName}</span>
                </div>
                <span class="font-semibold" style="color: #000000;">${data.score.toFixed(2)}/${maxPoints} points</span>
            </div>
        `);
        leaderboardContent.append(entry);
    });
}

function triggerConfetti(color) {
    if (typeof confetti !== 'undefined') {
        const count = 200;
        const defaults = {
            origin: { y: 0.7 }
        };
        
        function fire(particleRatio, opts) {
            confetti({
                ...defaults,
                ...opts,
                particleCount: Math.floor(count * particleRatio),
                colors: [color]
            });
        }
        
        fire(0.25, {
            spread: 26,
            startVelocity: 55,
        });
        fire(0.2, {
            spread: 60,
        });
        fire(0.35, {
            spread: 100,
            decay: 0.91,
            scalar: 0.8
        });
        fire(0.1, {
            spread: 120,
            startVelocity: 25,
            decay: 0.92,
            scalar: 1.2
        });
        fire(0.1, {
            spread: 120,
            startVelocity: 45,
        });
    }
}
