const canvas = document.getElementById("gameCanvas");
let gameOver = false;
let leaderBoard = [];
// Fetch leaderboard on load
fetch('/api/leaderboard')
  .then(res => res.json())
  .then(data => { if(Array.isArray(data)) leaderBoard = data; });

let enteringName = false;
let showingLeaderBoard = false;
let leaderboardAnimationProgress = 0;
const nameInput = document.getElementById("nameInput");
let gameStarted = false;
let pulseValue = 0;
const ctx = canvas.getContext("2d");

// ground line position
let groundY = canvas.height - 150;

// target display size for the ghost (logical hitbox size)
const GHOST_W = 120;
const GHOST_H = 120;

const ghost = {
  x: 100,
  y: groundY - GHOST_H,
  width: GHOST_W,
  height: GHOST_H,
  velocityY: 0,
  jumping: false
};

const gravity = 0.4;
const jumpForce = -18;
let obstacles = [];
let gameSpeed = 5;
let score = 0;

// background video for start screen
const bgVideo = document.createElement("video");
bgVideo.src = "Assets/background animation 1.mp4";
bgVideo.loop = true;
bgVideo.muted = true;
bgVideo.playsInline = true;
bgVideo.load();
bgVideo.addEventListener("ended", () => { bgVideo.currentTime = 0; bgVideo.play(); });

// background video for gameplay
const gameBgVideo = document.createElement("video");
gameBgVideo.src = "Assets/game_background.mp4";
gameBgVideo.loop = true;
gameBgVideo.muted = true;
gameBgVideo.playsInline = true;
gameBgVideo.load();
gameBgVideo.addEventListener("ended", () => { gameBgVideo.currentTime = 0; gameBgVideo.play(); });

// gifData stores: { frames: [{cropped canvas}], delays, currentFrame, lastTime }
const gifData = {};

// find tight bounding box of non-transparent pixels in imageData
function getBounds(data, w, h) {
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX) return null; // blank frame
  return { minX, maxX, minY, maxY };
}

function loadGif(name, src) {
  return new Promise((resolve, reject) => {
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(buffer => {
        const reader = new GifReader(new Uint8Array(buffer));
        const fw = reader.width;
        const fh = reader.height;
        const frames = [];

        for (let i = 0; i < reader.numFrames(); i++) {
          const info = reader.frameInfo(i);
          const imgData = new ImageData(fw, fh);
          reader.decodeAndBlitFrameRGBA(i, imgData.data);

          // find tight crop of this frame
          const bounds = getBounds(imgData.data, fw, fh);
          if (!bounds) continue;

          const cw = bounds.maxX - bounds.minX + 1;
          const ch = bounds.maxY - bounds.minY + 1;

          // draw cropped region onto a small canvas
          const fc = document.createElement("canvas");
          fc.width = cw;
          fc.height = ch;
          const fctx = fc.getContext("2d");
          // put full frame, then crop by drawing offset
          const tmp = document.createElement("canvas");
          tmp.width = fw; tmp.height = fh;
          tmp.getContext("2d").putImageData(imgData, 0, 0);
          fctx.drawImage(tmp, bounds.minX, bounds.minY, cw, ch, 0, 0, cw, ch);

          frames.push({ canvas: fc, delay: (info.delay || 10) * 10 });
        }

        gifData[name] = { frames, currentFrame: 0, lastTime: 0 };
        resolve();
      })
      .catch(reject);
  });
}

function updateGifs(timestamp) {
  for (const name in gifData) {
    const g = gifData[name];
    if (g.frames.length === 0) continue;
    if (!g.lastTime) g.lastTime = timestamp;
    if (timestamp - g.lastTime >= g.frames[g.currentFrame].delay) {
      g.lastTime = timestamp;
      g.currentFrame = (g.currentFrame + 1) % g.frames.length;
    }
  }
}

function getGifFrame(name) {
  const g = gifData[name];
  if (!g || g.frames.length === 0) return null;
  return g.frames[g.currentFrame].canvas;
}

async function loadAssets() {
  await Promise.all([
    loadGif("ghost",       "Assets/ghostgifani.gif"),
    loadGif("enemy",       "Assets/enemyghost 1 gif ani.gif"),
    loadGif("randomghost", "Assets/random ghost gif.gif"),
    loadGif("bunny",       "Assets/bunny ani gif.gif"),
    loadGif("squirrel",    "Assets/squirl gift .gif"),
  ]);
}

function spawnObstacle() {
  const types = ["enemy", "randomghost", "bunny", "squirrel"];
  const type = types[Math.floor(Math.random() * types.length)];
  const h = Math.floor(Math.random() * 30) + 100; // 100–130px
  const w = Math.floor(Math.random() * 30) + 100; // 100–130px
  obstacles.push({
    x: canvas.width,
    y: groundY - h,   // bottom sits on ground line
    width: w,
    height: h,
    imageType: type
  });
}

function autoJump() {
  if (ghost.jumping) return;
  // Find closest upcoming obstacle
  const upcoming = obstacles.find(o => o.x + o.width > ghost.x);
  if (upcoming) {
    // Jump slightly before it
    if (upcoming.x - (ghost.x + ghost.width) < 180) {
      jump(jumpForce, true);
    }
  }
}

function jump(force, isAuto = false) {
  const f = force || jumpForce;
  if (showingLeaderBoard) { if(!isAuto){ showingLeaderBoard = false; resetGame(); } return; }
  if (enteringName) return;
  if (!gameStarted) { 
    if(!isAuto) {
      gameStarted = true; resetGame(); return; 
    }
  }
  if (gameOver) {
    if(!isAuto) {
      if (checkTopFive()) { enteringName = true; }
      else { showingLeaderBoard = true; leaderboardAnimationProgress = 0; }
    }
    return;
  }
  if (!ghost.jumping) { ghost.velocityY = f; ghost.jumping = true; }
}

function reportActivity() {
  window.parent.postMessage({ type: "ghost-runner:activity" }, window.location.origin);
}

document.addEventListener("keydown", e => {
  reportActivity();
  if (e.code === "Space") jump();
});
canvas.addEventListener("touchstart", () => {
  reportActivity();
  jump();
});
canvas.addEventListener("mousedown", () => {
  reportActivity();
  jump();
});

window.addEventListener("message", event => {
  if (
    event.origin !== window.location.origin ||
    event.data?.type !== "ghost-runner:reset"
  ) {
    return;
  }

  gameStarted = false;
  enteringName = false;
  showingLeaderBoard = false;
  leaderboardAnimationProgress = 0;
  nameInput.value = "";
  nameInput.style.display = "none";
  resetGame();
});

// ── Hand Gesture Control ──────────────────────────────────────────────
let handY = null;        // last known hand y (0–1, top=0)
let prevHandY = null;    // previous frame hand y

// set up webcam + MediaPipe Hands
const webcamVideo = document.createElement("video");
webcamVideo.width = 320; webcamVideo.height = 240;
webcamVideo.autoplay = true; webcamVideo.playsInline = true;

// load MediaPipe Hands
const handsModel = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}`
});
handsModel.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
handsModel.onResults(results => {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const wrist = results.multiHandLandmarks[0][0];
    prevHandY = handY;
    handY = wrist.y;

    if (prevHandY !== null) {
      const dy = prevHandY - handY;
      if (dy > 0.03 && gameStarted && !gameOver && !ghost.jumping) {
        const force = -(14 + Math.min(dy * 80, 4));
        reportActivity();
        jump(force);
      }
    }
  }
});

let cameraActive = false;
let gameStream = null;

function acquireCamera() {
  if (cameraActive) return;

  // Attract-mode copy: this build only ever plays itself behind the START overlay
  // on the home screen, so it never needs hand tracking. Skipping the camera keeps
  // the device free for the card and collage flows. The fullscreen build
  // (game.js) still acquires it normally.
  return;

  navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } }).then(stream => {
    gameStream = stream;
    webcamVideo.srcObject = stream;
    webcamVideo.play();
    cameraActive = true;
    console.log("Game camera acquired");
    requestAnimationFrame(processVideoFrame);
  }).catch(e => {
    console.warn("Camera busy, retrying in 2s:", e.message);
    setTimeout(acquireCamera, 2000);
  });
}

window.addEventListener('unload', () => {
  if (gameStream) {
    gameStream.getTracks().forEach(track => track.stop());
  }
});

async function processVideoFrame() {
  if (!cameraActive) return;
  if (webcamVideo.readyState >= 2) {
    await handsModel.send({ image: webcamVideo });
  }
  requestAnimationFrame(processVideoFrame);
}

acquireCamera();

nameInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    let name = nameInput.value.trim() || "Anonymous";
    saveScore(name);
    nameInput.value = "";
    nameInput.style.display = "none";
    enteringName = false;
    showingLeaderBoard = true;
    leaderboardAnimationProgress = 0;
  }
});

// draw a GIF character cropped tightly, sitting exactly on groundY
function drawSprite(name, x, y, w, h) {
  const frame = getGifFrame(name);
  if (frame) {
    // frame is already tightly cropped — draw it scaled to w×h, bottom at y+h
    ctx.drawImage(frame, x, y, w, h);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, w, h);
  }
}

function drawGhost() {
  drawSprite("ghost", ghost.x, ghost.y, ghost.width, ghost.height);
}

function drawGround() {
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(canvas.width, groundY);
  ctx.stroke();
}

function drawObstacles() {
  for (let o of obstacles) {
    drawSprite(o.imageType, o.x, o.y, o.width, o.height);
  }
}

function collision() {
  if (!gameStarted || gameOver || enteringName || showingLeaderBoard) return;
  // use 60% of width (centered) and 80% of height (from bottom) as hitbox
  const gx = ghost.x + ghost.width * 0.2;
  const gy = ghost.y + ghost.height * 0.2;
  const gw = ghost.width * 0.6;
  const gh = ghost.height * 0.8;

  for (let obs of obstacles) {
    const ox = obs.x + obs.width * 0.2;
    const oy = obs.y + obs.height * 0.2;
    const ow = obs.width * 0.6;
    const oh = obs.height * 0.8;
    if (gx < ox + ow && gx + gw > ox && gy < oy + oh && gy + gh > oy) {
      gameOver = true;
    }
  }
}

function updateGhost() {
  ghost.velocityY += gravity;
  ghost.y += ghost.velocityY;
  if (ghost.y >= groundY - ghost.height) {
    ghost.y = groundY - ghost.height;
    ghost.velocityY = 0;
    ghost.jumping = false;
  }
}

function updateObstacles() {
  for (let o of obstacles) o.x -= gameSpeed;
  if (obstacles.length > 0 && obstacles[0].x + obstacles[0].width < 0) {
    obstacles.shift();
    score++;
  }
  const last = obstacles[obstacles.length - 1];
  if (obstacles.length === 0 || last.x < canvas.width - 550) spawnObstacle();
}

function updateScore() {
  gameSpeed = 4 + Math.floor(score / 10);
}

function drawScore() {
  ctx.fillStyle = "#ffffff";
  ctx.font = "32px Arial";
  ctx.fillText("Score: " + score, 30, 50);
}

function drawGameOver() {
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 64px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Game Over", canvas.width / 2, canvas.height / 2 - 30);
  ctx.font = "32px Arial";
  ctx.fillText("Score: " + score, canvas.width / 2, canvas.height / 2 + 30);
  ctx.font = "24px Arial";
  ctx.fillText("Tap to Continue", canvas.width / 2, canvas.height / 2 + 80);
  ctx.textAlign = "left";
}

function drawleaderBoard() {
  ctx.fillStyle = "#0a0a1a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Leaderboard", canvas.width / 2, 100);
  for (let i = 0; i < leaderBoard.length; i++) {
    let ep = leaderboardAnimationProgress - i * 20;
    if (ep <= 0) continue;
    let alpha = Math.min(1, ep / 20);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(canvas.width / 2 - 350, 150 + i * 90, 700, 70);
    ctx.fillStyle = `rgba(255,215,0,${alpha})`;
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "left";
    ctx.fillText((i + 1) + ".", canvas.width / 2 - 320, 197 + i * 90);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.font = "32px Arial";
    ctx.fillText(leaderBoard[i].name, canvas.width / 2 - 270, 197 + i * 90);
    ctx.textAlign = "right";
    ctx.fillText("Score: " + leaderBoard[i].score, canvas.width / 2 + 320, 197 + i * 90);
  }
  let ba = Math.min(1, (leaderboardAnimationProgress - 100) / 20);
  if (ba > 0) {
    ctx.fillStyle = `rgba(255,255,255,${ba})`;
    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Press Space or Tap to Play Again", canvas.width / 2, canvas.height - 60);
  }
  ctx.textAlign = "left";
  leaderboardAnimationProgress++;
}

function drawNameInput() {
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px Arial";
  ctx.textAlign = "center";
  ctx.fillText("You made the Top 5!", canvas.width / 2, canvas.height / 2 - 100);
  ctx.font = "28px Arial";
  ctx.fillText("Enter your name and press Enter:", canvas.width / 2, canvas.height / 2 - 40);
  ctx.textAlign = "left";
  if (nameInput.style.display !== "block") {
    nameInput.style.display = "block";
    nameInput.focus();
  }
}

function drawStartScreen() {
  // dark overlay to dim the auto-playing game
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // START GAME button
  ctx.fillStyle = "rgba(224, 86, 26, 0.9)"; // Matches Booth orange
  let bw = 320; let bh = 80;
  let bx = canvas.width / 2 - bw / 2;
  let by = canvas.height / 2 - bh / 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 20);
  ctx.fill();
  
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Arial";
  ctx.textAlign = "center";
  ctx.fillText("START GAME", canvas.width / 2, canvas.height / 2 + 10);

  ctx.textAlign = "left";
}

function resetGame() {
  ghost.y = groundY - ghost.height;
  ghost.velocityY = 0;
  ghost.jumping = false;
  obstacles = [];
  score = 0;
  gameSpeed = 5;
  gameOver = false;
  spawnObstacle();
}

function checkTopFive() {
  return leaderBoard.length < 5 || score > leaderBoard[leaderBoard.length - 1].score;
}

function saveScore(name) {
  leaderBoard.push({ name, score });
  leaderBoard.sort((a, b) => b.score - a.score);
  if (leaderBoard.length > 5) leaderBoard = leaderBoard.slice(0, 5);
  
  // Persist to API
  fetch('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leaderBoard)
  }).catch(console.error);
}

// draw the game background video, falling back to dark fill
function drawGameBackground() {
  if (gameBgVideo.readyState >= 2) {
    if (gameBgVideo.paused) gameBgVideo.play();
    ctx.drawImage(gameBgVideo, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function gameLoop(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateGifs(timestamp);
  
  if (enteringName) {
    drawGameBackground();
    drawGround(); drawGhost(); drawObstacles(); drawScore(); drawNameInput();
  } else if (showingLeaderBoard) {
    drawleaderBoard();
  } else if (gameOver) {
    drawGameBackground();
    drawGround(); drawGhost(); drawObstacles(); drawScore(); drawGameOver();
  } else if (!gameStarted) {
    // Attract Mode
    autoJump();
    drawGameBackground();
    updateGhost(); updateObstacles();
    drawGround(); drawGhost(); drawObstacles();
    drawStartScreen();
  } else {
    // Normal Gameplay
    drawGameBackground();
    updateGhost(); updateObstacles(); updateScore(); collision();
    drawGround(); drawGhost(); drawObstacles(); drawScore();
  }
  requestAnimationFrame(gameLoop);
}

loadAssets().then(() => {
  spawnObstacle();
  gameLoop();
});
