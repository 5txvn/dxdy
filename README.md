# Calc Bowl - Multiplayer Calculus Practice

A multiplayer web application for practicing calculus problems, similar to Kahoot. One user acts as a host and controls the game flow, while other players join using a room code and answer questions.

## Features

- Host creates rooms with a 4-digit room code
- Players join rooms using the room code and a display name
- Host selects from available test files
- Host controls when questions advance
- Players answer multiple-choice questions
- Math rendering using MathJax
- Real-time updates using Socket.IO

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Plain HTML with EJS templates, jQuery
- **Styling**: Tailwind CSS (via CDN)
- **Math Rendering**: MathJax (via CDN)
- **No database**: All state is stored in memory

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Project Structure

```
calc-bowl/
├── package.json          # Dependencies and scripts
├── server.js             # Express server and Socket.IO logic
├── views/                # EJS templates
│   ├── index.ejs        # Landing page
│   ├── host.ejs         # Host room creation page
│   ├── join.ejs         # Player join page
│   └── room.ejs         # Game room (host and player views)
├── public/              # Static assets
│   └── js/
│       └── client.js    # Frontend Socket.IO communication
└── tests/               # Test JSON files
    └── sample-test.json # Sample calculus test
```

## Adding Tests

Add new test JSON files to the `tests/` directory. Each test file should follow this structure:

```json
{
  "metadata": {
    "id": "unique-test-id",
    "name": "Test Name",
    "year": "2024",
    "competition": "Competition Name",
    "difficulty": "Difficulty Level",
    "numberOfQuestions": 10,
    "timePerQuestion": 120
  },
  "questions": [
    {
      "question": "LaTeX formatted question",
      "choices": {
        "a": "LaTeX choice A",
        "b": "LaTeX choice B",
        "c": "LaTeX choice C",
        "d": "LaTeX choice D",
        "e": "LaTeX choice E"
      },
      "answer": "a",
      "explanation": "Optional explanation"
    }
  ]
}
```

## Usage

1. **Host a Room**:
   - Click "Host a Room" on the landing page
   - Select a test from the dropdown
   - Click "Launch Room"
   - Share the 4-digit room code with players

2. **Join a Room**:
   - Click "Join a Room" on the landing page
   - Enter the 4-digit room code
   - Enter your display name
   - Click "Join Room"

3. **Playing the Game**:
   - Host clicks "Start Game" to begin
   - Questions are displayed to all players
   - Players select their answers
   - Host clicks "Next Question" to advance
   - Host can end the game at any time

## Notes

- All room state is stored in memory and will be lost when the server restarts
- No authentication is implemented
- Socket connections are managed automatically
- MathJax renders LaTeX math expressions in questions and answers
