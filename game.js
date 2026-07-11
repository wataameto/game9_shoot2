import * as THREE from 'https://unpkg.com/three@0.147.0/build/three.module.js';

// ==========================================================================
// GAME CONFIGURATION & CONSTANTS
// ==========================================================================
const GAME_CONFIG = {
  player: {
    speed: 35,          // Maximum movement speed (units per second)
    rangeX: 250,        // Maximum X boundary in space
    rangeZ: 250,        // Maximum Z boundary in space
    rollLimit: 0.5,     // Roll angle (radians) when moving sideways
    pitchLimit: 0.25,   // Pitch angle (radians) when moving vertically
    lerpSpeed: 10,      // Smoothing factor for ship movement/rotation
  },
  laser: {
    speed: 150,         // Laser flight speed
    fireRate: 150,      // Minimum time between shots in ms (standard)
    cooldown: 0,
  },
  starfield: {
    count: 800,        // Number of background stars
    speed: 180,         // Warp speed of stars
    depth: 400,         // Depth of star spawn field (Z range)
  },
  spawn: {
    asteroidRate: 0.02, // Base spawn chance per frame for asteroids
    enemyShipRate: 0.01,// Base spawn chance per frame for enemy drones
    itemRate: 0.003,    // Base spawn chance per frame for powerups
  }
};

// ==========================================================================
// GAME STATE MANAGEMENT
// ==========================================================================
let state = {
  mode: 'TITLE',        // TITLE, PLAYING, GAMEOVER, STAGECLEAR
  gameMode: '3D',       // 3D, 2D
  score: 0,
  highScore: parseInt(localStorage.getItem('neon_starfighter_high') || '0'),
  kills: 0,
  shield: 200,
  maxShield: 200,
  weaponLevel: 1,
  lastFireTime: 0,
  difficultyMultiplier: 1.0,
  currentSpeed: 0,
  velocity: new THREE.Vector3(),
  stage: 1,
  killsForBoss: 8,   // kills needed to trigger boss
  bossActive: false,
  bossHP: 0,
  bossMaxHP: 30,
  invincible: false,
  invincibleTime: 0,
  timeElapsed: 0,
  bossSpawnTimeLimit: 45,
};

// Controls tracking
const keys = {
  w: false, a: false, s: false, d: false,
  ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
  Space: false, Enter: false
};

// Pointer/Touch Controls State
let pointerControl = {
  active: false,
  targetX: 0,
  targetY: 0 // Will map to Y in 3D, Z in 2D
};

// Cinematic Camera Intro State
let cameraIntro = {
  active: false,
  timer: 0,
  duration: 1.3, // seconds
  startPos: new THREE.Vector3(),
  endPos: new THREE.Vector3()
};

// WebGL Global Objects
let scene, camera, renderer, clock;
let starPoints, starGeometry;
let speedLines, speedLinesGeometry; // For 3D warp speed lines
const speedLinesData = [];          // Speed lines tracking data

// Game Object Groups
let playerGroup;        // Contains cockpit, wings, engines, lights
let engineFlameParticles = [];
const lasers = [];
const missiles = [];
const enemies = [];
const enemyProjectiles = []; // Track enemy bullet meshes and velocities
const explosions = [];
const items = [];

// Boss
let bossGroup = null;
let bossHP = 0;
let radarCanvas = null;
let radarCtx = null;

// Lights
let dirLight, ambientLight, playerEngineLight;

// Audio Context (Initialized on user interaction)
let audioCtx = null;

// DOM Elements (Using getters for lazy loading to prevent early null values)
const dom = {
  get hud() { return document.getElementById('hud'); },
  get hudShieldBar() { return document.getElementById('hud-shield-bar'); },
  get hudScore() { return document.getElementById('hud-score'); },
  get hudWeaponType() { return document.getElementById('hud-weapon-type'); },
  get weaponStatusDot() { return document.getElementById('weapon-status-dot'); },
  get titleScreen() { return document.getElementById('title-screen'); },
  get titleHighScore() { return document.getElementById('title-highscore'); },
  get btnStart3d() { return document.getElementById('btn-start-3d'); },
  get btnStart2d() { return document.getElementById('btn-start-2d'); },
  get gameoverScreen() { return document.getElementById('gameover-screen'); },
  get gameoverScore() { return document.getElementById('gameover-score'); },
  get gameoverKills() { return document.getElementById('gameover-kills'); },
  get gameoverHighScore() { return document.getElementById('gameover-highscore'); },
  get btnRestart3d() { return document.getElementById('btn-restart-3d'); },
  get btnRestart2d() { return document.getElementById('btn-restart-2d'); },
  get btnGameOverTitle() { return document.getElementById('btn-gameover-title'); },
  get btnHudTitle() { return document.getElementById('btn-hud-title'); },
  get damageFlashLayer() { return document.getElementById('damage-flash-layer'); },
  get hudSpeedBar() { return document.getElementById('hud-speed-bar'); },
  get hudSpeedText() { return document.getElementById('hud-speed-text'); },
  get radarCanvas() { return document.getElementById('radar-canvas'); },
  get stageClearScreen() { return document.getElementById('stageclear-screen'); },
  get stageClearStage() { return document.getElementById('stageclear-stage'); },
  get btnNextStage() { return document.getElementById('btn-next-stage'); },
  get bossMeter() { return document.getElementById('boss-meter'); },
  get bossBar() { return document.getElementById('boss-bar'); },
  get bossLockon() { return document.getElementById('boss-lockon'); },
  get bossAlertOverlay() { return document.getElementById('boss-alert-overlay'); },
};

// ==========================================================================
// AUDIO SYSTEM (WEB AUDIO API SYNTHESIS)
// ==========================================================================
function initAudio() {
  if (audioCtx) return;
  // Initialize on first click/keypress
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();
}

function playLaserSound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    // Laser "pew" frequency sweep
    const now = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
    
    // Rapid volume decay
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    osc.start(now);
    osc.stop(now + 0.16);
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playExplosionSound() {
  if (!audioCtx) return;
  try {
    // Generate white noise for explosion sound
    const bufferSize = audioCtx.sampleRate * 0.4; // 0.4 seconds
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;
    
    // Filter noise for low-end rumble
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.35);
    
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.38);
    
    noiseNode.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    noiseNode.start();
    noiseNode.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playDamageSound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(60, now + 0.25);
    
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    
    osc.start(now);
    osc.stop(now + 0.26);
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playPowerUpSound() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    // Play a shiny 3-note arpeggio
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      
      gain.gain.setValueAtTime(0, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);
      
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.22);
    });
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playGameOverSound() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const notes = [330, 293, 220, 165]; // Descending sad melody
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.15);
      
      gain.gain.setValueAtTime(0.2, now + idx * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.15 + 0.3);
      
      osc.start(now + idx * 0.15);
      osc.stop(now + idx * 0.15 + 0.35);
    });
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

// ==========================================================================
// 3D MODEL GENERATION (BUILDING STATELY PROCEDURAL MESHES)
// ==========================================================================

/**
 * Creates the player's starfighter. Combines geometric shapes into a sleek design.
 */
function createPlayerShip() {
  const group = new THREE.Group();

  // Premium "Cool & Cute" materials
  const bodyMetalMat = new THREE.MeshStandardMaterial({
    color: 0xf5f6fa,       // Sleek ceramic tactical white
    metalness: 0.2,        // Glossy ceramic feel
    roughness: 0.15
  });

  const wingMetalMat = new THREE.MeshStandardMaterial({
    color: 0xffb7d5,       // Sweet pastel cherry blossom pink (high contrast against blue sky)
    metalness: 0.15,
    roughness: 0.25
  });

  const canopyGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffea00,       // Glowing honey gold canopy for cute pop-out contrast
    emissive: 0x4d3f00,
    roughness: 0.05,
    metalness: 0.95,
    transparent: true,
    opacity: 0.85
  });

  const neonCyanMat = new THREE.MeshBasicMaterial({
    color: 0xff007f        // Neon hot pink energy blades
  });

  const engineMetalMat = new THREE.MeshStandardMaterial({
    color: 0x2c2d35,       // Gunmetal dark accents to retain "coolness"
    metalness: 0.85,
    roughness: 0.3
  });

  const engineGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff007f        // Hot pink engine nozzle core glow
  });

  // 1. Main Fuselage (Tapered sleek cylinder body)
  const bodyGeom = new THREE.CylinderGeometry(0.7, 0.45, 4.4, 10);
  bodyGeom.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, bodyMetalMat);
  body.position.set(0, 0, 1.0);
  group.add(body);

  // 2. Streamlined Canopy / Cockpit (Long glass canopy)
  const canopyGeom = new THREE.SphereGeometry(0.55, 12, 12);
  canopyGeom.scale(1.0, 0.7, 2.2); // Elongated cockpit shape
  const canopy = new THREE.Mesh(canopyGeom, canopyGlassMat);
  canopy.position.set(0, 0.2, -0.6);
  group.add(canopy);

  // 3. Nose Cone / Pitot Tube (Sharp pointy front tip)
  const noseGeom = new THREE.ConeGeometry(0.15, 1.2, 6);
  noseGeom.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeom, engineMetalMat);
  nose.position.set(0, 0, -2.5);
  group.add(nose);

  // 4. Custom Polygon Wings - Swept Forward/Backward Style (Left/Right)
  // Building sleek polygonal geometry using vertices
  const leftWingGeom = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    // x, y, z
    0, 0, 0,          // root front
    0, 0, 2.2,        // root back
    -3.2, -0.15, 1.8, // tip back
    -3.2, -0.15, 1.2, // tip front
  ]);
  const indices = [
    0, 1, 2,
    0, 2, 3
  ];
  leftWingGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  leftWingGeom.setIndex(indices);
  leftWingGeom.computeVertexNormals();

  const leftWing = new THREE.Mesh(leftWingGeom, wingMetalMat);
  leftWing.position.set(0, -0.05, 0.8);
  group.add(leftWing);

  // Mirror Right Wing
  const rightWingGeom = new THREE.BufferGeometry();
  const rVertices = new Float32Array([
    0, 0, 0,
    0, 0, 2.2,
    3.2, -0.15, 1.8,
    3.2, -0.15, 1.2,
  ]);
  rightWingGeom.setAttribute('position', new THREE.BufferAttribute(rVertices, 3));
  rightWingGeom.setIndex(indices);
  rightWingGeom.computeVertexNormals();

  const rightWing = new THREE.Mesh(rightWingGeom, wingMetalMat);
  rightWing.position.set(0, -0.05, 0.8);
  group.add(rightWing);

  // 5. Neon Energy Blades (Thin bright cyans at wing edges)
  const leftBladeGeom = new THREE.BoxGeometry(0.06, 0.06, 1.5);
  const leftBlade = new THREE.Mesh(leftBladeGeom, neonCyanMat);
  leftBlade.position.set(-3.2, -0.15, 2.3);
  leftBlade.rotation.y = 0.1;
  group.add(leftBlade);

  const rightBlade = leftBlade.clone();
  rightBlade.position.x = 3.2;
  rightBlade.rotation.y = -0.1;
  group.add(rightBlade);

  // 6. Canards (Small front stabilizer wings on the nose)
  const leftCanardGeom = new THREE.BoxGeometry(1.0, 0.04, 0.5);
  const leftCanard = new THREE.Mesh(leftCanardGeom, wingMetalMat);
  leftCanard.position.set(-0.9, 0.1, -1.0);
  leftCanard.rotation.y = 0.3; // Angle backward
  group.add(leftCanard);

  const rightCanard = leftCanard.clone();
  rightCanard.position.x = 0.9;
  rightCanard.rotation.y = -0.3;
  group.add(rightCanard);

  // 7. Slanted Stabilizer Fins (Outward slanted wingtips)
  const leftFinGeom = new THREE.BoxGeometry(0.12, 1.3, 1.4);
  const leftFin = new THREE.Mesh(leftFinGeom, bodyMetalMat);
  leftFin.position.set(-3.2, 0.45, 2.1);
  leftFin.rotation.z = -0.22;
  group.add(leftFin);

  const rightFin = leftFin.clone();
  rightFin.position.x = 3.2;
  rightFin.rotation.z = 0.22;
  group.add(rightFin);

  // 8. Twin Engine Nozzles (Futuristic dual thrusters)
  const nozzleGeom = new THREE.CylinderGeometry(0.38, 0.44, 0.8, 8);
  nozzleGeom.rotateX(Math.PI / 2);
  
  const leftNozzle = new THREE.Mesh(nozzleGeom, engineMetalMat);
  leftNozzle.position.set(-0.6, 0, 3.2);
  group.add(leftNozzle);

  const rightNozzle = leftNozzle.clone();
  rightNozzle.position.x = 0.6;
  group.add(rightNozzle);

  // 9. Twin Engine Inner Glow
  const glowGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.15, 8);
  glowGeom.rotateX(Math.PI / 2);
  
  const leftGlow = new THREE.Mesh(glowGeom, engineGlowMat);
  leftGlow.position.set(-0.6, 0, 3.5);
  group.add(leftGlow);

  const rightGlow = leftGlow.clone();
  rightGlow.position.x = 0.6;
  group.add(rightGlow);

  // 10. Heavy Cannon Barrels on Wing Join (Gun barrel details)
  const cannonGeom = new THREE.CylinderGeometry(0.14, 0.14, 1.8, 6);
  cannonGeom.rotateX(Math.PI / 2);
  
  const leftCannon = new THREE.Mesh(cannonGeom, engineMetalMat);
  leftCannon.position.set(-2.8, -0.15, 1.0);
  group.add(leftCannon);

  const rightCannon = leftCannon.clone();
  rightCannon.position.x = 2.8;
  group.add(rightCannon);

  // 11. Cannon Tips (Glow tips)
  const tipGeom = new THREE.CylinderGeometry(0.16, 0.1, 0.3, 6);
  tipGeom.rotateX(Math.PI / 2);
  
  const leftTip = new THREE.Mesh(tipGeom, canopyGlassMat);
  leftTip.position.set(-2.8, -0.15, 0.0);
  group.add(leftTip);

  const rightTip = leftTip.clone();
  rightTip.position.x = 2.8;
  group.add(rightTip);

  // Engine PointLight attached to player to project glow on nearby objects (neon pink glow)
  playerEngineLight = new THREE.PointLight(0xff007f, 2.5, 15);
  playerEngineLight.position.set(0, 0, 4.0);
  group.add(playerEngineLight);

  return group;
}

/**
 * Creates an enemy drone ship
 */
function createEnemyDrone() {
  const group = new THREE.Group();

  // Core Sphere / Cockpit (Ominous Red glowing core)
  const coreGeom = new THREE.SphereGeometry(1.0, 10, 10);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff0044,
    emissive: 0xff0044,
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const core = new THREE.Mesh(coreGeom, coreMat);
  group.add(core);

  // Outer armor ring/blades (Procedural dark metal wings)
  const ringGeom = new THREE.CylinderGeometry(1.6, 1.6, 0.3, 3, 1, true); // Open triangle ring
  ringGeom.rotateX(Math.PI / 2);
  const armorMat = new THREE.MeshStandardMaterial({
    color: 0x181822,
    roughness: 0.6,
    metalness: 0.9
  });
  const ring = new THREE.Mesh(ringGeom, armorMat);
  group.add(ring);

  // Forward spikes (Antennae/Lasers)
  const spikeGeom = new THREE.ConeGeometry(0.12, 1.8, 5);
  spikeGeom.rotateX(-Math.PI / 2);
  const spike1 = new THREE.Mesh(spikeGeom, armorMat);
  spike1.position.set(-0.7, 0, -1.2);
  spike1.rotation.y = 0.2;
  group.add(spike1);

  const spike2 = spike1.clone();
  spike2.position.x = 0.7;
  spike2.rotation.y = -0.2;
  group.add(spike2);

  // Thruster back glow
  const thrGeom = new THREE.ConeGeometry(0.4, 0.8, 8);
  thrGeom.rotateX(Math.PI / 2);
  const thrMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
  const thr = new THREE.Mesh(thrGeom, thrMat);
  thr.position.set(0, 0, 1.0);
  group.add(thr);

  // Scale down a bit to match gameplay scale
  group.scale.set(0.9, 0.9, 0.9);

  return group;
}

/**
 * Creates an asteroid mesh
 */
function createAsteroidMesh() {
  // Use Dodecahedron for jagged low-poly space rock look
  const radius = 1.2 + Math.random() * 1.5;
  const geom = new THREE.DodecahedronGeometry(radius, 1);
  
  // Randomly perturb vertices to make asteroid uniquely irregular
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    
    // Shift slightly in random direction
    const factor = 0.15;
    pos.setXYZ(
      i, 
      x + (Math.random() - 0.5) * radius * factor, 
      y + (Math.random() - 0.5) * radius * factor, 
      z + (Math.random() - 0.5) * radius * factor
    );
  }
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a4745,
    roughness: 0.95,
    metalness: 0.1,
    bumpScale: 0.05
  });

  const mesh = new THREE.Mesh(geom, mat);
  
  // Pre-rotate randomly
  mesh.rotation.set(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    Math.random() * Math.PI
  );

  return { mesh, radius };
}

/**
 * Creates a glowing power-up/collectible
 */
function createItemMesh(type) {
  const group = new THREE.Group();
  let geom, mat, coreColor;

  if (type === 'SHIELD') {
    // Octahedron representing shield restore
    geom = new THREE.OctahedronGeometry(1.0, 0);
    coreColor = 0x39ff14; // Green
    mat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9
    });
  } else {
    // Icosahedron representing weapon power-up
    geom = new THREE.IcosahedronGeometry(0.9, 0);
    coreColor = 0xffea00; // Yellow
    mat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9
    });
  }

  const core = new THREE.Mesh(geom, mat);
  group.add(core);

  // Outer wireframe container for high-tech look
  const wireGeom = geom.clone();
  const wireMat = new THREE.MeshBasicMaterial({
    color: coreColor,
    wireframe: true,
    transparent: true,
    opacity: 0.4
  });
  const outerWire = new THREE.Mesh(wireGeom, wireMat);
  outerWire.scale.set(1.4, 1.4, 1.4);
  group.add(outerWire);

  // Point light to cast color on surroundings
  const light = new THREE.PointLight(coreColor, 1.5, 5);
  group.add(light);

  return group;
}

// ==========================================================================
// SCENE SETUP
// ==========================================================================
function initScene() {
  const container = dom.canvasContainer; // Will resolve below
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Scene with beautiful sky blue background and atmospheric fog
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a9ad9); // Clear blue sky
  scene.fog = new THREE.FogExp2(0x89c7f2, 0.0035); // Fog blending with sky at distance

  // Camera
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 15); // Place camera behind ship

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false; // Disable shadows for high performance
  
  const canvasHost = document.getElementById('canvas-container');
  canvasHost.appendChild(renderer.domElement);
  // Canvas never blocks HTML UI button clicks — pointer events managed via JS state
  renderer.domElement.style.pointerEvents = 'none';

  // Clock
  clock = new THREE.Clock();

  // Lights: Bright daylight settings
  ambientLight = new THREE.AmbientLight(0xbde3ff, 1.4); // Sky reflection ambient
  scene.add(ambientLight);

  dirLight = new THREE.DirectionalLight(0xfffaed, 2.0); // Strong golden sunlight
  dirLight.position.set(15, 30, 10);
  scene.add(dirLight);

  // Soft blue directional bounce light from the earth below
  const skyBounceLight = new THREE.DirectionalLight(0x73bbf2, 0.6);
  skyBounceLight.position.set(-10, -20, -10);
  scene.add(skyBounceLight);

  // Build cloud layer background instead of space stars
  buildCloudfield();
  buildSpeedLines();
  
  // Set up resize listener
  window.addEventListener('resize', onWindowResize);
}

/**
 * Helper to generate canvas texture of a fluffy volumetric cloud puff
 */
function createCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, 128, 128);

  // Generate 6 overlapping soft circles to make a fluffy, organic cloud shape
  const numPuffs = 6;
  for (let i = 0; i < numPuffs; i++) {
    const angle = (i / numPuffs) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const dist = 8 + Math.random() * 12;
    const x = 64 + Math.cos(angle) * dist;
    const y = 64 + Math.sin(angle) * dist;
    const radius = 24 + Math.random() * 12;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

/**
 * Builds the warping volumetric cloud background
 */
function buildCloudfield() {
  const count = 90; // Lower count, larger volumetric size
  starGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Spread clouds widely in the sky (X: -260 to 260, Y: -120 to 120, Z: -depth to 0)
    positions[i * 3] = (Math.random() - 0.5) * 520;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 240;
    positions[i * 3 + 2] = -Math.random() * GAME_CONFIG.starfield.depth;
    
    // Cloud scroll speed
    velocities[i] = GAME_CONFIG.starfield.speed * (0.35 + Math.random() * 0.65);
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Canvas-generated fluffy puff texture
  const cloudTexture = createCloudTexture();
  const cloudMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 45.0,           // Massive scale for soft, realistic puff shapes
    transparent: true,
    opacity: 0.38,        // Soft transparency blending beautifully into sky
    map: cloudTexture,
    blending: THREE.NormalBlending, // Standard alpha blend for day skies
    depthWrite: false
  });

  starPoints = new THREE.Points(starGeometry, cloudMat);
  scene.add(starPoints);
}

/**
 * Builds the warp speed lines for 3D mode
 */
function buildSpeedLines() {
  const count = 35; // Number of speed lines
  const positions = new Float32Array(count * 6); // 2 vertices per line (start + end)
  
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 22; // Tunnel surrounding the center
    const y = (Math.random() - 0.5) * 14;
    const z = -Math.random() * 180;
    const length = 6 + Math.random() * 12; // Length of the line segment
    
    const idx = i * 6;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
    
    positions[idx + 3] = x;
    positions[idx + 4] = y;
    positions[idx + 5] = z - length;
    
    speedLinesData.push({
      x, y, z, length,
      speed: 180 + Math.random() * 100 // High scrolling speed
    });
  }
  
  speedLinesGeometry = new THREE.BufferGeometry();
  speedLinesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  const mat = new THREE.LineBasicMaterial({
    color: 0xa8f5ff,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending
  });
  
  speedLines = new THREE.LineSegments(speedLinesGeometry, mat);
  scene.add(speedLines);
}

/**
 * Scroll speed lines towards the camera in 3D mode
 */
function updateSpeedLines(dt) {
  if (!speedLinesGeometry || !speedLines) return;
  
  // Speed lines are active only when playing in 3D mode
  const isVisible = state.mode === 'PLAYING' && state.gameMode === '3D';
  speedLines.visible = isVisible;
  if (!isVisible) return;

  if (camera) {
    speedLines.position.copy(camera.position);
    speedLines.rotation.copy(camera.rotation);
  }
  
  const posArr = speedLinesGeometry.attributes.position.array;
  
  for (let i = 0; i < speedLinesData.length; i++) {
    const data = speedLinesData[i];
    
    // Move lines forward
    data.z += data.speed * dt;
    
    // Recycle line if it goes past camera
    if (data.z > 20) {
      data.z = -180 - Math.random() * 50;
      data.x = (Math.random() - 0.5) * 22;
      data.y = (Math.random() - 0.5) * 14;
      data.speed = 180 + Math.random() * 100;
    }
    
    const idx = i * 6;
    // Start vertex
    posArr[idx] = data.x;
    posArr[idx + 1] = data.y;
    posArr[idx + 2] = data.z;
    
    // End vertex (stretched backward in space)
    posArr[idx + 3] = data.x;
    posArr[idx + 4] = data.y;
    posArr[idx + 5] = data.z - data.length;
  }
  
  speedLinesGeometry.attributes.position.needsUpdate = true;
}

/**
 * Dynamic Camera Roll & Target Lag Follow for immersive flight feel
 */
function updateCamera(dt) {
  if (!playerGroup || cameraIntro.active) return;
  
  if (state.gameMode === '3D') {
    // 3D Mode: Camera follows player from behind in XZ plane
    const playerPos = playerGroup.position;
    const yaw = playerGroup.rotation.y;
    
    // Position camera behind player based on YAW rotation
    const distance = 14;
    const height = 4.0;
    
    const targetCamX = playerPos.x + Math.sin(yaw) * distance;
    const targetCamZ = playerPos.z + Math.cos(yaw) * distance;
    const targetCamY = playerPos.y + height;
    
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 4.8 * dt);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, 4.8 * dt);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 4.8 * dt);
    
    // Look ahead of player
    const lookAheadDistance = 20;
    const lookTarget = new THREE.Vector3(
      playerPos.x - Math.sin(yaw) * lookAheadDistance,
      playerPos.y + 0.5,
      playerPos.z - Math.cos(yaw) * lookAheadDistance
    );
    
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.lookAt(camera.position, lookTarget, new THREE.Vector3(0, 1, 0));
    
    const targetQuat = new THREE.Quaternion();
    targetQuat.setFromRotationMatrix(tempMatrix);
    camera.quaternion.slerp(targetQuat, 4.2 * dt);
    
    // Roll camera slightly with ship banking
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = THREE.MathUtils.lerp(euler.z, playerGroup.rotation.z * 0.15, 3.5 * dt);
    camera.quaternion.setFromEuler(euler);
    
  } else {
    // 2D Mode: Camera locked directly to player (keeps ship perfectly centered)
    camera.position.x = playerGroup.position.x;
    camera.position.z = playerGroup.position.z - 5;
    camera.position.y = 42;
    
    // Ensure rotation remains perfectly looking down
    camera.rotation.set(-Math.PI / 2, 0, 0);
  }
}

/**
 * Helper to generate canvas texture of a soft circle
 */
function createCircleTexture(colorStr) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, colorStr);
  grad.addColorStop(0.3, colorStr);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  
  return new THREE.CanvasTexture(canvas);
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
}

// ==========================================================================
// PARTICLES & EFFECTS ENGINE
// ==========================================================================

/**
 * Instantiates a particle explosion at the specified position
 */
function spawnExplosion(position, colorHex, particleCount = 35) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const velocities = [];
  
  for (let i = 0; i < particleCount; i++) {
    // Position starts at origin of impact
    positions.push(position.x, position.y, position.z);
    
    // Fly in spherical distribution
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const speed = 5 + Math.random() * 25;
    
    velocities.push(
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.sin(phi) * Math.sin(theta) * speed,
      Math.cos(phi) * speed
    );
  }
  
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  const texture = createCircleTexture('#ffffff');
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size: 1.2,
    transparent: true,
    opacity: 1.0,
    map: texture,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  const points = new THREE.Points(geom, mat);
  scene.add(points);
  
  explosions.push({
    points,
    velocities,
    life: 0,
    maxLife: 0.65 // seconds
  });

  // Dynamic light flash at explosion location
  const light = new THREE.PointLight(colorHex, 6, 25);
  light.position.copy(position);
  scene.add(light);
  
  // Fade light quickly
  const lightTimer = setInterval(() => {
    light.intensity -= 0.6;
    if (light.intensity <= 0) {
      scene.remove(light);
      clearInterval(lightTimer);
    }
  }, 30);
}

/**
 * Creates dynamic engine trail particles behind the player ship
 */
function updateEngineFlame(dt, playerPos) {
  // Spawn rate limit
  if (Math.random() < 0.35 && state.mode === 'PLAYING') {
    const is2D = state.gameMode === '2D';
    const scale = is2D ? 0.6 : 1.0;
    
    const size = (0.45 + Math.random() * 0.45) * scale;
    const geom = new THREE.BoxGeometry(size, size, size);
    
    // Neon pink engine glow trail
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff007f,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    
    const flame = new THREE.Mesh(geom, mat);
    
    // Calculate direction directly opposite to ship's current rotation (Yaw)
    const yaw = playerGroup ? playerGroup.rotation.y : 0;
    const blowDir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    
    // Select left or right nozzle offset based on twin-engine design
    const sideX = Math.random() < 0.5 ? -0.6 : 0.6;
    
    // Twin engine nozzle positions in local coordinates
    const localOffset = new THREE.Vector3(sideX * scale, 0, 3.3 * scale);
    localOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    
    // Spawn just behind nozzle tips
    flame.position.copy(playerPos).add(localOffset).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.12 * scale,
      (Math.random() - 0.5) * 0.12 * scale,
      0
    ));
    
    scene.add(flame);
    
    // Random spin
    const spinSpeed = {
      x: Math.random() * 5,
      y: Math.random() * 5,
      z: Math.random() * 5
    };
    
    // Compute velocity (blow backwards from nozzle)
    const speed = 35 + Math.random() * 20;
    const velocity = blowDir.multiplyScalar(speed);
    
    engineFlameParticles.push({
      mesh: flame,
      spinSpeed,
      velocity: velocity,
      life: 0.0,
      maxLife: 0.25 // Fade quickly
    });
  }

  // Update existing engine particles
  for (let i = engineFlameParticles.length - 1; i >= 0; i--) {
    const p = engineFlameParticles[i];
    p.life += dt;
    
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      engineFlameParticles.splice(i, 1);
    } else {
      // Progressively shrink and fade out
      const pct = p.life / p.maxLife;
      p.mesh.scale.setScalar(1.0 - pct);
      p.mesh.material.opacity = (1.0 - pct) * 0.8;
      
      // Move relative to camera/player motion
      const relVelocity = new THREE.Vector3().copy(p.velocity).addScaledVector(state.velocity, -1);
      p.mesh.position.addScaledVector(relVelocity, dt);
      
      p.mesh.rotation.x += p.spinSpeed.x * dt;
      p.mesh.rotation.y += p.spinSpeed.y * dt;
    }
  }
}

// ==========================================================================
// SPAWNING SYSTEM (RANDOM ENCOUNTERS FROM DEEP SPACE)
// ==========================================================================
function spawnEnemy() {
  if (state.mode !== 'PLAYING') return;

  const roll = Math.random();
  // Reduce individual spawn rate and group them instead for swarm encounters
  const rateScale = 0.22;
  const adjustedAsteroidRate = GAME_CONFIG.spawn.asteroidRate * state.difficultyMultiplier * rateScale;
  const adjustedDroneRate = GAME_CONFIG.spawn.enemyShipRate * state.difficultyMultiplier * rateScale;

  const scale = state.gameMode === '2D' ? 0.6 : 1.0;

  // Calculate spawning position relative to player facing direction
  const pPos = playerGroup.position;
  const pYaw = playerGroup.rotation.y;
  const forwardX = -Math.sin(pYaw);
  const forwardZ = -Math.cos(pYaw);
  const rightX = -Math.cos(pYaw);
  const rightZ = Math.sin(pYaw);

  const distOffset = 240; // Spawn distance ahead
  
  // Spawn asteroid cluster
  if (roll < adjustedAsteroidRate) {
    const groupSize = 2 + Math.floor(Math.random() * 3); // 2 to 4 asteroids in a pack
    const baseSideOffset = (Math.random() - 0.5) * 60;

    for (let i = 0; i < groupSize; i++) {
      const data = createAsteroidMesh();
      
      // Distribute in a small clump
      const angle = (i / groupSize) * Math.PI * 2;
      const radius = 8 + Math.random() * 12;
      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius;

      const spawnX = pPos.x + forwardX * distOffset + rightX * (baseSideOffset + offsetX);
      const spawnZ = pPos.z + forwardZ * distOffset + rightZ * (baseSideOffset + offsetZ);
      const spawnY = state.gameMode === '3D' ? (Math.random() - 0.5) * 8 : 0;

      data.mesh.position.set(spawnX, spawnY, spawnZ);
      data.mesh.scale.set(scale, scale, scale);
      scene.add(data.mesh);

      // Cache original materials for hit flash
      const originalMaterials = new Map();
      data.mesh.traverse(child => {
        if (child.isMesh) originalMaterials.set(child, child.material);
      });

      // Float slowly in 2D mode
      const speed = state.gameMode === '2D'
        ? (10 + Math.random() * 10 * state.difficultyMultiplier)
        : (35 + Math.random() * 35 * state.difficultyMultiplier);
      
      const velocity = new THREE.Vector3().subVectors(pPos, data.mesh.position).normalize().multiplyScalar(speed);
      if (state.gameMode === '2D') velocity.y = 0;

      enemies.push({
        mesh: data.mesh,
        type: 'ASTEROID',
        radius: data.radius * scale,
        speed: speed,
        velocity: velocity,
        hp: Math.ceil(data.radius * 2), // Larger rocks need more hits
        maxHp: Math.ceil(data.radius * 2),
        rotationSpeed: {
          x: (Math.random() - 0.5) * 1.5,
          y: (Math.random() - 0.5) * 1.5,
          z: (Math.random() - 0.5) * 1.5
        },
        originalMaterials,
        flashTime: 0
      });
    }
  } 
  // Spawn enemy flight drone squad (V-formation or Line)
  else if (roll < adjustedAsteroidRate + adjustedDroneRate) {
    const groupSize = 3 + Math.floor(Math.random() * 3); // 3 to 5 drones in a squad
    const baseSideOffset = (Math.random() - 0.5) * 50;
    const useVFormation = Math.random() < 0.6;

    for (let i = 0; i < groupSize; i++) {
      const droneMesh = createEnemyDrone();
      
      let offsetX = 0;
      let offsetZ = 0;
      if (useVFormation) {
        // V-formation offsets
        const mid = (groupSize - 1) / 2;
        offsetX = (i - mid) * 10;
        offsetZ = Math.abs(i - mid) * 8; // push wings back
      } else {
        // Line offsets
        const mid = (groupSize - 1) / 2;
        offsetX = (i - mid) * 12;
        offsetZ = (Math.random() - 0.5) * 4;
      }
      
      const spawnX = pPos.x + forwardX * (distOffset + offsetZ) + rightX * (baseSideOffset + offsetX);
      const spawnZ = pPos.z + forwardZ * (distOffset + offsetZ) + rightZ * (baseSideOffset + offsetX);
      const spawnY = state.gameMode === '3D' ? (Math.random() - 0.5) * 5 : 0;

      droneMesh.position.set(spawnX, spawnY, spawnZ);
      droneMesh.scale.set(scale, scale, scale);
      scene.add(droneMesh);

      // Cache original materials for hit flash
      const originalMaterials = new Map();
      droneMesh.traverse(child => {
        if (child.isMesh) originalMaterials.set(child, child.material);
      });

      // Float slowly in 2D mode
      const speed = state.gameMode === '2D'
        ? (14 + Math.random() * 10 * state.difficultyMultiplier)
        : (50 + Math.random() * 30 * state.difficultyMultiplier);

      const velocity = new THREE.Vector3().subVectors(pPos, droneMesh.position).normalize().multiplyScalar(speed);
      if (state.gameMode === '2D') velocity.y = 0;

      enemies.push({
        mesh: droneMesh,
        type: 'DRONE',
        radius: 1.1 * scale,
        speed: speed,
        velocity: velocity,
        hp: 2, // 2 HP so player sees hit flash
        maxHp: 2,
        hoverOffset: Math.random() * Math.PI * 2, // Smooth sinusoidal hovering
        rotationSpeed: { x: 0, y: 0, z: (Math.random() - 0.5) * 2 },
        originalMaterials,
        flashTime: 0,
        lastShootTime: performance.now() + Math.random() * 1500 // Delay first shot
      });
    }
  }

  // Spawn Power-up items
  if (Math.random() < GAME_CONFIG.spawn.itemRate) {
    const itemType = Math.random() < 0.6 ? 'SHIELD' : 'WEAPON';
    const itemMesh = createItemMesh(itemType);
    
    const sideOffset = (Math.random() - 0.5) * 40;
    const spawnX = pPos.x + forwardX * distOffset + rightX * sideOffset;
    const spawnZ = pPos.z + forwardZ * distOffset + rightZ * sideOffset;
    const spawnY = state.gameMode === '3D' ? (Math.random() - 0.5) * 6 : 0;
    
    itemMesh.position.set(spawnX, spawnY, spawnZ);
    itemMesh.scale.set(scale, scale, scale);
    scene.add(itemMesh);

    // Slowly drifts towards the player
    const velocity = new THREE.Vector3().subVectors(pPos, itemMesh.position).normalize().multiplyScalar(15);
    if (state.gameMode === '2D') velocity.y = 0;

    items.push({
      mesh: itemMesh,
      type: itemType,
      speed: 15,
      velocity: velocity,
      radius: 1.2 * scale,
      pulseTime: 0
    });
  }
}

// ==========================================================================
// CORE GAME PLAY MECHANICS (FIRE, DAMAGE, SCORE)
// ==========================================================================
function fireLaser() {
  const now = performance.now();
  if (now - state.lastFireTime < GAME_CONFIG.laser.fireRate) return;
  
  state.lastFireTime = now;
  playLaserSound();

  const laserColor = state.weaponLevel === 1 ? 0xff007f : (state.weaponLevel === 2 ? 0xffea00 : (state.weaponLevel === 3 ? 0xbd93f9 : 0x00f0ff));
  const laserMat = new THREE.MeshBasicMaterial({ color: laserColor });
  
  // Dimension of laser bolt
  const laserGeom = new THREE.CylinderGeometry(0.12, 0.12, 4.0, 6);
  laserGeom.rotateX(Math.PI / 2);

  const shipPos = playerGroup.position;
  const launchY = state.gameMode === '3D' ? shipPos.y : 0;
  
  // Get ship current yaw (always 0 in 3D mode)
  const shipYaw = playerGroup.rotation.y;
  const upAxis = new THREE.Vector3(0, 1, 0);
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;

  if (state.weaponLevel === 1 || state.weaponLevel === 3 || state.weaponLevel === 4) {
    // Center shot: offset (0, 0, -2) in local space, scaled
    const localOffset = new THREE.Vector3(0, state.gameMode === '3D' ? 0.1 : 0, -2 * scale);
    localOffset.applyAxisAngle(upAxis, shipYaw);

    const laserMesh = new THREE.Mesh(laserGeom, laserMat);
    laserMesh.position.copy(shipPos).add(localOffset);
    laserMesh.rotation.y = shipYaw; // Align cylinder mesh rotation
    laserMesh.scale.set(scale, scale, scale); // Scale laser mesh
    scene.add(laserMesh);
    
    const velocity = new THREE.Vector3(0, 0, -GAME_CONFIG.laser.speed);
    velocity.applyAxisAngle(upAxis, shipYaw);

    lasers.push({
      mesh: laserMesh,
      velocity: velocity
    });
  }

  if (state.weaponLevel >= 2) {
    // Left Cannon local offset, scaled
    const leftOffset = new THREE.Vector3(-2.8 * scale, state.gameMode === '3D' ? -0.1 : 0, -0.5 * scale);
    leftOffset.applyAxisAngle(upAxis, shipYaw);
    
    const leftLaser = new THREE.Mesh(laserGeom, laserMat);
    leftLaser.position.copy(shipPos).add(leftOffset);
    leftLaser.rotation.y = shipYaw;
    leftLaser.scale.set(scale, scale, scale); // Scale laser mesh
    scene.add(leftLaser);
    
    // Right Cannon local offset, scaled
    const rightOffset = new THREE.Vector3(2.8 * scale, state.gameMode === '3D' ? -0.1 : 0, -0.5 * scale);
    rightOffset.applyAxisAngle(upAxis, shipYaw);
    
    const rightLaser = new THREE.Mesh(laserGeom, laserMat);
    rightLaser.position.copy(shipPos).add(rightOffset);
    rightLaser.rotation.y = shipYaw;
    rightLaser.scale.set(scale, scale, scale); // Scale laser mesh
    scene.add(rightLaser);

    // Spread slightly outward in LV3 and LV4
    const spreadX = state.weaponLevel >= 3 ? 6.0 : 0.0;
    
    const leftVelocity = new THREE.Vector3(-spreadX, 0, -GAME_CONFIG.laser.speed);
    leftVelocity.applyAxisAngle(upAxis, shipYaw);
    
    const rightVelocity = new THREE.Vector3(spreadX, 0, -GAME_CONFIG.laser.speed);
    rightVelocity.applyAxisAngle(upAxis, shipYaw);

    lasers.push({
      mesh: leftLaser,
      velocity: leftVelocity
    });
    lasers.push({
      mesh: rightLaser,
      velocity: rightVelocity
    });
  }

  // Level 4: Spawn 2 homing missiles from outer wings
  if (state.weaponLevel === 4) {
    const leftWingOffset = new THREE.Vector3(-3.8 * scale, state.gameMode === '3D' ? -0.15 : 0, 0);
    leftWingOffset.applyAxisAngle(upAxis, shipYaw);
    
    const rightWingOffset = new THREE.Vector3(3.8 * scale, state.gameMode === '3D' ? -0.15 : 0, 0);
    rightWingOffset.applyAxisAngle(upAxis, shipYaw);
    
    spawnHomingMissile(shipPos.clone().add(leftWingOffset), shipYaw, -1);
  }
}

// ==========================================================================
// HOMING MISSILE SYSTEMS
// ==========================================================================
function spawnHomingMissile(position, yaw, side) {
  const mesh = createMissileMesh();
  mesh.position.copy(position);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  
  // Initial velocity: slightly forward and outward
  const speed = 40;
  const upAxis = new THREE.Vector3(0, 1, 0);
  const localDir = new THREE.Vector3(side * 0.5, 0, -1).normalize();
  const velocity = localDir.applyAxisAngle(upAxis, yaw).multiplyScalar(speed);
  
  missiles.push({
    mesh: mesh,
    velocity: velocity,
    speed: speed,
    life: 3.5 // max 3.5 seconds lifetime
  });
}

function createMissileMesh() {
  const group = new THREE.Group();
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;
  
  // Cylinder body
  const bodyGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.8, 6);
  bodyGeo.rotateX(Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 0.7, roughness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);
  
  // Red tip
  const tipGeo = new THREE.ConeGeometry(0.18, 0.5, 6);
  tipGeo.rotateX(Math.PI / 2);
  tipGeo.translate(0, 0, -1.15); // front
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  group.add(tip);
  
  // Fins
  const finGeo = new THREE.BoxGeometry(0.7, 0.08, 0.3);
  finGeo.translate(0, 0, 0.75); // back
  const finMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
  const fin1 = new THREE.Mesh(finGeo, finMat);
  group.add(fin1);
  
  const fin2 = fin1.clone();
  fin2.rotation.z = Math.PI / 2;
  group.add(fin2);

  group.scale.set(scale, scale, scale);
  
  return group;
}

function spawnMissileTrail(missilePos, missileDir) {
  if (Math.random() > 0.45) return; // limit trail density
  
  const is2D = state.gameMode === '2D';
  const scale = is2D ? 0.6 : 1.0;
  const size = (0.2 + Math.random() * 0.25) * scale;
  const geom = new THREE.BoxGeometry(size, size, size);
  
  // Glowing yellow-orange exhaust trail
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });
  
  const trailParticle = new THREE.Mesh(geom, mat);
  trailParticle.position.copy(missilePos).add(new THREE.Vector3(
    (Math.random() - 0.5) * 0.25 * scale,
    (Math.random() - 0.5) * 0.25 * scale,
    0
  ));
  
  scene.add(trailParticle);
  
  // Blow trail opposite to missile velocity direction
  const blowSpeed = 12 + Math.random() * 8;
  const velocity = new THREE.Vector3().copy(missileDir).normalize().multiplyScalar(-blowSpeed);
  
  engineFlameParticles.push({
    mesh: trailParticle,
    spinSpeed: {
      x: Math.random() * 6,
      y: Math.random() * 6,
      z: Math.random() * 6
    },
    velocity: velocity,
    life: 0.0,
    maxLife: 0.32
  });
}

function updateMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const missile = missiles[i];
    
    // Find closest target (either Boss or closest Drone/Asteroid)
    let target = null;
    let minDist = Infinity;
    
    if (state.bossActive && bossGroup) {
      const dist = missile.mesh.position.distanceTo(bossGroup.position);
      target = bossGroup;
      minDist = dist;
    } else {
      enemies.forEach(e => {
        const dist = missile.mesh.position.distanceTo(e.mesh.position);
        if (dist < minDist) {
          minDist = dist;
          target = e.mesh;
        }
      });
    }
    
    // Adjust velocity toward target (Homing steering)
    if (target) {
      const targetDir = new THREE.Vector3().subVectors(target.position, missile.mesh.position).normalize();
      const steerFactor = 5.2 * dt; // Steering responsiveness
      
      missile.velocity.lerp(targetDir.multiplyScalar(missile.speed), steerFactor);
      missile.velocity.normalize().multiplyScalar(missile.speed);
    }
    
    // Move relative to camera lock (synchronize with player speed)
    const relVelocity = new THREE.Vector3().copy(missile.velocity).addScaledVector(state.velocity, -1);
    missile.mesh.position.addScaledVector(relVelocity, dt);
    
    // Orient missile to face its trajectory direction
    if (missile.velocity.lengthSq() > 0.01) {
      const lookTarget = missile.mesh.position.clone().add(missile.velocity);
      missile.mesh.lookAt(lookTarget);
    }
    
    // Spawn fire smoke trails from missile tail
    spawnMissileTrail(missile.mesh.position, missile.velocity);
    
    let exploded = false;
    
    // Collision checking: Boss
    if (state.bossActive && bossGroup && missile.mesh.position.distanceTo(bossGroup.position) < 6) {
      state.bossHP -= 4; // High missile damage
      addScore(100);
      triggerScreenFlash('rgba(255, 100, 0, 0.12)', 80);
      
      const bb = dom.bossBar;
      if (bb) bb.style.width = `${(state.bossHP / state.bossMaxHP) * 100}%`;
      
      if (state.bossHP <= 0) {
        spawnExplosion(bossGroup.position, 0xff6600, 120);
        spawnExplosion(bossGroup.position, 0xffaa00, 80);
        playExplosionSound();
        triggerScreenFlash('rgba(255, 200, 0, 0.4)', 800);
        scene.remove(bossGroup);
        bossGroup = null;
        state.bossActive = false;
        const bm = dom.bossMeter;
        if (bm) bm.style.display = 'none';
        setTimeout(() => stageClear(), 1500);
      }
      
      exploded = true;
    } 
    // Collision checking: Normal Enemies
    else {
      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const enemy = enemies[ei];
        if (missile.mesh.position.distanceTo(enemy.mesh.position) < enemy.radius + 1.2) {
          enemy.hp -= 4; // High missile damage
          triggerScreenFlash('rgba(255, 255, 255, 0.15)', 80);
          
          if (enemy.hp <= 0) {
            spawnExplosion(enemy.mesh.position, enemy.type === 'ASTEROID' ? 0xffaa00 : 0x00ffff, enemy.type === 'ASTEROID' ? 30 : 15);
            playExplosionSound();
            scene.remove(enemy.mesh);
            enemies.splice(ei, 1);
            state.kills++;
            
            const scoreGained = enemy.type === 'ASTEROID' ? 100 : 250;
            addScore(scoreGained);
            
            if (!state.bossActive && state.kills >= state.killsForBoss) {
              setTimeout(() => spawnBoss(), 1000);
            }
          }
          exploded = true;
          break;
        }
      }
    }
    
    missile.life -= dt;
    if (exploded || missile.life <= 0 || missile.mesh.position.z < -300 || missile.mesh.position.z > 50) {
      spawnExplosion(missile.mesh.position, 0xff3300, 15);
      scene.remove(missile.mesh);
      missiles.splice(i, 1);
    }
  }
}

function triggerScreenFlash(colorRGBA, durationMs) {
  const flash = dom.damageFlashLayer;
  if (!flash) return;
  
  flash.style.display = 'block';
  flash.style.backgroundColor = colorRGBA;
  flash.style.transition = 'none';
  flash.style.opacity = '1';
  
  // Force browser layout reflow
  flash.offsetHeight;
  
  flash.style.transition = `background-color ${durationMs}ms ease-out, opacity ${durationMs}ms ease-out`;
  flash.style.backgroundColor = 'rgba(0,0,0,0)';
  flash.style.opacity = '0';
  
  setTimeout(() => {
    if (flash.style.opacity === '0') {
      flash.style.display = 'none';
    }
  }, durationMs);
}

function damagePlayer(amount) {
  if (state.mode !== 'PLAYING' || state.invincible) return;

  // Set invincibility on hit (1.2 seconds)
  state.invincible = true;
  state.invincibleTime = 1.2;

  state.shield = Math.max(0, state.shield - amount);
  playDamageSound();
  
  // Flash Screen UI Red
  triggerScreenFlash('rgba(255, 0, 85, 0.35)', 250);

  // Camera Shake (Respects mode dimensions)
  const baseCamX = camera.position.x;
  const baseCamY = camera.position.y;
  const baseCamZ = camera.position.z;

  const shakeTimer = setInterval(() => {
    if (state.gameMode === '3D') {
      camera.position.x = baseCamX + (Math.random() - 0.5) * 0.8;
      camera.position.y = baseCamY + (Math.random() - 0.5) * 0.8;
    } else {
      camera.position.x = baseCamX + (Math.random() - 0.5) * 0.8;
      camera.position.z = baseCamZ + (Math.random() - 0.5) * 0.8;
    }
  }, 30);

  setTimeout(() => {
    clearInterval(shakeTimer);
    // Restore exact pre-shake positions to prevent camera jumps/teleportation in XZ space
    camera.position.set(baseCamX, baseCamY, baseCamZ);
  }, 250);

  // Downgrade weapon level on hit (adds risk/reward)
  if (state.weaponLevel > 1) {
    state.weaponLevel--;
  }

  updateHUD();

  if (state.shield <= 0) {
    gameOver();
  }
}

function collectPowerup(itemType) {
  playPowerUpSound();
  
  if (itemType === 'SHIELD') {
    state.shield = Math.min(state.maxShield, state.shield + 70);
    addScore(150);
    triggerScreenFlash('rgba(57, 255, 20, 0.15)', 200); // Shiny green flash on recovery
  } else if (itemType === 'WEAPON') {
    state.weaponLevel = Math.min(4, state.weaponLevel + 1);
    addScore(250);
    triggerScreenFlash('rgba(255, 234, 0, 0.15)', 200); // Cyber yellow flash on weapon upgrade
  }
  updateHUD();
}

function addScore(amount) {
  state.score += amount;
  
  // Increase difficulty multiplier slowly based on score
  state.difficultyMultiplier = 1.0 + (state.score / 15000);
  
  updateHUD();
}

// ==========================================================================
// UI & LIFE CYCLE ENGINE
// ==========================================================================
function updateHUD() {
  // Score display padding
  dom.hudScore.textContent = String(state.score).padStart(6, '0');
  
  // Shield percentage and styling warning class
  const shieldPct = (state.shield / state.maxShield) * 100;
  dom.hudShieldBar.style.width = `${shieldPct}%`;
  
  if (shieldPct <= 30) {
    dom.hudShieldBar.classList.add('warning');
  } else {
    dom.hudShieldBar.classList.remove('warning');
  }

  // Weapon Level string
  let wName = "LASER LV1";
  let dotColor = '#ffea00';
  if (state.weaponLevel === 2) {
    wName = "DUAL BLASTER";
    dotColor = '#ffea00';
  } else if (state.weaponLevel === 3) {
    wName = "TRIP-BOLT STRIKER";
    dotColor = '#39ff14';
  } else if (state.weaponLevel === 4) {
    wName = "HYPER METEOR STORM";
    dotColor = '#ff007f';
  }
  
  dom.hudWeaponType.textContent = wName;
  dom.weaponStatusDot.style.backgroundColor = dotColor;
  dom.weaponStatusDot.style.boxShadow = `0 0 10px ${dotColor}`;
}

/**
 * Return to Title Screen Menu and clean up active gameplay
 */
function returnToTitle() {
  state.mode = 'TITLE';
  
  // Canvas must NOT block title screen buttons
  renderer.domElement.style.pointerEvents = 'none';
  
  // Toggle UI visibility
  dom.hud.classList.remove('active');
  dom.gameoverScreen.classList.remove('active');
  dom.gameoverScreen.style.pointerEvents = '';
  dom.titleScreen.classList.add('active');
  dom.titleScreen.style.pointerEvents = 'auto'; // ensure buttons are always hittable
  
  // Reset HUD Score and weapon type strings
  dom.titleHighScore.textContent = String(state.highScore).padStart(6, '0');

  // Reset Camera to menu default view
  cameraIntro.active = false;
  camera.position.set(0, 0, 15);
  camera.rotation.set(0, 0, 0);
  camera.quaternion.set(0, 0, 0, 1);

  // Clean up WebGL game models
  cleanupGameplay();
}

/**
 * Dispose geometries and materials to avoid Three.js memory leaks
 */
function cleanupGameplay() {
  // Safe dispose helper — handles missing geometry/material and array materials
  const safeMeshDispose = (mesh) => {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.traverse(child => {
      if (!child.isMesh) return;
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m && m.dispose && m.dispose());
        } else if (child.material.dispose) {
          child.material.dispose();
        }
      }
    });
  };

  // Clear enemies
  enemies.forEach(e => safeMeshDispose(e.mesh));
  enemies.length = 0;
  
  // Clear lasers
  lasers.forEach(l => safeMeshDispose(l.mesh));
  lasers.length = 0;
  
  // Clear missiles
  missiles.forEach(m => safeMeshDispose(m.mesh));
  missiles.length = 0;
  
  // Clear projectiles
  enemyProjectiles.forEach(p => safeMeshDispose(p.mesh));
  enemyProjectiles.length = 0;
  
  // Clear items
  items.forEach(item => safeMeshDispose(item.mesh));
  items.length = 0;
  
  // Clear explosions
  explosions.forEach(exp => {
    if (!exp.points) return;
    scene.remove(exp.points);
    if (exp.points.geometry) exp.points.geometry.dispose();
    if (exp.points.material) exp.points.material.dispose();
  });
  explosions.length = 0;

  // Clear player ship
  if (playerGroup) {
    safeMeshDispose(playerGroup);
    playerGroup = null;
  }
  
  // Reset engine flame particles
  engineFlameParticles.forEach(p => safeMeshDispose(p.mesh));
  engineFlameParticles = [];
  
  playerEngineLight = null;

  // Remove boss if present
  if (bossGroup) {
    safeMeshDispose(bossGroup);
    bossGroup = null;
  }
  state.bossActive = false;

  // Hide boss Lock-on HUD and alert overlays
  const bl = dom.bossLockon;
  if (bl) bl.style.display = 'none';
  const bao = dom.bossAlertOverlay;
  if (bao) bao.style.display = 'none';
}

function startGame(mode = '3D') {
  console.log("startGame: Launching game in mode: " + mode);
  
  // Reset ALL input state so nothing carries over from previous session
  pointerControl.active = false;
  Object.keys(keys).forEach(k => { keys[k] = false; });
  
  // Enable canvas pointer events now that we're playing
  renderer.domElement.style.pointerEvents = 'auto';
  
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  state.mode = 'PLAYING';
  state.gameMode = mode;
  state.score = 0;
  state.kills = 0;
  state.shield = state.maxShield;
  state.weaponLevel = 1;
  state.invincible = false;
  state.invincibleTime = 0;
  state.timeElapsed = 0;
  state.difficultyMultiplier = Math.max(1.0, 1.0 + (state.stage - 1) * 0.3);

  // Reset boss state
  state.bossActive = false;
  state.bossHP = 0;
  bossGroup = null;
  const bm = dom.bossMeter;
  if (bm) bm.style.display = 'none';
  
  updateHUD();

  // Unified cleanup of scene before starting
  cleanupGameplay();

  // Create new Player Ship
  playerGroup = createPlayerShip();

  // Camera Cinematic Intro setup
  cameraIntro.active = true;
  cameraIntro.timer = 0;

  if (state.gameMode === '3D') {
    scene.fog = new THREE.FogExp2(0x89c7f2, 0.0035);
    
    // Start camera far away and high up
    cameraIntro.startPos.set(0, 22, 50);
    cameraIntro.endPos.set(0, 0, 15);
    
    camera.position.copy(cameraIntro.startPos);
    playerGroup.position.set(0, 0, 15); // Start far back to glide in
    playerGroup.scale.set(1.0, 1.0, 1.0); // Full size in 3D
  } else {
    // 2D Top-Down Mode
    scene.fog = null;
    
    // Start camera high up in orbit
    cameraIntro.startPos.set(0, 95, 20);
    cameraIntro.endPos.set(0, 42, -5);
    
    camera.position.copy(cameraIntro.startPos);
    playerGroup.position.set(0, 0, 15); // Start far back to glide in
    playerGroup.scale.set(0.6, 0.6, 0.6); // Compact size in 2D
  }
  
  playerGroup.rotation.set(0, 0, 0);
  scene.add(playerGroup);

  // Transitions UI
  dom.titleScreen.classList.remove('active');
  dom.gameoverScreen.classList.remove('active');
  dom.hud.classList.add('active');

  // Short cool transition
  let rollStart = 0;
  const launchAnim = () => {
    if (state.mode !== 'PLAYING') return;
    rollStart += 0.15;
    if (rollStart < Math.PI * 2) {
      if (state.gameMode === '3D') {
        playerGroup.rotation.z = rollStart;
      } else {
        playerGroup.rotation.y = rollStart;
      }
      requestAnimationFrame(launchAnim);
    } else {
      playerGroup.rotation.set(0, 0, 0);
    }
  };
  launchAnim();

  // Re-align stars based on mode
  resetStarfieldForMode();
}

function resetStarfieldForMode() {
  if (!starGeometry) return;
  const posArr = starGeometry.attributes.position.array;
  const count = GAME_CONFIG.starfield.count;

  for (let i = 0; i < count; i++) {
    if (state.gameMode === '3D') {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * 90;
      posArr[i * 3] = Math.cos(angle) * radius;
      posArr[i * 3 + 1] = Math.sin(angle) * radius;
      posArr[i * 3 + 2] = -Math.random() * GAME_CONFIG.starfield.depth;
    } else {
      // 2D Mode: Distribute stars on a flat plane below the player (Y = -15)
      posArr[i * 3] = (Math.random() - 0.5) * 80;
      posArr[i * 3 + 1] = -15; // Flat plane below gameplay
      posArr[i * 3 + 2] = -Math.random() * GAME_CONFIG.starfield.depth;
    }
  }
  starGeometry.attributes.position.needsUpdate = true;
}

function gameOver() {
  state.mode = 'GAMEOVER';
  state.currentSpeed = 0;
  state.velocity.set(0, 0, 0);
  
  // Aggressively release ALL input captures so UI buttons become clickable immediately
  pointerControl.active = false;
  keys.Space = false;
  // Clear every tracked key so nothing is "stuck"
  Object.keys(keys).forEach(k => { keys[k] = false; });
  
  // Canvas must NOT block gameover screen buttons
  renderer.domElement.style.pointerEvents = 'none';
  
  playGameOverSound();
  
  // Register Highscore
  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem('neon_starfighter_high', state.highScore);
  }

  // Large firey explosion at player death
  spawnExplosion(playerGroup.position, 0xff0055, 75);
  scene.remove(playerGroup);

  // Update Game Over Result HUD
  dom.gameoverScore.textContent = String(state.score).padStart(6, '0');
  dom.gameoverKills.textContent = state.kills;
  dom.gameoverHighScore.textContent = String(state.highScore).padStart(6, '0');

  // UI State toggling — directly force pointer-events so nothing can block buttons
  dom.hud.classList.remove('active');
  dom.gameoverScreen.classList.add('active');
  // Explicitly force the overlay to intercept events (overrides any stale CSS state)
  dom.gameoverScreen.style.pointerEvents = 'auto';
}

// ==========================================================================
// KEYBOARD CONTROLLER & MOUSE BINDINGS
// ==========================================================================
function setupControls() {
  // Keyboard Listeners
  window.addEventListener('keydown', (e) => {
    let key = e.key;
    if (key === ' ') key = 'Space';
    
    if (key in keys) {
      keys[key] = true;
      e.preventDefault(); // Stop scrolling with arrows/space
    }

    if (e.key === 'Enter') {
      if (state.mode === 'TITLE' || state.mode === 'GAMEOVER') {
        startGame(state.gameMode || '3D');
      }
    }

    // DEBUG KEY: Press 'B' during game to instantly spawn boss (or teleport boss) 350m away
    if (e.key === 'b' || e.key === 'B') {
      if (state.mode === 'PLAYING') {
        e.preventDefault();
        if (!state.bossActive && playerGroup) {
          console.log("DEBUG: Spawning boss instantly 350m away!");
          state.bossActive = true;
          state.bossHP = state.bossMaxHP;
          bossGroup = createBossMesh();
          const yaw = playerGroup.rotation.y;
          bossGroup.position.set(
            playerGroup.position.x - Math.sin(yaw) * 350,
            playerGroup.position.y + 5,
            playerGroup.position.z - Math.cos(yaw) * 350
          );
          scene.add(bossGroup);
          
          const bm = dom.bossMeter;
          if (bm) bm.style.display = 'flex';
          
          const bao = dom.bossAlertOverlay;
          if (bao) {
            bao.style.display = 'flex';
            setTimeout(() => {
              bao.style.display = 'none';
            }, 3500);
          }
        } else if (state.bossActive && bossGroup && playerGroup) {
          console.log("DEBUG: Teleporting boss 350m away!");
          const yaw = playerGroup.rotation.y;
          bossGroup.position.set(
            playerGroup.position.x - Math.sin(yaw) * 350,
            playerGroup.position.y + 5,
            playerGroup.position.z - Math.cos(yaw) * 350
          );
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    let key = e.key;
    if (key === ' ') key = 'Space';
    
    if (key in keys) {
      keys[key] = false;
    }
  });

  // Unified Pointer (Mouse/Touch) Controls for Mobile & Desktop Drag-to-Move
  const handlePointerDown = (e) => {
    if (state.mode !== 'PLAYING' || cameraIntro.active) return;
    // Never intercept clicks on any HTML UI element (buttons, panels, overlays)
    if (e.target.tagName === 'BUTTON') return;
    if (e.target.closest('button, .menu-panel, .screen-overlay, #hud, #hud-speed-panel')) return;
    
    initAudio();
    pointerControl.active = true;
    keys.Space = true; // Auto-fire while dragging
    updatePointerTarget(e);
  };

  const handlePointerMove = (e) => {
    if (!pointerControl.active) return;
    updatePointerTarget(e);
  };

  const handlePointerUp = () => {
    pointerControl.active = false;
    keys.Space = false;
  };

  function updatePointerTarget(e) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    
    pointerControl.targetX = nx * GAME_CONFIG.player.rangeX * 1.35;
    if (state.gameMode === '3D') {
      // Use rangeZ instead of the deleted rangeY to prevent NaN errors
      pointerControl.targetY = ny * GAME_CONFIG.player.rangeZ * 1.25;
    } else {
      // Map vertical screen coordinate ny [-1, 1] to Z bounds [-25, 8]
      pointerControl.targetY = ny * 16.5 - 8.5;
    }
  }

  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);

  // Helper to bind buttons reliably.
  const bindTactileButton = (btnElement, action) => {
    if (!btnElement) return;

    let lastFired = 0;

    const fire = () => {
      const now = Date.now();
      if (now - lastFired < 500) return; // per-button debounce
      lastFired = now;
      // Release all game input captures before switching screens
      pointerControl.active = false;
      Object.keys(keys).forEach(k => { keys[k] = false; });
      action();
    };

    // touchstart fires immediately on mobile (prevents 300ms click delay)
    btnElement.addEventListener('touchstart', (e) => {
      e.preventDefault(); // prevent synthesized mouse click from also firing
      fire();
    }, { passive: false });

    // click handles desktop mouse and keyboard activation (Tab+Enter)
    btnElement.addEventListener('click', fire);
  };

  // Keyboard shortcut: Enter key restarts/launches from gameover or title screen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' && state.mode !== 'PLAYING') {
      if (state.mode === 'GAMEOVER') {
        e.preventDefault();
        pointerControl.active = false;
        keys.Space = false;
        startGame(state.gameMode);
      } else if (state.mode === 'TITLE') {
        e.preventDefault();
        pointerControl.active = false;
        startGame('3D');
      }
    }
  });

  // Screen interactive click buttons
  bindTactileButton(dom.btnStart3d, () => startGame('3D'));
  bindTactileButton(dom.btnStart2d, () => startGame('2D'));
  bindTactileButton(dom.btnRestart3d, () => startGame('3D'));
  bindTactileButton(dom.btnRestart2d, () => startGame('2D'));
  bindTactileButton(dom.btnGameOverTitle, () => returnToTitle());
  bindTactileButton(dom.btnHudTitle, () => returnToTitle());
  bindTactileButton(document.getElementById('btn-next-stage'), () => nextStage());
  bindTactileButton(document.getElementById('btn-stageclear-title'), () => {
    const sc = dom.stageClearScreen;
    if (sc) { sc.classList.remove('active'); sc.style.pointerEvents = ''; }
    returnToTitle();
  });

  // Display highscore on Title Screen initially
  dom.titleHighScore.textContent = String(state.highScore).padStart(6, '0');
}

/**
 * Update the HTML/CSS Speedometer HUD
 */
// ==========================================================================
// BOSS SYSTEM
// ==========================================================================
function createBossMesh() {
  const group = new THREE.Group();

  // Core body — big dark sphere
  const bodyGeo = new THREE.SphereGeometry(4.5, 16, 16);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a0030, roughness: 0.4, metalness: 0.9 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Glowing red eye
  const eyeGeo = new THREE.SphereGeometry(1.2, 12, 12);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.z = -4;
  group.add(eye);

  // Ring 1
  const ring1Geo = new THREE.TorusGeometry(6.5, 0.4, 8, 48);
  const ring1Mat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
  const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
  ring1.rotation.x = Math.PI / 2;
  group.add(ring1);

  // Ring 2 (tilted)
  const ring2Geo = new THREE.TorusGeometry(7.5, 0.25, 8, 48);
  const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
  ring2.rotation.x = Math.PI / 3;
  ring2.rotation.z = Math.PI / 5;
  group.add(ring2);

  // Point light for dramatic glow
  const bossLight = new THREE.PointLight(0xff2200, 4, 40);
  group.add(bossLight);

  group.userData.ringSpeed1 = 1.2;
  group.userData.ringSpeed2 = -0.8;
  group.userData.ring1 = ring1;
  group.userData.ring2 = ring2;
  group.userData.eye = eye;
  group.userData.orbitAngle = 0;
  group.userData.orbitRadius = 80;
  group.userData.orbitSpeed = 0.4;
  group.userData.verticalBob = 0;

  return group;
}

function spawnBoss() {
  if (state.bossActive || !playerGroup) return;
  state.bossActive = true;
  state.bossHP = state.bossMaxHP;

  bossGroup = createBossMesh();
  // Spawn ahead of player
  const yaw = playerGroup.rotation.y;
  bossGroup.position.set(
    playerGroup.position.x - Math.sin(yaw) * 120,
    playerGroup.position.y + 5,
    playerGroup.position.z - Math.cos(yaw) * 120
  );
  scene.add(bossGroup);

  // Show boss HP bar
  const bm = dom.bossMeter;
  if (bm) bm.style.display = 'flex';

  // Dramatic flash and siren warning overlay
  triggerScreenFlash('rgba(255, 0, 0, 0.25)', 600);

  const bao = dom.bossAlertOverlay;
  if (bao) {
    bao.style.display = 'flex';
    setTimeout(() => {
      bao.style.display = 'none';
    }, 3500);
  }
}

function updateBoss(dt) {
  if (!state.bossActive || !bossGroup || !playerGroup) return;

  // Spin rings
  bossGroup.userData.ring1.rotation.z += bossGroup.userData.ringSpeed1 * dt;
  bossGroup.userData.ring2.rotation.y += bossGroup.userData.ringSpeed2 * dt;

  // Orbit around player in XZ plane
  bossGroup.userData.orbitAngle += bossGroup.userData.orbitSpeed * dt;
  const angle = bossGroup.userData.orbitAngle;
  const r = bossGroup.userData.orbitRadius;
  const targetX = playerGroup.position.x + Math.cos(angle) * r;
  const targetZ = playerGroup.position.z + Math.sin(angle) * r;
  bossGroup.userData.verticalBob += dt;
  const targetY = playerGroup.position.y + 5 + Math.sin(bossGroup.userData.verticalBob * 0.8) * 8;

  bossGroup.position.x = THREE.MathUtils.lerp(bossGroup.position.x, targetX, 1.5 * dt);
  bossGroup.position.z = THREE.MathUtils.lerp(bossGroup.position.z, targetZ, 1.5 * dt);
  bossGroup.position.y = THREE.MathUtils.lerp(bossGroup.position.y, targetY, 1.5 * dt);

  // Always face the player
  bossGroup.lookAt(playerGroup.position);

  // Boss state and enrage handling (HP <= 50%)
  const isEnraged = state.bossHP <= state.bossMaxHP * 0.5;
  if (isEnraged && !bossGroup.userData.enraged) {
    bossGroup.userData.enraged = true;
    triggerScreenFlash('rgba(255, 0, 120, 0.35)', 600);
    playPowerUpSound(); // Trigger warning chime
  }

  // Enraged visual effect (red glowing pulse on body + magenta eye)
  if (isEnraged) {
    const pulse = Math.abs(Math.sin(performance.now() * 0.008));
    const bodyMesh = bossGroup.children[0];
    if (bodyMesh && bodyMesh.material) {
      if (!bodyMesh.material.emissive) {
        bodyMesh.material.emissive = new THREE.Color(0x000000);
      }
      bodyMesh.material.emissive.setRGB(pulse * 0.45, 0, 0);
    }
    const eyeMesh = bossGroup.userData.eye;
    if (eyeMesh && eyeMesh.material) {
      eyeMesh.material.color.setHex(0xff00ff);
    }
  }

  // Boss periodically fires at player
  if (!bossGroup.userData.lastShot) bossGroup.userData.lastShot = 0;
  const now = performance.now();
  
  // Enraged boss shoots 40% faster
  const baseFireRate = Math.max(800, 2000 - state.stage * 100);
  const bossFireRate = isEnraged ? baseFireRate * 0.6 : baseFireRate;
  
  if (now - bossGroup.userData.lastShot > bossFireRate) {
    bossGroup.userData.lastShot = now;
    
    if (isEnraged) {
      // 3-way spread pattern
      const baseDir = new THREE.Vector3().subVectors(playerGroup.position, bossGroup.position).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      
      // Center
      spawnEnemyProjectile(bossGroup.position.clone(), baseDir);
      // Left (yaw -15 deg)
      const leftDir = baseDir.clone().applyAxisAngle(up, -0.26);
      spawnEnemyProjectile(bossGroup.position.clone(), leftDir);
      // Right (yaw +15 deg)
      const rightDir = baseDir.clone().applyAxisAngle(up, 0.26);
      spawnEnemyProjectile(bossGroup.position.clone(), rightDir);
    } else {
      // Standard target shot
      spawnEnemyProjectile(bossGroup.position.clone());
      if (state.stage >= 3) {
        // Extra shot on higher stages with a small delay
        setTimeout(() => {
          if (state.bossActive && bossGroup) {
            spawnEnemyProjectile(bossGroup.position.clone());
          }
        }, 250);
      }
    }
  }

  // Check laser hits on boss
  for (let li = lasers.length - 1; li >= 0; li--) {
    const laser = lasers[li];
    if (laser.mesh.position.distanceTo(bossGroup.position) < 6) {
      state.bossHP--;
      addScore(50);
      triggerScreenFlash('rgba(255, 100, 0, 0.1)', 80);

      // Update boss bar
      const bb = dom.bossBar;
      if (bb) bb.style.width = `${(state.bossHP / state.bossMaxHP) * 100}%`;

      // Remove laser
      scene.remove(laser.mesh);
      lasers.splice(li, 1);

      if (state.bossHP <= 0) {
        // Boss defeated!
        spawnExplosion(bossGroup.position, 0xff6600, 120);
        spawnExplosion(bossGroup.position, 0xffaa00, 80);
        playExplosionSound();
        triggerScreenFlash('rgba(255, 200, 0, 0.4)', 800);
        scene.remove(bossGroup);
        bossGroup = null;
        state.bossActive = false;
        const bm = dom.bossMeter;
        if (bm) bm.style.display = 'none';
        setTimeout(() => stageClear(), 1500);
      }
      break;
    }
  }

  // Player–boss collision damage
  if (playerGroup && bossGroup && bossGroup.position.distanceTo(playerGroup.position) < 7) {
    takeDamage(15);
  }
}

function stageClear() {
  state.mode = 'STAGECLEAR';
  renderer.domElement.style.pointerEvents = 'none';

  const sc = dom.stageClearScreen;
  const st = dom.stageClearStage;
  if (sc) {
    if (st) st.textContent = `STAGE ${state.stage} COMPLETE`;
    sc.classList.add('active');
    sc.style.pointerEvents = 'auto';
  }
  dom.hud.classList.remove('active');
}

function nextStage() {
  state.stage++;
  state.killsForBoss = 8 + (state.stage - 1) * 4;  // more kills needed each stage
  state.bossMaxHP = 30 + (state.stage - 1) * 10;      // boss gets harder
  state.difficultyMultiplier = 1.0 + (state.stage - 1) * 0.3;

  const sc = dom.stageClearScreen;
  if (sc) { sc.classList.remove('active'); sc.style.pointerEvents = ''; }

  startGame(state.gameMode);
}

// ==========================================================================
// RADAR
// ==========================================================================
function initRadar() {
  radarCanvas = dom.radarCanvas;
  if (radarCanvas) radarCtx = radarCanvas.getContext('2d');
}

function drawRadar() {
  if (!radarCtx || !radarCanvas || state.mode !== 'PLAYING') return;
  if (!playerGroup) return;

  const W = radarCanvas.width;
  const H = radarCanvas.height;
  const cx = W / 2, cy = H / 2;
  const range = 270;
  const canvasScale = W / 160; // Scaling multiplier for drawings (originally sized for 160px)

  radarCtx.clearRect(0, 0, W, H);

  // Clip to circle
  radarCtx.save();
  radarCtx.beginPath();
  radarCtx.arc(cx, cy, cx - 4, 0, Math.PI * 2);
  radarCtx.clip();

  // Background
  radarCtx.fillStyle = 'rgba(0, 12, 6, 0.9)';
  radarCtx.fillRect(0, 0, W, H);

  // Grid rings (concentric circles)
  radarCtx.strokeStyle = 'rgba(0, 255, 100, 0.15)';
  radarCtx.lineWidth = 1 * canvasScale;
  [0.33, 0.66, 1.0].forEach(r => {
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, (cx - 4) * r, 0, Math.PI * 2);
    radarCtx.stroke();
  });

  // Draw range helper labels (thin HUD text)
  radarCtx.fillStyle = 'rgba(0, 255, 100, 0.35)';
  radarCtx.font = `${5 * canvasScale}px 'Orbitron', monospace`;
  radarCtx.textAlign = 'center';
  radarCtx.fillText('90m', cx, cy - (cx - 4) * 0.33 + (2 * canvasScale));
  radarCtx.fillText('180m', cx, cy - (cx - 4) * 0.66 + (2 * canvasScale));
  radarCtx.fillText('270m', cx, cy - (cx - 4) * 1.0 + (6 * canvasScale));

  // Cross-hairs (fixed vertical and horizontal grid lines)
  radarCtx.strokeStyle = 'rgba(0, 255, 100, 0.18)';
  radarCtx.lineWidth = 1 * canvasScale;
  radarCtx.beginPath();
  radarCtx.moveTo(cx, 4); radarCtx.lineTo(cx, H - 4);
  radarCtx.moveTo(4, cy); radarCtx.lineTo(W - 4, cy);
  radarCtx.stroke();

  // Rotating scanner sweep line (cosmetic)
  const sweepAngle = (performance.now() / 1200) % (Math.PI * 2);
  radarCtx.save();
  radarCtx.globalAlpha = 0.18;
  radarCtx.fillStyle = 'rgba(0, 255, 80, 0.5)';
  radarCtx.beginPath();
  radarCtx.moveTo(cx, cy);
  radarCtx.arc(cx, cy, cx - 4, sweepAngle - 0.5, sweepAngle);
  radarCtx.closePath();
  radarCtx.fill();
  radarCtx.restore();

  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const pYaw = playerGroup.rotation.y;
  const scale = (cx - 8) / range;

  // Rotation matrices setup for Heading-up mode
  // We counter-rotate the world objects by the player's yaw
  const cos = Math.cos(pYaw);
  const sin = Math.sin(pYaw);

  const toRadar = (wx, wz) => {
    const dx = wx - px;
    const dz = wz - pz;
    // Rotate relative positions to match player's forward direction as UP (-Z)
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    return {
      x: cx + rx * scale,
      y: cy + rz * scale
    };
  };

  // Draw enemies (red dots)
  enemies.forEach(e => {
    const dist = Math.hypot(e.mesh.position.x - px, e.mesh.position.z - pz);
    if (dist > range) return;
    const { x, y } = toRadar(e.mesh.position.x, e.mesh.position.z);
    
    radarCtx.beginPath();
    radarCtx.arc(x, y, 1.5 * canvasScale, 0, Math.PI * 2);
    radarCtx.fillStyle = '#ff3333';
    radarCtx.shadowColor = '#ff0000';
    radarCtx.shadowBlur = 3 * canvasScale;
    radarCtx.fill();
    
    // Draw small directional tail for moving enemies
    if (e.velocity) {
      const velDir = new THREE.Vector3().copy(e.velocity).normalize();
      // Counter-rotate the enemy velocity direction too
      const rx = velDir.x * cos - velDir.z * sin;
      const rz = velDir.x * sin + velDir.z * cos;
      radarCtx.strokeStyle = 'rgba(255, 50, 50, 0.4)';
      radarCtx.lineWidth = 1 * canvasScale;
      radarCtx.beginPath();
      radarCtx.moveTo(x, y);
      radarCtx.lineTo(x + rx * 4 * canvasScale, y + rz * 4 * canvasScale);
      radarCtx.stroke();
    }
  });

  // Draw items (cyan glowing dots)
  items.forEach(item => {
    const dist = Math.hypot(item.mesh.position.x - px, item.mesh.position.z - pz);
    if (dist > range) return;
    const { x, y } = toRadar(item.mesh.position.x, item.mesh.position.z);
    
    radarCtx.beginPath();
    radarCtx.arc(x, y, 1.2 * canvasScale, 0, Math.PI * 2);
    radarCtx.fillStyle = '#00f0ff';
    radarCtx.shadowColor = '#00f0ff';
    radarCtx.shadowBlur = 2 * canvasScale;
    radarCtx.fill();
  });

  // Draw boss (large diamond in range)
  if (state.bossActive && bossGroup) {
    const dist = Math.hypot(bossGroup.position.x - px, bossGroup.position.z - pz);
    if (dist <= range) {
      const pos = toRadar(bossGroup.position.x, bossGroup.position.z);
      const blink = Math.sin(performance.now() / 150) > 0;
      
      radarCtx.save();
      radarCtx.translate(pos.x, pos.y);
      radarCtx.rotate(Math.PI / 4);
      radarCtx.fillStyle = blink ? '#ff007f' : '#ffea00';
      radarCtx.shadowColor = blink ? '#ff007f' : '#ffea00';
      radarCtx.shadowBlur = blink ? 16 * canvasScale : 6 * canvasScale;
      
      const dSize = 6 * canvasScale;
      radarCtx.fillRect(-dSize, -dSize, dSize * 2, dSize * 2);
      radarCtx.restore();
    }
  }

  // Draw player at center (pointing UP, rotate=0)
  radarCtx.save();
  radarCtx.translate(cx, cy);
  radarCtx.fillStyle = '#ffffff';
  radarCtx.shadowColor = '#88ffff';
  radarCtx.shadowBlur = 5 * canvasScale;
  
  radarCtx.beginPath();
  radarCtx.moveTo(0, -6 * canvasScale); // nose
  radarCtx.lineTo(-4 * canvasScale, 5 * canvasScale);
  radarCtx.lineTo(0, 2.5 * canvasScale);
  radarCtx.lineTo(4 * canvasScale, 5 * canvasScale);
  radarCtx.closePath();
  radarCtx.fill();
  
  // Outer thruster trail indicator on player icon
  if (state.currentSpeed > 0) {
    const speedRatio = state.currentSpeed / GAME_CONFIG.player.speed;
    radarCtx.fillStyle = '#ff007f';
    radarCtx.beginPath();
    radarCtx.moveTo(-2 * canvasScale, 4.5 * canvasScale);
    radarCtx.lineTo(0, (4.5 + 6 * speedRatio) * canvasScale);
    radarCtx.lineTo(2 * canvasScale, 4.5 * canvasScale);
    radarCtx.closePath();
    radarCtx.fill();
  }
  
  radarCtx.restore();

  radarCtx.restore(); // end clip

  // =========================================================
  // OUT OF RANGE BOSS INDICATOR (Drawn OUTSIDE the circular clip)
  // =========================================================
  if (state.bossActive && bossGroup) {
    const dist = Math.hypot(bossGroup.position.x - px, bossGroup.position.z - pz);
    if (dist > range) {
      const blink = Math.sin(performance.now() / 150) > 0;
      
      // Calculate angle in counter-rotated space
      const dx = bossGroup.position.x - px;
      const dz = bossGroup.position.z - pz;
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const angle = Math.atan2(rz, rx);
      
      // Position right on the circular radar border
      const x = cx + Math.cos(angle) * (cx - 4);
      const y = cy + Math.sin(angle) * (cx - 4);
      
      radarCtx.save();
      // Draw a pulsing caution triangle pointing toward the boss on the border
      const borderAngle = Math.atan2(y - cy, x - cx);
      radarCtx.translate(x, y);
      radarCtx.rotate(borderAngle + Math.PI / 2); // Rotate to point inward
      
      radarCtx.fillStyle = blink ? '#ff0033' : '#ffcc00';
      radarCtx.shadowColor = '#ff0000';
      radarCtx.shadowBlur = 10 * canvasScale;
      
      radarCtx.beginPath();
      // Triangle pointing inward (towards player)
      radarCtx.moveTo(0, -6 * canvasScale);
      radarCtx.lineTo(-5 * canvasScale, 4 * canvasScale);
      radarCtx.lineTo(5 * canvasScale, 4 * canvasScale);
      radarCtx.closePath();
      radarCtx.fill();
      
      // Distance text near the border arrow
      radarCtx.shadowBlur = 0;
      radarCtx.fillStyle = '#ffcc00';
      radarCtx.font = `bold ${6 * canvasScale}px 'Orbitron', monospace`;
      radarCtx.textAlign = 'center';
      
      // Rotate back text so numbers remain upright and readable
      radarCtx.rotate(-(borderAngle + Math.PI / 2));
      const textDist = Math.round(dist) + 'm';
      
      // Position text slightly offset from border arrow towards player
      const tx = -Math.cos(borderAngle) * 16 * canvasScale;
      const ty = -Math.sin(borderAngle) * 16 * canvasScale;
      radarCtx.fillText(textDist, tx, ty + (2 * canvasScale));
      radarCtx.restore();
    }
  }
}

function updateBossLockon() {
  const marker = dom.bossLockon;
  if (!marker) return;

  if (!state.bossActive || !bossGroup || !playerGroup || state.mode !== 'PLAYING') {
    marker.style.display = 'none';
    return;
  }

  // Project boss 3D position to screen coordinates
  const tempV = new THREE.Vector3().copy(bossGroup.position);
  tempV.project(camera);

  // Check if boss is behind the camera (tempV.z > 1)
  const isBehind = tempV.z > 1;

  // Convert normalized device coordinates [-1, 1] to screen pixels
  const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
  const y = (tempV.y * -0.5 + 0.5) * window.innerHeight;

  marker.style.display = 'block';

  // Compute actual distance between player and boss
  const distance = Math.round(playerGroup.position.distanceTo(bossGroup.position));

  if (isBehind) {
    // If target is behind camera, clamp marker to screen edge to guide player
    const angle = Math.atan2(y - window.innerHeight / 2, x - window.innerWidth / 2);
    const padding = 45;
    const borderX = window.innerWidth / 2 + Math.cos(angle) * (window.innerWidth / 2 - padding);
    const borderY = window.innerHeight / 2 + Math.sin(angle) * (window.innerHeight / 2 - padding);
    
    marker.style.left = `${borderX}px`;
    marker.style.top = `${borderY}px`;
    marker.classList.add('screen-edge');
    
    marker.innerHTML = `
      <div class="lockon-arrow" style="transform: rotate(${angle + Math.PI / 2}rad)"></div>
      <div class="lockon-label">BOSS ${distance}m</div>
    `;
  } else {
    // Screen bounds checking for clamp warning pointer
    const padding = 50;
    const isOffscreen = (x < padding || x > window.innerWidth - padding || y < padding || y > window.innerHeight - padding);
    
    const clampedX = Math.max(padding, Math.min(window.innerWidth - padding, x));
    const clampedY = Math.max(padding, Math.min(window.innerHeight - padding, y));
    
    marker.style.left = `${clampedX}px`;
    marker.style.top = `${clampedY}px`;
    
    if (isOffscreen) {
      marker.classList.add('screen-edge');
      const angle = Math.atan2(y - window.innerHeight / 2, x - window.innerWidth / 2);
      marker.innerHTML = `
        <div class="lockon-arrow" style="transform: rotate(${angle + Math.PI / 2}rad)"></div>
        <div class="lockon-label">BOSS ${distance}m</div>
      `;
    } else {
      marker.classList.remove('screen-edge');
      marker.innerHTML = `
        <div class="lockon-box">
          <div class="corner top-left"></div>
          <div class="corner top-right"></div>
          <div class="corner bottom-left"></div>
          <div class="corner bottom-right"></div>
          <div class="lockon-boss-label">TARGET LOCKED</div>
          <div class="lockon-boss-dist">${distance}m</div>
        </div>
      `;
    }
  }
}

function updateSpeedHud() {
  const bar = dom.hudSpeedBar;
  const text = dom.hudSpeedText;
  if (!bar || !text) return;

  const maxSpeed = GAME_CONFIG.player.speed;
  const ratio = state.currentSpeed / maxSpeed;
  const percentage = Math.round(ratio * 100);
  
  bar.style.width = `${percentage}%`;
  
  // Display speed in KM/H (simulating values for arcade feel)
  const kmh = Math.round(state.currentSpeed * 22);
  text.textContent = `${kmh} KM/H`;
}

// ==========================================================================
// CORE RECURSIVE RENDER LOOP
// ==========================================================================
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // Clamp delta time to avoid huge leaps
  
  if (state.mode === 'PLAYING') {
    // Invincibility countdown and blinking visual feedback
    if (state.invincible) {
      state.invincibleTime -= dt;
      if (state.invincibleTime <= 0) {
        state.invincible = false;
        state.invincibleTime = 0;
        if (playerGroup) {
          playerGroup.traverse(child => {
            if (child.isMesh) child.visible = true;
          });
        }
      } else {
        const blink = Math.sin(performance.now() * 0.02) > 0;
        if (playerGroup) {
          playerGroup.traverse(child => {
            if (child.isMesh) child.visible = blink;
          });
        }
      }
    }

    if (cameraIntro.active) {
      updateCameraIntro(dt);
      
      // Auto-glide ship forward from bottom during cinematic camera entrance
      if (playerGroup) {
        // Smoothly bring ship from starting Z position (15) to Z=0 position
        playerGroup.position.z = THREE.MathUtils.lerp(playerGroup.position.z, 0, 4 * dt);
        updateEngineFlame(dt, playerGroup.position);
      }
    } else {
      handlePlayerMovement(dt);
      
      if (keys.Space) {
        fireLaser();
      }
      
      spawnEnemy();

      // Auto-spawn boss after time limit even if player hasn't killed enough enemies
      if (!state.bossActive) {
        state.timeElapsed += dt;
        if (state.timeElapsed >= state.bossSpawnTimeLimit) {
          console.log(`Time limit reached (${state.bossSpawnTimeLimit}s). Spawning boss automatically.`);
          spawnBoss();
        }
      }
    }
  }

  // Universal Updates running regardless of game mode
  updateStarfield(dt);
  updateSpeedLines(dt);
  updateCamera(dt);
  updateLasers(dt);
  updateEnemies(dt);
  updateEnemyProjectiles(dt); // Run enemy bullet movements & hits
  updateItems(dt);
  updateExplosions(dt);
  updateMissiles(dt);
  updateBoss(dt);
  updateBossLockon();
  updateSpeedHud();
  drawRadar();

  // Render Scene
  renderer.render(scene, camera);

  // Expose debug hooks for automated tests
  window.gameDebug = {
    playerGroup,
    lasers,
    missiles,
    enemies,
    state,
    keys,
    damagePlayer
  };
}

/**
 * Handle smoothing movement of player based on buttons pressed
 */
function handlePlayerMovement(dt) {
  if (!playerGroup) return;

  let moveX = 0;
  let moveY = 0; // In 2D mode, this maps to Z axis movement

  if (pointerControl.active) {
    // POINTER/DRAG CONTROLS (for Mobile and Drag-to-Move)
    const lerpFactor = 7.0 * dt; // Smooth follow factor
    
    const targetX = Math.max(-GAME_CONFIG.player.rangeX, Math.min(GAME_CONFIG.player.rangeX, pointerControl.targetX));
    // Drag control operates on XZ plane for both 2D and 3D now
    const targetZ = Math.max(-GAME_CONFIG.player.rangeZ, Math.min(GAME_CONFIG.player.rangeZ, pointerControl.targetY));
    
    const newX = THREE.MathUtils.lerp(playerGroup.position.x, targetX, lerpFactor);
    const newZ = THREE.MathUtils.lerp(playerGroup.position.z, targetZ, lerpFactor);
    
    // Calculate movement vector direction for ship yaw facing angle
    const dx = newX - playerGroup.position.x;
    const dz = newZ - playerGroup.position.z;
    const moveLen = Math.sqrt(dx * dx + dz * dz);
    
    if (moveLen > 0.015) {
      // Point towards the finger/mouse drag direction smoothly
      const targetAngle = Math.atan2(-dx, -dz);
      playerGroup.rotation.y = THREE.MathUtils.lerp(playerGroup.rotation.y, targetAngle, 8.0 * dt);
    }
    
    // Set actual speed vector
    state.velocity.set(dx / (dt || 0.001), 0, dz / (dt || 0.001));

    moveX = dx / (GAME_CONFIG.player.speed * dt || 0.001);
    moveY = -dz / (GAME_CONFIG.player.speed * dt || 0.001);
    
    playerGroup.position.x = newX;
    playerGroup.position.z = newZ;
    playerGroup.position.y = 0;
    
    // Clamp simulated inputs for tilts
    moveX = Math.max(-1.0, Math.min(1.0, moveX));
    moveY = Math.max(-1.0, Math.min(1.0, moveY));
  } else {
    // STANDARD KEYBOARD CONTROLS (Flight Simulator/Tank Controls)
    // Left/Right keys rotate (Yaw rotation)
    const rotateSpeed = 2.5; // Radians per second
    let rotDir = 0;
    if (keys.a || keys.ArrowLeft)  rotDir = 1;
    if (keys.d || keys.ArrowRight) rotDir = -1;
    playerGroup.rotation.y += rotDir * rotateSpeed * dt;

    // Up key thrusts forward, Down key brakes/decelerates
    const maxSpeed = GAME_CONFIG.player.speed;
    const accel = 12;       // Gentle acceleration (was 50)
    const decel = 2;        // Very slow coast-to-stop (was 8)
    const brakeDecel = 25;  // Gentle brake (was 80)

    if (keys.w || keys.ArrowUp) {
      state.currentSpeed = Math.min(maxSpeed, state.currentSpeed + accel * dt);
    } else if (keys.s || keys.ArrowDown) {
      state.currentSpeed = Math.max(0, state.currentSpeed - brakeDecel * dt);
    } else {
      // Revert baseSpeed back to 0: decelerate smoothly to absolute stop
      state.currentSpeed = Math.max(0, state.currentSpeed - decel * dt);
    }

    // Direction vector on XZ plane
    const dx = -Math.sin(playerGroup.rotation.y) * state.currentSpeed * dt;
    const dz = -Math.cos(playerGroup.rotation.y) * state.currentSpeed * dt;

    state.velocity.set(-Math.sin(playerGroup.rotation.y) * state.currentSpeed, 0, -Math.cos(playerGroup.rotation.y) * state.currentSpeed);

    playerGroup.position.x += dx;
    playerGroup.position.z += dz;
    playerGroup.position.y = 0;

    // Boundary check
    playerGroup.position.x = Math.max(-GAME_CONFIG.player.rangeX, Math.min(GAME_CONFIG.player.rangeX, playerGroup.position.x));
    playerGroup.position.z = Math.max(-GAME_CONFIG.player.rangeZ, Math.min(GAME_CONFIG.player.rangeZ, playerGroup.position.z));

    // Simulated input values for roll/pitch display
    moveX = -rotDir * (state.currentSpeed / maxSpeed);
    moveY = (keys.w || keys.ArrowUp) ? 1.0 : 0.0;
  }

  // Common rotation and sway calculations
  if (state.gameMode === '3D') {
    const targetRoll = moveX * GAME_CONFIG.player.rollLimit;
    // Bank pitch down slightly when accelerating
    const targetPitch = moveY * 0.08;

    // Smooth lerp angles for sleek space flight control feel
    playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, targetRoll, GAME_CONFIG.player.lerpSpeed * dt);
    playerGroup.rotation.x = THREE.MathUtils.lerp(playerGroup.rotation.x, targetPitch, GAME_CONFIG.player.lerpSpeed * dt);

    // Subtle natural hovering sway (sine wave overlay on Y)
    const hoverOffset = Math.sin(performance.now() * 0.0035) * 0.15;
    playerGroup.position.y = hoverOffset;
  } else {
    // 2D Mode: Reset pitch/roll to flat plane
    playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, 0, 8 * dt);
    playerGroup.rotation.x = THREE.MathUtils.lerp(playerGroup.rotation.x, 0, 8 * dt);
    playerGroup.position.y = 0;
  }

  // Update dynamic fire plume particles behind jet nozzles
  updateEngineFlame(dt, playerGroup.position);
}

/**
 * Scroll stars in background towards the screen to give warp velocity illusion
 */
function updateStarfield(dt) {
  if (!starGeometry || !starPoints) return;

  // Calculate camera movement delta since last frame
  if (!window.lastCamPos) {
    window.lastCamPos = new THREE.Vector3().copy(camera.position);
  }
  const camMoved = new THREE.Vector3().subVectors(camera.position, window.lastCamPos);
  window.lastCamPos.copy(camera.position);

  // Lock cloudfield position to camera, but FREEZE rotation (do NOT copy camera.rotation).
  // This allows the Three.js renderer to naturally rotate the stars when the camera turns,
  // creating a perfect representation of 3D rotation (yaw/pitch/roll) on the background.
  if (camera) {
    starPoints.position.copy(camera.position);
    starPoints.rotation.set(0, 0, 0); // Fixed global rotation
  }

  const posArr = starGeometry.attributes.position.array;
  const warpMultiplier = state.mode === 'PLAYING' ? 1.0 : 0.25; // Slower in menus
  const count = posArr.length / 3;
  
  // Speed ratio: 0.0 when stopped, 1.0 at max speed
  const speedRatio = state.currentSpeed / GAME_CONFIG.player.speed;

  // Direction clouds flow: opposite of player's facing direction
  const pYaw = playerGroup ? playerGroup.rotation.y : 0;
  const flowX = Math.sin(pYaw);   // opposite of forward
  const flowZ = Math.cos(pYaw);

  // Max cloud scroll speed when at full thrust
  const maxFlowSpeed = 350;

  for (let i = 0; i < count; i++) {
    let xIdx = i * 3;
    let yIdx = i * 3 + 1;
    let zIdx = i * 3 + 2;
    
    // Clouds only move proportional to player speed. At 0 km/h → clouds are completely still.
    posArr[xIdx] += flowX * maxFlowSpeed * speedRatio * dt;
    posArr[zIdx] += flowZ * maxFlowSpeed * speedRatio * dt;
    
    // Recycle cloud when it scrolls past bounds
    if (posArr[zIdx] > 40) {
      posArr[zIdx] = -GAME_CONFIG.starfield.depth;
      posArr[xIdx] = (Math.random() - 0.5) * 520;
      posArr[yIdx] = (Math.random() - 0.5) * 240;
    } else if (posArr[zIdx] < -GAME_CONFIG.starfield.depth) {
      posArr[zIdx] = 40;
    }

    if (posArr[xIdx] > 260) {
      posArr[xIdx] = -260;
    } else if (posArr[xIdx] < -260) {
      posArr[xIdx] = 260;
    }
  }
  
  starGeometry.attributes.position.needsUpdate = true;
}

/**
 * Update laser positions and manage lifecycle
 */
function updateLasers(dt) {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    laser.mesh.position.addScaledVector(laser.velocity, dt);

    // Remove off-screen lasers
    if (laser.mesh.position.z < -280) {
      scene.remove(laser.mesh);
      laser.mesh.geometry.dispose();
      laser.mesh.material.dispose();
      lasers.splice(i, 1);
    }
  }
}

/**
 * Update enemy drone and asteroid movements, spin, collisions
 */
function updateEnemies(dt) {
  const now = performance.now();

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    
    // Move relative to player's speed for true speed synchronization
    if (enemy.velocity) {
      const relVelocity = new THREE.Vector3().copy(enemy.velocity).addScaledVector(state.velocity, -1);
      enemy.mesh.position.addScaledVector(relVelocity, dt);
    } else {
      enemy.mesh.position.z += (enemy.speed - state.velocity.z) * dt;
      enemy.mesh.position.x -= state.velocity.x * dt;
    }

    // Custom movements:
    if (enemy.type === 'DRONE') {
      // Hovering horizontal wiggle
      enemy.hoverOffset += 4 * dt;
      enemy.mesh.position.x += Math.sin(enemy.hoverOffset) * 8 * dt;
      
      // Face towards player slightly
      enemy.mesh.rotation.y = Math.sin(enemy.hoverOffset) * 0.4;

      // Enemy drone shooting logic (only if active in screen view and player is playing)
      if (state.mode === 'PLAYING' && enemy.mesh.position.z > -220 && enemy.mesh.position.z < -20 && !cameraIntro.active) {
        const shootInterval = 2200 / state.difficultyMultiplier;
        if (now - enemy.lastShootTime > shootInterval) {
          enemy.lastShootTime = now;
          spawnEnemyProjectile(enemy.mesh.position);
        }
      }
    } else {
      // Asteroids rotate chaoticly
      enemy.mesh.rotation.x += enemy.rotationSpeed.x * dt;
      enemy.mesh.rotation.y += enemy.rotationSpeed.y * dt;
      enemy.mesh.rotation.z += enemy.rotationSpeed.z * dt;
    }

    // Update hit flash timer
    if (enemy.flashTime > 0) {
      enemy.flashTime -= dt;
      if (enemy.flashTime <= 0) {
        // Restore original materials
        enemy.mesh.traverse(child => {
          if (child.isMesh && enemy.originalMaterials && enemy.originalMaterials.has(child)) {
            child.material = enemy.originalMaterials.get(child);
          }
        });
      }
    }

    // Check boundary cleanup
    if (enemy.mesh.position.z > 20) {
      scene.remove(enemy.mesh);
      enemies.splice(i, 1);
      continue;
    }

    // COLLISION DETECTION 1: Enemy vs Player
    if (state.mode === 'PLAYING' && playerGroup && !cameraIntro.active) {
      const dist = enemy.mesh.position.distanceTo(playerGroup.position);
      // Average collision boundary threshold
      const colRadius = enemy.type === 'ASTEROID' ? enemy.radius + 1.2 : 2.0;
      
      if (dist < colRadius) {
        // Boom!
        spawnExplosion(enemy.mesh.position, enemy.type === 'ASTEROID' ? 0x8b5a2b : 0xff0055, 30);
        
        // Take major shield damage
        const damage = enemy.type === 'ASTEROID' ? Math.round(enemy.radius * 12) : 25;
        damagePlayer(damage);

        scene.remove(enemy.mesh);
        enemies.splice(i, 1);
        continue;
      }
    }

    // COLLISION DETECTION 2: Enemy vs Player Lasers
    let enemyDestroyed = false;
    for (let j = lasers.length - 1; j >= 0; j--) {
      const laser = lasers[j];
      const distToLaser = enemy.mesh.position.distanceTo(laser.mesh.position);
      
      // Laser hits enemy (scaled in 2D)
      const scale = state.gameMode === '2D' ? 0.6 : 1.0;
      const hitLimit = enemy.type === 'ASTEROID' ? enemy.radius + 0.8 * scale : 1.3 * scale;
      if (distToLaser < hitLimit) {
        // Create small impact spark
        spawnExplosion(laser.mesh.position, 0x00f0ff, 8);
        
        // Destroy laser
        scene.remove(laser.mesh);
        laser.mesh.geometry.dispose();
        laser.mesh.material.dispose();
        lasers.splice(j, 1);

        // Deduct health
        enemy.hp--;
        enemy.flashTime = 0.08; // Flash for 80ms
        
        // Swap material to solid white MeshBasicMaterial
        const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        enemy.mesh.traverse(child => {
          if (child.isMesh) child.material = whiteMat;
        });
        
        if (enemy.hp <= 0) {
          // Total annihilation
          const boomColor = enemy.type === 'ASTEROID' ? 0xb58960 : 0xff0055;
          spawnExplosion(enemy.mesh.position, boomColor, enemy.type === 'ASTEROID' ? 25 : 35);
          playExplosionSound();
          
          // White blast screen flash (adds huge visual crunch!)
          triggerScreenFlash('rgba(255, 255, 255, 0.12)', 100);
          
          scene.remove(enemy.mesh);
          enemies.splice(i, 1);
          
          // Stats updates
          state.kills++;
          const scoreGained = enemy.type === 'ASTEROID' ? 100 : 250;
          addScore(scoreGained);

          // Trigger boss after enough kills (and only if no boss active yet)
          if (!state.bossActive && state.kills >= state.killsForBoss) {
            setTimeout(() => spawnBoss(), 1000);
          }

          enemyDestroyed = true;
        }
        break; // Stop laser checking on this enemy
      }
    }

    if (enemyDestroyed) continue;
  }
}

// ==========================================================================
// ENEMY PROJECTILES (PLASMA BULLETS FOR DRONES)
// ==========================================================================
function spawnEnemyProjectile(position, customDir = null) {
  const geom = new THREE.SphereGeometry(0.45, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(position);
  
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;
  mesh.scale.set(scale, scale, scale); // Scale enemy bullet size
  scene.add(mesh);

  const velocity = new THREE.Vector3();
  if (customDir) {
    velocity.copy(customDir);
  } else {
    velocity.subVectors(playerGroup.position, position);
  }
  
  if (state.gameMode === '2D') {
    velocity.y = 0; // Lock to flat 2D plane
  }
  
  velocity.normalize().multiplyScalar(42 + state.difficultyMultiplier * 5); // Speed increases with difficulty

  enemyProjectiles.push({ mesh, velocity });
}

function updateEnemyProjectiles(dt) {
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;

  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const proj = enemyProjectiles[i];
    // Move relative to player's velocity
    const relVelocity = new THREE.Vector3().copy(proj.velocity).addScaledVector(state.velocity, -1);
    proj.mesh.position.addScaledVector(relVelocity, dt);

    // Boundary cleanup
    if (proj.mesh.position.z > 25 || proj.mesh.position.z < -300) {
      scene.remove(proj.mesh);
      proj.mesh.geometry.dispose();
      proj.mesh.material.dispose();
      enemyProjectiles.splice(i, 1);
      continue;
    }

    // Collision check: Projectile vs Player (scaled threshold in 2D)
    if (state.mode === 'PLAYING' && playerGroup && !cameraIntro.active) {
      const dist = proj.mesh.position.distanceTo(playerGroup.position);
      const hitLimit = 1.7 * scale;
      if (dist < hitLimit) {
        // Red impact explosion
        spawnExplosion(proj.mesh.position, 0xff0055, 12);
        
        damagePlayer(12); // Take shield hit

        scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        proj.mesh.material.dispose();
        enemyProjectiles.splice(i, 1);
      }
    }
  }
}

// ==========================================================================
// CINEMATIC INTRO TRANSITION ENGINE
// ==========================================================================
function updateCameraIntro(dt) {
  if (!cameraIntro.active) return;

  cameraIntro.timer += dt;
  const pct = Math.min(1.0, cameraIntro.timer / cameraIntro.duration);

  // Smooth cubic deceleration (ease-out-cubic)
  const t = 1 - Math.pow(1 - pct, 3);

  camera.position.lerpVectors(cameraIntro.startPos, cameraIntro.endPos, t);
  
  if (state.gameMode === '3D') {
    camera.lookAt(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z - 3);
  } else {
    // 2D look down
    camera.lookAt(playerGroup.position.x, 0, playerGroup.position.z - 5);
  }

  // Stop intro when done
  if (pct >= 1.0) {
    cameraIntro.active = false;
    
    // Lock to precise positions
    if (state.gameMode === '3D') {
      camera.position.set(0, 0, 15);
      camera.rotation.set(0, 0, 0);
    } else {
      camera.position.set(0, 42, -5);
      camera.rotation.set(-Math.PI / 2, 0, 0);
    }
  }
}

/**
 * Powerups floating towards the screen
 */
function updateItems(dt) {
  const baseScale = state.gameMode === '2D' ? 0.6 : 1.0;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    
    if (item.velocity) {
      const relVelocity = new THREE.Vector3().copy(item.velocity).addScaledVector(state.velocity, -1);
      item.mesh.position.addScaledVector(relVelocity, dt);
    } else {
      item.mesh.position.z += (item.speed - state.velocity.z) * dt;
      item.mesh.position.x -= state.velocity.x * dt;
    }
    
    // Rotate items to make them look alive
    item.mesh.rotation.y += 2.0 * dt;
    item.mesh.rotation.x += 1.0 * dt;

    // Sine pulsation size scaling, respecting baseScale
    item.pulseTime += dt;
    const pulse = baseScale * (1.0 + Math.sin(item.pulseTime * 6) * 0.15);
    item.mesh.scale.set(pulse, pulse, pulse);

    // Boundary cleanup
    if (item.mesh.position.z > 20) {
      scene.remove(item.mesh);
      items.splice(i, 1);
      continue;
    }

    // Collision Detection: Item vs Player (scaled threshold in 2D)
    if (state.mode === 'PLAYING' && playerGroup) {
      const dist = item.mesh.position.distanceTo(playerGroup.position);
      const collectRadius = 2.0 * baseScale;
      if (dist < collectRadius) {
        // Collect!
        collectPowerup(item.type);
        
        // Mini sparks
        const sparkColor = item.type === 'SHIELD' ? 0x39ff14 : 0xffea00;
        spawnExplosion(item.mesh.position, sparkColor, 10);

        scene.remove(item.mesh);
        items.splice(i, 1);
      }
    }
  }
}

/**
 * Handle lifecycle and fading of explosion points
 */
function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const exp = explosions[i];
    exp.life += dt;
    
    if (exp.life >= exp.maxLife) {
      scene.remove(exp.points);
      exp.points.geometry.dispose();
      exp.points.material.dispose();
      explosions.splice(i, 1);
    } else {
      // Diffuse points outward
      const posAttr = exp.points.geometry.attributes.position;
      const count = posAttr.count;
      
      for (let j = 0; j < count; j++) {
        let x = posAttr.getX(j) + exp.velocities[j * 3] * dt;
        let y = posAttr.getY(j) + exp.velocities[j * 3 + 1] * dt;
        let z = posAttr.getZ(j) + exp.velocities[j * 3 + 2] * dt;
        
        posAttr.setXYZ(j, x, y, z);
        
        // Apply slight gravity/friction to explosions
        exp.velocities[j * 3] *= 0.96;
        exp.velocities[j * 3 + 1] *= 0.96;
        exp.velocities[j * 3 + 2] *= 0.96;
      }
      
      posAttr.needsUpdate = true;
      
      // Fade transparency
      const pct = exp.life / exp.maxLife;
      exp.points.material.opacity = 1.0 - pct;
    }
  }
}

// ==========================================================================
// SYSTEM INITIATION
// ==========================================================================
function initGameSystem() {
  console.log("initGameSystem: Starting initial sync...");
  try {
    initScene();
    console.log("initGameSystem: initScene completed.");
    setupControls();
    console.log("initGameSystem: setupControls completed.");
    initRadar();
    animate();
    console.log("initGameSystem: animate loop running.");
  } catch (err) {
    console.error("initGameSystem error during startup:", err);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initGameSystem);
} else {
  initGameSystem();
}
