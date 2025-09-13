const express = require('express');
const path = require('path');
const app = express();
const port = 8085;

// Serve static files from the React build directory
app.use(express.static(path.join(__dirname, 'dist')));

// Handles any requests that don't match the ones above
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});