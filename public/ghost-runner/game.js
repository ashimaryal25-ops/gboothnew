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
let handBobPulse = 0;
let handSteerPulse = 0;
const ctx = canvas.getContext("2d");

// ground line position
const groundY = canvas.height - 150;

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

let currentLevel = 1;
let lvl2GraceTimer = 0;

// Pre-level instruction overlay: shown for INSTRUCTIONS_DURATION frames before
// level 1 starts (after the initial tap) and again before level 2 starts (after
// clearing level 1). Purely timer-driven so it works unattended on a kiosk.
let showingInstructions = false;
let instructionsLevel = 1;
let instructionsTimer = 0;
const INSTRUCTIONS_DURATION = 480; // 8 seconds at 60fps

// "Skip" button shown on the instructions screen, top-left so it never
// overlaps the camera HUD (which lives top-right). Lets repeat players
// who already know the controls jump straight past the 8-second wait.
const SKIP_BTN = { x: 30, y: 30, w: 150, h: 56 };

const startMusic = new Audio("Assets/start_sound.wav");
startMusic.loop = true;
startMusic.volume = 0.2;
startMusic.muted = true;

const hitSound = new Audio("Assets/Obstacle_hitting_sound.mp3");
hitSound.volume = 1.0;
hitSound.muted = true;

const jumpSound = new Audio("Assets/jump.wav");
jumpSound.muted = true;

let audioUnlocked = false;

const score20Sound = new Audio("Assets/Score_20.mp3");
score20Sound.muted = true;

const lvl2BgSound = new Audio("Assets/lvl2_bgsound.wav");
lvl2BgSound.loop = true;
lvl2BgSound.volume = 0.2;
lvl2BgSound.muted = true;
let score20Played = false;

// background video for start screen
const bgVideo = document.createElement("video");
bgVideo.src = "Assets/background animation 1.mp4";
bgVideo.loop = true;
bgVideo.muted = true;
bgVideo.playsInline = true;
bgVideo.load();
bgVideo.addEventListener("ended", function() { bgVideo.currentTime = 0; bgVideo.play(); });

// background video for gameplay
const gameBgVideo = document.createElement("video");
const lvl2BgVideo = document.createElement("video");

lvl2BgVideo.src = "Assets/background_lvl2.mp4";
lvl2BgVideo.loop = true;
lvl2BgVideo.muted = true;
lvl2BgVideo.playsInline = true;
lvl2BgVideo.load();
gameBgVideo.src = "Assets/game_background.mp4";
gameBgVideo.loop = true;
gameBgVideo.muted = true;
gameBgVideo.playsInline = true;
gameBgVideo.load();
gameBgVideo.addEventListener("ended", function() { gameBgVideo.currentTime = 0; gameBgVideo.play(); });

// gifData stores: { frames: [{cropped canvas}], delays, currentFrame, lastTime }
const gifData = {};

const handPoseImg = new Image();
handPoseImg.src = "Assets/hand_pose_jump.png";

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
  if (minX > maxX) return null;
  return { minX, maxX, minY, maxY };
}

function loadGif(name, src) {
  return new Promise(function(resolve, reject) {
    fetch(src)
      .then(function(r) { return r.arrayBuffer(); })
      .then(function(buffer) {
        const reader = new GifReader(new Uint8Array(buffer));
        const fw = reader.width;
        const fh = reader.height;
        const frames = [];
        for (let i = 0; i < reader.numFrames(); i++) {
          const info = reader.frameInfo(i);
          const imgData = new ImageData(fw, fh);
          reader.decodeAndBlitFrameRGBA(i, imgData.data);
          const bounds = getBounds(imgData.data, fw, fh);
          if (!bounds) continue;
          const cw = bounds.maxX - bounds.minX + 1;
          const ch = bounds.maxY - bounds.minY + 1;
          const fc = document.createElement("canvas");
          fc.width = cw;
          fc.height = ch;
          const fctx = fc.getContext("2d");
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
    loadGif("lvl2enemy",   "Assets/lvl2_enemy.gif"),
    loadGif("lvl2enemy2",  "Assets/lvl2_enemy2.gif"),
  ]);
}

function spawnObstacle() {
  const types = ["enemy", "randomghost", "bunny", "squirrel"];
  const type = types[Math.floor(Math.random() * types.length)];
  const h = Math.floor(Math.random() * 30) + 100;
  const w = Math.floor(Math.random() * 30) + 100;
  obstacles.push({
    x: canvas.width,
    y: groundY - h,
    width: w,
    height: h,
    imageType: type,
    scored: false,
    dodged: false,
    direction: "right"
  });
}

// BUG FIX 1: spawnObstacleLvl2 was always setting y: -h regardless of direction
// Now x and y are correctly set based on direction
// BUG FIX 4: left/right obstacles were spawning only near the top of the screen
// because the "-150" buffer was subtracted from the whole random range instead
// of being used as a small floor offset. Now obstacles use the full vertical
// space above the ground line, with a small 20px buffer so they never spawn
// touching the ground line itself.
function spawnObstacleLvl2() {
  const types = ["lvl2enemy", "lvl2enemy2", "enemy", "randomghost", "bunny", "squirrel"];
  const type = types[Math.floor(Math.random() * types.length)];
  const w = 120;
  const h = 120;
  const directionPick = Math.floor(Math.random() * 3);
  let direction = "";
  let x = 0;
  let y = 0;
  if (directionPick === 0) {
    direction = "top";
    x = Math.floor(Math.random() * (canvas.width - w));
    y = -h;
  } else if (directionPick === 1) {
    direction = "left";
    x = -w;
    y = groundY - h;
    for (let i = 0; i < obstacles.length; i++) {
      if (obstacles[i].direction === "left" && obstacles[i].x < 150) {
        return;
      }
    }
  } else {
    direction = "right";
    x = canvas.width;
    y = groundY - h;
    for (let i = 0; i < obstacles.length; i++) {
      if (obstacles[i].direction === "right" && obstacles[i].x > canvas.width - 150) {
        return;
      }
    }
  }
  obstacles.push({
    x: x,
    y: y,
    width: w,
    height: h,
    imageType: type,
    direction: direction,
    scored: false,
    dodged: false,
    minDistance: Infinity
  });
}

function reportActivity() {
  if (window.parent && window.parent.postMessage) {
    window.parent.postMessage({ type: "ghost-runner:activity" }, window.location.origin);
  }
}

function jump(force, isAuto = false) {
  // instructions are timer-driven only - ignore taps/space/hand-gestures while showing
  if (showingInstructions) return;

  if (!isAuto && !audioUnlocked) {
    audioUnlocked = true;
    startMusic.muted = false;
    lvl2BgSound.muted = false;
    hitSound.muted = false;
    jumpSound.muted = false;
    score20Sound.muted = false;
    hitSound.play().then(function() { hitSound.pause(); }).catch(function() {});
    jumpSound.play().then(function() { jumpSound.pause(); }).catch(function() {});
    score20Sound.play().then(function() { score20Sound.pause(); }).catch(function() {});
    lvl2BgSound.play().then(function() { lvl2BgSound.pause(); }).catch(function() {});
  }
  
  if (showingLeaderBoard) { if(!isAuto){ showingLeaderBoard = false; resetGame(); } return; }
  if (enteringName) return;

  if (gameOver) {
    if(!isAuto) resetGame();
    return;
  }
  
  if (!gameStarted) {
    if(!isAuto){
      showingInstructions = true;
      instructionsLevel = 1;
      instructionsTimer = INSTRUCTIONS_DURATION;
    }
    return;
  }
  
  let f = force || jumpForce;
  if (!ghost.jumping) {
      if(!isAuto) reportActivity();
      ghost.velocityY = f;
      ghost.jumping = true;
    }
}

document.addEventListener("keydown", function(e) { if (e.code === "Space") { reportActivity(); jump(); } });

window.addEventListener("message", e => {
  if (e.data && e.data.type === "ghost-runner:reset") {
    resetGame();
  } else if (e.data && e.data.type === "ghost-runner:unmute") {
    audioUnlocked = true; // assume unlocked by user tap in BoothApp
    startMusic.muted = false;
    lvl2BgSound.muted = false;
    hitSound.muted = false;
    jumpSound.muted = false;
    score20Sound.muted = false;
  } else if (e.data && e.data.type === "ghost-runner:mute") {
    startMusic.muted = true;
    lvl2BgSound.muted = true;
    hitSound.muted = true;
    jumpSound.muted = true;
    score20Sound.muted = true;
  }
});

// DEBUG: press "2" to jump straight into Level 2 for testing.
// Remove this block once Level 2 testing is done.
document.addEventListener("keydown", function(e) {
  if (e.key === "2" && !enteringName) {
    showingInstructions = false;
    gameStarted = true;
    gameOver = false;
    enteringName = false;
    showingLeaderBoard = false;
    currentLevel = 2;
    score20Played = true;
    obstacles = [];
    score = 0;
    gameSpeed = 5;
    lvl2GraceTimer = 90;
    handXHistory = [];
    ghost.x = canvas.width / 2 - ghost.width / 2;
    ghost.y = groundY - ghost.height;
    ghost.velocityY = 0;
    ghost.jumping = false;
    bgVideo.pause();
    gameBgVideo.pause();
    startMusic.pause();
    startMusic.currentTime = 0;
    score20Sound.pause();
    score20Sound.currentTime = 0;
    lvl2BgVideo.currentTime = 0;
    lvl2BgVideo.play();
    lvl2BgSound.currentTime = 0;
    lvl2BgSound.play();
  }
});
// Converts a raw pointer event position into canvas-internal coordinates,
// accounting for the canvas being displayed at a different size than its
// internal resolution (it's scaled to fit the page via CSS).
function getCanvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

canvas.addEventListener("touchstart", function(e) {
  reportActivity();
  const touch = e.touches && e.touches[0];
  if (touch && showingInstructions) {
    const pos = getCanvasPos(touch.clientX, touch.clientY);
    if (pointInRect(pos.x, pos.y, SKIP_BTN)) {
      finishInstructions();
      return;
    }
  }
  jump();
});
canvas.addEventListener("mousedown", function(e) {
  reportActivity();
  if (showingInstructions) {
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (pointInRect(pos.x, pos.y, SKIP_BTN)) {
      finishInstructions();
      return;
    }
  }
  jump();
});

let handY = null;
let handX = null;
let prevHandY = null;
let handXHistory = [];
// Shorter averaging window = less lag in level 2 steering. Palm-center tracking
// (wrist + middle-finger-base averaged below) already cancels most raw jitter,
// so we don't need a long window to stay smooth.
const HAND_X_HISTORY_SIZE = 3;
let framesSinceHandSeen = 0;

const webcamVideo = document.createElement("video");
webcamVideo.width = 640; webcamVideo.height = 480;
webcamVideo.autoplay = true; webcamVideo.playsInline = true;

let gameStream = null;
let cameraActive = false;
let fallbackCameraAttempts = 0;
let lastCamError = "";

// --- Live frames from the booth mirror ------------------------------------
// On the kiosk the single webcam is owned by camera-mirror.html, so the game
// cannot open it directly (NotReadableError: Device in use). The mirror instead
// streams us small raw frames over BroadcastChannel and we feed those to MediaPipe.
// This is preferred over getUserMedia; the direct-camera path below is only a
// fallback for laptops/dev machines where no mirror is running.
const mirrorImg = new Image();
let mirrorImgReady = false;
mirrorImg.onload = function() { mirrorImgReady = true; };
let lastMirrorFrameAt = 0;
let mirrorFrameCount = 0;
function mirrorFramesLive() {
  return performance.now() - lastMirrorFrameAt < 1500;
}

function onMirrorFrame(dataUrl) {
  lastMirrorFrameAt = performance.now();
  mirrorFrameCount++;
  cameraActive = true;
  lastCamError = "";
  mirrorImg.src = dataUrl;
}

const handsCh = (typeof BroadcastChannel !== "undefined")
  ? new BroadcastChannel("cardifybooth-mirror")
  : null;
if (handsCh) {
  handsCh.onmessage = function(e) {
    const d = e.data || {};
    if (d.type === "hands-frame" && d.dataUrl) onMirrorFrame(d.dataUrl);
  };
}

// Ask the mirror to stream over BOTH transports (the game window may only be able to
// reach the mirror over one of them), and keep asking so it auto-stops when we leave.
function pingMirror() {
  if (handsCh) handsCh.postMessage({ type: "hands-stream-start" });
  fetch("/api/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "mirror", type: "hands-stream-start" }),
  }).catch(function() {});
}
pingMirror();
setInterval(pingMirror, 1000);
window.addEventListener("unload", function() {
  if (handsCh) handsCh.postMessage({ type: "hands-stream-stop" });
  fetch("/api/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "mirror", type: "hands-stream-stop" }),
    keepalive: true,
  }).catch(function() {});
});

// Relay fallback: poll for frames the mirror pushed through /api/mirror. This is the
// path that works when the mirror runs in a different browser/instance than the game
// (BroadcastChannel can't cross that boundary, but the server relay can).
let handsRelaySince = 0;
async function pollHandsRelay() {
  try {
    const r = await fetch("/api/mirror?role=kiosk&since=" + handsRelaySince, { cache: "no-store" });
    const data = await r.json();
    const events = (data && data.events) || [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.id) handsRelaySince = Math.max(handsRelaySince, ev.id);
      if (ev.type === "hands-frame" && ev.dataUrl) onMirrorFrame(ev.dataUrl);
    }
  } catch (e) {}
  setTimeout(pollHandsRelay, 100);
}
pollHandsRelay();

/** The image MediaPipe/HUD should read this frame, or null if nothing is ready. */
function activeFrameSource() {
  if (mirrorFramesLive()) {
    return (mirrorImgReady && mirrorImg.naturalWidth) ? mirrorImg : null;
  }
  if (webcamVideo.readyState >= 2 && webcamVideo.videoWidth) return webcamVideo;
  return null;
}

function acquireCamera() {
  if (cameraActive) return;

  // Prefer mirror frames; don't fight the mirror for the physical device.
  if (mirrorFramesLive()) { cameraActive = true; return; }

  if (window.parent && window.parent.__boothCamera && window.parent.__boothCamera.stream) {
    gameStream = window.parent.__boothCamera.stream;
    webcamVideo.srcObject = gameStream;
    webcamVideo.play().catch(function(e) {});
    cameraActive = true;
    console.log("Using shared booth camera");
    return;
  }

  fallbackCameraAttempts++;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn("navigator.mediaDevices.getUserMedia is not supported (likely HTTP). Camera disabled.");
    return;
  }

  // Loose constraints on purpose: laptop webcams reject exact sizes with
  // OverconstrainedError, which reads as a dead camera.
  navigator.mediaDevices.getUserMedia({ video: true }).then(function(stream) {
    gameStream = stream;
    webcamVideo.srcObject = stream;
    webcamVideo.play().catch(function(e) {});
    cameraActive = true;
    console.log("Game fallback camera acquired");
  }).catch(function(e) {
    lastCamError = e.name || "error";
    console.warn("Camera unavailable (" + e.name + "): " + e.message);
    // Keep retrying indefinitely: on the booth the mirror holds the camera and may
    // release it later, so giving up after a few tries strands the game camera-less.
    setTimeout(acquireCamera, 2000);
  });
}

window.addEventListener('unload', function() {
  if (gameStream && (!window.parent || !window.parent.__boothCamera || gameStream !== window.parent.__boothCamera.stream)) {
    gameStream.getTracks().forEach(function(track) { track.stop(); });
  }
});

// Give the mirror ~1.2s to start streaming before trying to grab the camera
// directly (which fails on the kiosk and only matters on a mirror-less laptop).
setTimeout(function() { if (!mirrorFramesLive()) acquireCamera(); }, 1200);

const handsModel = new window.Hands({
  locateFile: function(f) { return "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/" + f; }
});
handsModel.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
handsModel.onResults(function(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    framesSinceHandSeen = 0;
    const wrist = results.multiHandLandmarks[0][0];
    const palmBase = results.multiHandLandmarks[0][9];
    const rawHandX = (wrist.x + palmBase.x) / 2;
    const rawHandY = (wrist.y + palmBase.y) / 2;

    // moving average over recent readings actually cancels out noise
    // (rate-limiting alone only caps speed, it doesn't stop shaking)
    handXHistory.push(rawHandX);
    if (handXHistory.length > HAND_X_HISTORY_SIZE) {
      handXHistory.shift();
    }
    let sumX = 0;
    for (let i = 0; i < handXHistory.length; i++) {
      sumX += handXHistory[i];
    }
    handX = sumX / handXHistory.length;

    // light smoothing on Y so single noisy frames don't falsely register as a jump gesture
    prevHandY = handY;
    if (handY === null) {
      handY = rawHandY;
    } else {
      handY = handY + (rawHandY - handY) * 0.4;
    }

    if (prevHandY !== null) {
      const dy = prevHandY - handY;
      if (dy > 0.03 && gameStarted && !gameOver && !ghost.jumping && !showingInstructions) {
        reportActivity();
        jump(jumpForce);
      }
    }
  } else {
    framesSinceHandSeen++;
    if (framesSinceHandSeen > 25) {
      handXHistory = [];
      handX = null;
      handY = null;
      prevHandY = null;
    }
  }
});

// Drive hand tracking off the stream acquireCamera() already set up. MediaPipe's
// Camera util opens its OWN getUserMedia and ignores webcamVideo.srcObject, which
// on a single-consumer webcam throws NotReadableError ("Device in use") because the
// booth/mirror already holds the device. A manual rAF loop reuses the one stream.
let handsBusy = false;
async function pumpHands() {
  const src = activeFrameSource();
  if (src && !handsBusy) {
    handsBusy = true;
    try {
      await handsModel.send({ image: src });
    } catch (e) {}
    handsBusy = false;
  }
  requestAnimationFrame(pumpHands);
}
requestAnimationFrame(pumpHands);

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

function drawSprite(name, x, y, w, h) {
  const frame = getGifFrame(name);
  if (frame) {
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
  for (let i = 0; i < obstacles.length; i++) {
    let o = obstacles[i];
    drawSprite(o.imageType, o.x, o.y, o.width, o.height);
  }
}

function collision() {
  if (!gameStarted || gameOver || enteringName || showingLeaderBoard) return;
  if (lvl2GraceTimer > 0) return;
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
      hitSound.currentTime = 0;
      hitSound.play();
    }
  }
}

function updateGhost() {
  if (currentLevel === 2) {
    if (handX !== null) {
      const targetX = (1 - handX) * canvas.width - ghost.width / 2;
      if (Math.abs(targetX - ghost.x) > 1) {
        ghost.x = targetX;
      }
    }
    if (ghost.x < 0) { ghost.x = 0; }
    if (ghost.x + ghost.width > canvas.width) { ghost.x = canvas.width - ghost.width; }
  }
  ghost.velocityY += gravity;
  ghost.y += ghost.velocityY;
  if (ghost.y >= groundY - ghost.height) {
    ghost.y = groundY - ghost.height;
    ghost.velocityY = 0;
    ghost.jumping = false;
  }
}

function updateObstacles() {
  if (currentLevel === 1) {
    for (let i = 0; i < obstacles.length; i++) {
      obstacles[i].x -= gameSpeed;
    }
    for (let i = 0; i < obstacles.length; i++) {
      if (!obstacles[i].scored && ghost.x > obstacles[i].x + obstacles[i].width) {
        obstacles[i].scored = true;
        jumpSound.currentTime = 0;
        jumpSound.play();
      }
    }
    if (obstacles.length > 0 && obstacles[0].x + obstacles[0].width < 0) {
      obstacles.shift();
      score++;
      if (score >= 10 && !score20Played) {
        score20Played = true;
        showingInstructions = true;
        instructionsLevel = 2;
        instructionsTimer = INSTRUCTIONS_DURATION;
        startMusic.pause();
        startMusic.currentTime = 0;
        score20Sound.play();
      }
    }
    const last = obstacles[obstacles.length - 1];
    if (obstacles.length === 0 || last.x < canvas.width - 550) {
      spawnObstacle();
    }
  } else {
    // move obstacles based on direction
    for (let i = 0; i < obstacles.length; i++) {
      if (obstacles[i].direction === "top") {
        obstacles[i].y += gameSpeed;
      } else if (obstacles[i].direction === "left") {
        obstacles[i].x += gameSpeed;
      } else if (obstacles[i].direction === "right") {
        obstacles[i].x -= gameSpeed;
      }
    }

    // track how close each obstacle came to the ghost, for the close-call bonus
    for (let i = 0; i < obstacles.length; i++) {
      let o = obstacles[i];
      if (o.dodged) continue;
      const ghostCenterX = ghost.x + ghost.width / 2;
      const ghostCenterY = ghost.y + ghost.height / 2;
      const obsCenterX = o.x + o.width / 2;
      const obsCenterY = o.y + o.height / 2;
      const dx = Math.abs(ghostCenterX - obsCenterX);
      const dy = Math.abs(ghostCenterY - obsCenterY);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < o.minDistance) {
        o.minDistance = distance;
      }
    }

    // BUG FIX 3: removal condition for "right" was wrong (o.x > o.width < 0 is nonsense)
    // scoring now happens here: if an obstacle safely leaves the screen without a
    // collision, it counts as dodged and awards points - no longer gated on being
    // close to the ghost at the exact instant it finished passing, since dodging by
    // moving away is just as valid as dodging by staying close.
    for (let i = obstacles.length - 1; i >= 0; i--) {
      let o = obstacles[i];
      let offScreen = false;
      if (o.direction === "top" && o.y > canvas.height + 50) {
        offScreen = true;
      } else if (o.direction === "left" && o.x > canvas.width + 50) {
        offScreen = true;
      } else if (o.direction === "right" && o.x + o.width < -50) {
        offScreen = true;
      }
      if (offScreen) {
        if (!o.dodged && !gameOver) {
          o.dodged = true;
          if (o.minDistance < 50) { score += 3; } else { score += 1; }
          jumpSound.currentTime = 0;
          jumpSound.play();
        }
        obstacles.splice(i, 1);
      }
    }

    // keep 3 obstacles on screen
    if (obstacles.length < 2) {
      spawnObstacleLvl2();
    }
  }
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
  ctx.fillText("Press Space to Continue", canvas.width / 2, canvas.height / 2 + 80);
  ctx.textAlign = "left";
}

// Pre-level instruction screen. Shown automatically (no input needed) for
// INSTRUCTIONS_DURATION frames before level 1 starts and again before level 2
// starts, so anyone walking up to the kiosk can read how to play.
function drawRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawInstructions() {
  ctx.fillStyle = "rgba(8,8,10,0.93)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";

  // running cursor - each element advances it by its own height plus a gap,
  // so nothing below can ever overlap something drawn above it
  let y = 190;

  if (instructionsLevel === 1) {
    ctx.font = "bold 60px Arial";
    ctx.fillText("Level 1: The Chase", canvas.width / 2, y);
    y += 90;

    const imgW = 200, imgH = 175;
    const imgX = canvas.width / 2 - imgW / 2;
    const imgY = y;
    handBobPulse += 0.06;
    const bobOffset = Math.sin(handBobPulse) * 22;
    if (handPoseImg.complete && handPoseImg.naturalWidth) {
      ctx.drawImage(handPoseImg, imgX, imgY + bobOffset, imgW, imgH);
    }

    // upward arrow to the right of the image, showing which way to move it
    ctx.strokeStyle = "#39FF14";
    ctx.fillStyle = "#39FF14";
    ctx.lineWidth = 6;
    const arrowX = imgX + imgW + 60;
    const arrowTopY = imgY + 10;
    const arrowBottomY = imgY + imgH - 10;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowBottomY);
    ctx.lineTo(arrowX, arrowTopY + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(arrowX - 18, arrowTopY + 30);
    ctx.lineTo(arrowX, arrowTopY);
    ctx.lineTo(arrowX + 18, arrowTopY + 30);
    ctx.closePath();
    ctx.fill();

    y = imgY + imgH + 45; // clear of the image (plus its bob range)

    ctx.fillStyle = "#ffffff";
    ctx.font = "26px Arial";
    ctx.fillText("Hold your hand like this, then raise it to jump", canvas.width / 2, y);
    y += 40;
    ctx.fillText("Obstacles come from the right \u2014 jump to clear them", canvas.width / 2, y);
    y += 40;
    ctx.fillText("Clear 10 to advance to Level 2", canvas.width / 2, y);
    y += 70;
  } else {
    ctx.font = "bold 60px Arial";
    ctx.fillText("Level 2: No Way Out", canvas.width / 2, y);
    y += 90;

    const imgW = 170, imgH = 149;
    const colLeftX = canvas.width / 2 - 260;
    const colRightX = canvas.width / 2 + 260;
    const rowImgY = y;

    // --- left column: jump demo, same as level 1 (hand bobs up/down) ---
    handBobPulse += 0.06;
    const bobOffsetY = Math.sin(handBobPulse) * 18;
    if (handPoseImg.complete && handPoseImg.naturalWidth) {
      ctx.drawImage(handPoseImg, colLeftX - imgW / 2, rowImgY + bobOffsetY, imgW, imgH);
    }
    ctx.strokeStyle = "#39FF14";
    ctx.fillStyle = "#39FF14";
    ctx.lineWidth = 5;
    const upArrowX = colLeftX + imgW / 2 + 45;
    const upArrowTop = rowImgY + 5;
    const upArrowBottom = rowImgY + imgH - 5;
    ctx.beginPath();
    ctx.moveTo(upArrowX, upArrowBottom);
    ctx.lineTo(upArrowX, upArrowTop + 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(upArrowX - 14, upArrowTop + 26);
    ctx.lineTo(upArrowX, upArrowTop);
    ctx.lineTo(upArrowX + 14, upArrowTop + 26);
    ctx.closePath();
    ctx.fill();

    // --- right column: steer demo (hand bobs left/right, double-headed arrow below) ---
    handSteerPulse += 0.06;
    const bobOffsetX = Math.sin(handSteerPulse) * 20;
    if (handPoseImg.complete && handPoseImg.naturalWidth) {
      ctx.drawImage(handPoseImg, colRightX - imgW / 2 + bobOffsetX, rowImgY, imgW, imgH);
    }
    const steerArrowY = rowImgY + imgH + 35;
    const steerArrowLeftX = colRightX - 55;
    const steerArrowRightX = colRightX + 55;
    ctx.beginPath();
    ctx.moveTo(steerArrowLeftX, steerArrowY);
    ctx.lineTo(steerArrowRightX, steerArrowY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(steerArrowLeftX + 16, steerArrowY - 12);
    ctx.lineTo(steerArrowLeftX, steerArrowY);
    ctx.lineTo(steerArrowLeftX + 16, steerArrowY + 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(steerArrowRightX - 16, steerArrowY - 12);
    ctx.lineTo(steerArrowRightX, steerArrowY);
    ctx.lineTo(steerArrowRightX - 16, steerArrowY + 12);
    ctx.stroke();

    y = rowImgY + imgH + 85; // clear both columns - the steer arrow (below its image) is the taller one

    ctx.fillStyle = "#ffffff";
    ctx.font = "22px Arial";
    ctx.fillText("Raise your hand to jump", colLeftX, y);
    ctx.fillText("Move your hand left & right to steer", colRightX, y);
    y += 50;

    ctx.font = "26px Arial";
    ctx.fillText("Obstacles fall from above and rush in from both sides", canvas.width / 2, y);
    y += 70;
  }

  let secondsLeft = Math.ceil(instructionsTimer / 60);
  ctx.font = "bold 40px Arial";
  ctx.fillText("Starting in " + secondsLeft + "...", canvas.width / 2, y);
  ctx.textAlign = "left";

  // Skip button - drawn last so it's always on top, same spot on both levels
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "#39FF14";
  ctx.lineWidth = 2;
  drawRoundRect(SKIP_BTN.x, SKIP_BTN.y, SKIP_BTN.w, SKIP_BTN.h, 10);
  ctx.fill();
  ctx.stroke();

  const iconCX = SKIP_BTN.x + 30;
  const iconCY = SKIP_BTN.y + SKIP_BTN.h / 2;
  ctx.fillStyle = "#39FF14";
  ctx.beginPath();
  ctx.moveTo(iconCX - 14, iconCY - 12);
  ctx.lineTo(iconCX - 14, iconCY + 12);
  ctx.lineTo(iconCX - 2, iconCY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(iconCX - 2, iconCY - 12);
  ctx.lineTo(iconCX - 2, iconCY + 12);
  ctx.lineTo(iconCX + 10, iconCY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "22px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Skip", SKIP_BTN.x + 60, iconCY + 8);
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
    ctx.fillStyle = "rgba(255,215,0," + alpha + ")";
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "left";
    ctx.fillText((i + 1) + ".", canvas.width / 2 - 320, 197 + i * 90);
    ctx.fillStyle = "rgba(255,255,255," + alpha + ")";
    ctx.font = "32px Arial";
    ctx.fillText(leaderBoard[i].name, canvas.width / 2 - 270, 197 + i * 90);
    ctx.textAlign = "right";
    ctx.fillText("Score: " + leaderBoard[i].score, canvas.width / 2 + 320, 197 + i * 90);
  }
  let ba = Math.min(1, (leaderboardAnimationProgress - 100) / 20);
  if (ba > 0) {
    ctx.fillStyle = "rgba(255,255,255," + ba + ")";
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
  nameInput.style.display = "block";
  nameInput.style.left = (canvas.offsetLeft + canvas.width / 2 - 150) + "px";
  nameInput.style.top = (canvas.offsetTop + canvas.height / 2) + "px";
  nameInput.style.width = "300px";
  nameInput.focus();
}


function drawStartScreen() {
  if (bgVideo.readyState >= 2) {
    if (bgVideo.paused) bgVideo.play();
    ctx.drawImage(bgVideo, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let floatOffset = Math.sin(pulseValue) * 15;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 80px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Ghost Runner", canvas.width / 2, canvas.height / 2 - 60 + floatOffset);
  pulseValue += 0.05;
  let alpha = (Math.sin(pulseValue) + 1) / 2;
  ctx.fillStyle = "rgba(255,255,255," + alpha + ")";
  ctx.font = "28px Arial";
  ctx.fillText("Tap to Start", canvas.width / 2, canvas.height / 2 + 20);
  ctx.textAlign = "left";
}

function resetGame() {
  showingLeaderBoard = false;
  leaderboardAnimationProgress = 0;
  enteringName = false;
  gameStarted = false;
  score20Played = false;
  currentLevel = 1;
  showingInstructions = false;
  instructionsTimer = 0;
  lvl2GraceTimer = 0;
  handXHistory = [];
  ghost.x = 100;
  ghost.y = groundY - ghost.height;
  ghost.velocityY = 0;
  ghost.jumping = false;
  obstacles = [];
  score = 0;
  gameSpeed = 5;
  gameOver = false;
  lvl2BgSound.pause();
  lvl2BgSound.currentTime = 0;
  lvl2BgVideo.pause();
  lvl2BgVideo.currentTime = 0;
  gameBgVideo.pause();
  gameBgVideo.currentTime = 0;
  startMusic.play().catch(function(e) {});
  bgVideo.currentTime = 0;
  bgVideo.play().catch(function(e) {});
  spawnObstacle();
}

function checkTopFive() {
  return leaderBoard.length < 5 || score > leaderBoard[leaderBoard.length - 1].score;
}

function saveScore(name) {
  leaderBoard.push({ name, score });
  leaderBoard.sort(function(a, b) { return b.score - a.score; });
  if (leaderBoard.length > 5) leaderBoard = leaderBoard.slice(0, 5);
}

function drawGameBackground() {
  if (gameBgVideo.readyState >= 2) {
    if (gameBgVideo.paused) gameBgVideo.play();
    ctx.drawImage(gameBgVideo, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#16213e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawLvl2Background() {
  if (lvl2BgVideo.readyState >= 2) {
    if (lvl2BgVideo.paused) lvl2BgVideo.play();
    ctx.drawImage(lvl2BgVideo, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// Ends the instructions screen and starts whatever comes next (level 1
// gameplay, or level 2 gameplay). Called both when the timer runs out and
// when the player taps the skip button - same exact transition either way.
function finishInstructions() {
  showingInstructions = false;
  if (instructionsLevel === 1) {
    gameStarted = true;
    score = 0;
    obstacles = [];
    spawnObstacle();
    bgVideo.pause();
    gameBgVideo.play();
    startMusic.play().catch(function(e) {});
  } else {
    currentLevel = 2;
    lvl2GraceTimer = 90;
    handXHistory = [];
    score20Sound.pause();
    score20Sound.currentTime = 0;
    lvl2BgSound.play();
    lvl2BgVideo.play();
    obstacles = [];
    score = 0;
  }
}

function gameLoop(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateGifs(timestamp);
  if (showingInstructions) {
    drawInstructions();
    instructionsTimer--;
    if (instructionsTimer <= 0) {
      finishInstructions();
    }
  } else if (!gameStarted) {
    drawStartScreen();
    drawGround();
  } else if (enteringName) {
    drawGameBackground();
    drawGround(); drawGhost(); drawObstacles(); drawScore(); drawNameInput();
  } else if (showingLeaderBoard) {
    drawleaderBoard();
  } else if (gameOver) {
    // Match the gameplay branch below: the freeze-frame keeps the level you died
    // on, otherwise Level 2 enemies sit frozen over the Level 1 background.
    if (currentLevel === 1) {
      drawGameBackground();
    } else {
      drawLvl2Background();
    }
    drawGround(); drawGhost(); drawObstacles(); drawScore(); drawGameOver();
  } else {
    if (currentLevel === 1) {
      drawGameBackground();
    } else {
      drawLvl2Background();
    }
    updateGhost();
    updateObstacles();
    updateScore();
    if (lvl2GraceTimer > 0) { lvl2GraceTimer--; }
    collision();
    drawGround();
    drawGhost();
    drawObstacles();
    drawScore();
  }
  drawCameraHUD();
  requestAnimationFrame(gameLoop);
}

// Small self-view so the player (and whoever is setting up the booth) can see at a
// glance whether the camera feed and hand tracking are alive. Green border = a hand
// is being tracked; the dot follows your hand. Set SHOW_CAM_HUD = false to hide it.
const SHOW_CAM_HUD = true;
function drawCameraHUD() {
  if (!SHOW_CAM_HUD) return;
  const w = 176, h = 132, pad = 16;
  const x = canvas.width - w - pad, y = pad;
  const handSeen = handX !== null && framesSinceHandSeen < 25;

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, w, h);

  const src = activeFrameSource();
  if (src) {
    // Mirror so it reads like a selfie, matching how handX is used in the game.
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    var msg = cameraActive ? "starting camera..." : "no camera";
    if (!cameraActive && lastCamError) msg += " (" + lastCamError + ")";
    ctx.fillText(msg, x + w / 2, y + h / 2);
    ctx.textAlign = "left";
  }

  // handX is already mirrored (1 - handX used in-game), so place the dot un-flipped.
  if (handSeen) {
    const dotX = x + (1 - handX) * w;
    const dotY = y + (handY !== null ? handY * h : h / 2);
    ctx.fillStyle = "#39FF14";
    ctx.beginPath();
    ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineWidth = 3;
  ctx.strokeStyle = handSeen ? "#39FF14" : "#ff4444";
  ctx.strokeRect(x, y, w, h);

  // Diagnostic line: how many frames we've received from the mirror + camera state.
  // mir>0 means the mirror is streaming to us; mir 0 means it isn't (old code / not
  // refreshed / channel not connected). Remove with SHOW_CAM_HUD once it's working.
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#39FF14";
  ctx.font = "12px monospace";
  ctx.textAlign = "right";
  var camState = mirrorFramesLive() ? "mirror" : (cameraActive ? "direct" : (lastCamError || "none"));
  ctx.fillText("mir " + mirrorFrameCount + " | cam " + camState, x + w, y + h + 16);
  ctx.textAlign = "left";
  ctx.restore();
}

loadAssets().then(function() {
  spawnObstacle();
  gameLoop();
});