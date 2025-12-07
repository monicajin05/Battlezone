let gl = null;

// obj files
const OBJ_BODY_URL   = "Tank.obj";  
const OBJ_TURRET_URL = "Tankturret.obj";

let shaderProgram = null;

// locations
let aPosLoc, aNormLoc;
let uModelLoc, uViewLoc, uProjLoc;
let uColorLoc, uLightDirLoc;

// camera
const eye    = vec3.fromValues(0, 1.5, 4);
const center = vec3.fromValues(0, 0.5, 0);
const up     = vec3.fromValues(0, 1, 0);

// meshes
const meshes = []; // {positions, normals, vbo, nbo, vertexCount, color}

// Transform state
let tankPos      = vec3.fromValues(0, 0, 0);
let tankHeading  = 0;                        
let turretOffset = 0;                      

const MOVE_SPEED       = 0.3;   
const TURN_SPEED       = 0.3;  
const TURRET_TURN_SPEED = 0.06; 

// ground mesh
let groundVBO = null;
let groundNBO = null;
let groundVertexCount = 0;

// obstacle mesh
let pyramidVBO = null;
let pyramidNBO = null;
let pyramidVertexCount = 0;

const obstacles = [];

const TANK_RADIUS = 0.5;

// bullets
const bullets = [];
const BULLET_SPEED = 0.7;
const BULLET_LIFETIME = 3.0;

let proj = mat4.create();        
let mouseNDC = { x: 0.0, y: 0.0 };
let aimPoint = vec3.fromValues(0, 0, 0); 

// enemies
const enemies = [];
const ENEMY_SPEED = 0.015;
const ENEMY_TURN_SPEED = 0.05;
const ENEMY_FIRE_RANGE = 25.0;
const ENEMY_FIRE_COOLDOWN = 10;
const MAX_ENEMIES = 3;

// state
const FIELD_SIZE = 80;
const PLAYER_INVINCIBLE_TIME = 3.0;
let playerInvincibleTimer = 0.0;

// score
let score = 0;
let scoreElement = null;

function updateScore() {
  if (scoreElement) {
    scoreElement.textContent = "Score: " + score;
  }
}

// obj parser for triangles
async function loadOBJ(url) {
  const text = await fetch(url).then(r => {
    if (!r.ok) throw new Error("Failed to load " + url);
    return r.text();
  });

  const lines = text.split("\n");

  const tempPositions = []; 
  const positions = [];    
  const normals   = [];     

  for (let raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    const type = parts[0];

    if (type === "v") {
      // vertex position
      tempPositions.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);
    } else if (type === "f") {
      // face
      const refs = parts.slice(1); 
      if (refs.length < 3) continue;

      // helper
      const idxFromRef = (ref) => {
        const vStr = ref.split("/")[0];
        return parseInt(vStr, 10) - 1; 
      };

      const i0 = idxFromRef(refs[0]);

      for (let k = 1; k < refs.length - 1; k++) {
        const i1 = idxFromRef(refs[k]);
        const i2 = idxFromRef(refs[k + 1]);

        const v0 = tempPositions[i0];
        const v1 = tempPositions[i1];
        const v2 = tempPositions[i2];

        positions.push(
          v0[0], v0[1], v0[2],
          v1[0], v1[1], v1[2],
          v2[0], v2[1], v2[2]
        );
      }
    }
  }

  // per face normals
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 0], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];

    // edges
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    // face normal 
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1.0;
    nx /= len; ny /= len; nz /= len;

    normals.push(nx, ny, nz);
    normals.push(nx, ny, nz);
    normals.push(nx, ny, nz);
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    vertexCount: positions.length / 3
  };
}


// webgl setup
function setupWebGL() {
  const canvas = document.getElementById("myWebGLCanvas");
  gl = canvas.getContext("webgl", { alpha: true });
  if (!gl) {
    alert("WebGL not supported");
    return;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
}

// shaders
function setupShaders() {
  const vsSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;

    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;

    varying vec3 vNormal;
    varying vec3 vWorldPos;

    void main() {
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;

      vNormal = mat3(uModel) * aNormal;

      gl_Position = uProj * uView * worldPos;
    }
  `;

  const fsSource = `
    precision mediump float;

    varying vec3 vNormal;
    varying vec3 vWorldPos;

    uniform vec3 uColor;
    uniform vec3 uLightDir;

    void main() {
      vec3 N = normalize(vNormal);
      vec3 L = normalize(uLightDir);

      float lambert = max(dot(N, L), 0.0);

      vec3 ambient  = 0.2 * uColor;
      vec3 diffuse  = 0.8 * uColor * lambert;

      vec3 color = ambient + diffuse;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("Shader compile error:\n" + info);
    }
    return shader;
  }

  const vs = compileShader(gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);

  shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vs);
  gl.attachShader(shaderProgram, fs);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(shaderProgram);
    throw new Error("Program link error:\n" + info);
  }

  gl.useProgram(shaderProgram);

  // get uniform locations
  aPosLoc      = gl.getAttribLocation(shaderProgram, "aPosition");
  aNormLoc     = gl.getAttribLocation(shaderProgram, "aNormal");
  uModelLoc    = gl.getUniformLocation(shaderProgram, "uModel");
  uViewLoc     = gl.getUniformLocation(shaderProgram, "uView");
  uProjLoc     = gl.getUniformLocation(shaderProgram, "uProj");
  uColorLoc    = gl.getUniformLocation(shaderProgram, "uColor");
  uLightDirLoc = gl.getUniformLocation(shaderProgram, "uLightDir");

  gl.enableVertexAttribArray(aPosLoc);
  gl.enableVertexAttribArray(aNormLoc);

  mat4.perspective(proj, Math.PI / 3, 1.0, 0.1, 100.0);
  gl.uniformMatrix4fv(uProjLoc, false, proj);

  const lightDir = vec3.fromValues(0.5, 1.0, 0.3);
  gl.uniform3fv(uLightDirLoc, lightDir);
}

// buffers for meshes
function createMeshBuffers(mesh, color) {
  mesh.vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

  mesh.nbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

  mesh.color = color || [0.2, 0.8, 0.3];
}

function createGround() {
    const size = 100.0;

  // 2 triangles 
  const positions = new Float32Array([
    -size, 0, -size,
     size, 0, -size,
     size, 0,  size,

    -size, 0, -size,
     size, 0,  size,
    -size, 0,  size,
  ]);

  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,

    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);

  groundVertexCount = 6;

  groundVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, groundVBO);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  groundNBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, groundNBO);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
}

function createPyramidMesh() {
  const positions = [
    -0.5, 0.0, -0.5,
     0.5, 0.0, -0.5,
     0.5, 0.0,  0.5,

    -0.5, 0.0, -0.5,
     0.5, 0.0,  0.5,
    -0.5, 0.0,  0.5,

    // +z
    -0.5, 0.0,  0.5,
     0.5, 0.0,  0.5,
     0.0, 1.0,  0.0,

    // -z
     0.5, 0.0, -0.5,
    -0.5, 0.0, -0.5,
     0.0, 1.0,  0.0,
 
    // +x
     0.5, 0.0,  0.5,
     0.5, 0.0, -0.5,
     0.0, 1.0,  0.0,

    // -x
    -0.5, 0.0, -0.5,
    -0.5, 0.0,  0.5,
     0.0, 1.0,  0.0,
  ];

  // normals
  const normals = [];
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 0], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1.0;
    nx /= len; ny /= len; nz /= len;

    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }

  pyramidVertexCount = positions.length / 3;

  pyramidVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pyramidVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  pyramidNBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pyramidNBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
}

function spawnObstacles() {
  const NUM_MOUNTAINS = 15;
  const NUM_HILLS     = 25;
  const FIELD_SIZE    = 80;   

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // mountains
  for (let i = 0; i < NUM_MOUNTAINS; i++) {
    const x = rand(-FIELD_SIZE/2, FIELD_SIZE/2);
    const z = rand(-FIELD_SIZE/2, FIELD_SIZE/2);

    obstacles.push({
      pos:   [x, 0, z],
      scale: [3 + Math.random()*3, 4 + Math.random()*4, 3 + Math.random()*3],
      color: [0.25, 0.2, 0.18], // brown
      isMountain: true
    });
  }

  // hills
  for (let i = 0; i < NUM_HILLS; i++) {
    const x = rand(-FIELD_SIZE/2, FIELD_SIZE/2);
    const z = rand(-FIELD_SIZE/2, FIELD_SIZE/2);

    obstacles.push({
      pos:   [x, 0, z],
      scale: [2 + Math.random()*2, 0.8 + Math.random()*0.6, 2 + Math.random()*2], // flatter
      color: [0.18, 0.35, 0.18], // green
      isMountain: false
    });
  }
}

// collision detection
function collision(testPos) {
  const tx = testPos[0];
  const tz = testPos[2];

  for (const ob of obstacles) {
    if (!ob.isMountain) continue;

    const ox = ob.pos[0];
    const oz = ob.pos[2];

    const dx = tx - ox;
    const dz = tz - oz;

    const mountainRadius = Math.max(ob.scale[0], ob.scale[2]) * 0.5;

    const minDist = TANK_RADIUS + mountainRadius;
    if ((dx * dx + dz * dz) < (minDist * minDist)) {
      return true;
    }
  }

  return false;
}

// collides with the player
function collidesWithPlayer(testPos) {
  const dx = testPos[0] - tankPos[0];
  const dz = testPos[2] - tankPos[2];
  const minDist = TANK_RADIUS * 2.0;
  return (dx*dx + dz*dz) < (minDist * minDist);
}

// collides with enemies
function collidesWithEnemies(testPos, ignoreEnemy = null) {
  for (const e of enemies) {
    if (e === ignoreEnemy) continue; // enemy won't collide with itself

    const dx = testPos[0] - e.pos[0];
    const dz = testPos[2] - e.pos[2];
    const minDist = TANK_RADIUS * 2.0;

    if (dx*dx + dz*dz < (minDist * minDist)) {
      return true;
    }
  }
  return false;
}

// bullet vs obstacles
function bulletHitsObstacle(pos) {
  const bx = pos[0];
  const bz = pos[2];

  for (const ob of obstacles) {
    if (!ob.isMountain) continue; // hills don't block

    const ox = ob.pos[0];
    const oz = ob.pos[2];

    const dx = bx - ox;
    const dz = bz - oz;

    const mountainRadius = Math.max(ob.scale[0], ob.scale[2]) * 0.5;

    if (dx * dx + dz * dz < mountainRadius * mountainRadius) {
      return true;
    }
  }
  return false;
}

// find the elevation 
function getElevation(x, z) {
  let maxH = 0.0;

  for (const ob of obstacles) {
    if (ob.isMountain) continue; // mountains have collisions

    // hill height
    const dx = x - ob.pos[0];
    const dz = z - ob.pos[2];

    const rx = ob.scale[0] * 0.5;
    const rz = ob.scale[2] * 0.5;
    const r  = Math.max(rx, rz); 

    const dist = Math.hypot(dx, dz);
    if (dist < r) {
      const t = 1.0 - dist / r;     // higher at the center
      const hillHeight = ob.scale[1] * t; 

      if (hillHeight > maxH) {
        maxH = hillHeight;
      }
    }
  }

  return maxH;
}

function handleKeyDown(e) {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) {
    e.preventDefault();
  }

  if (e.key === "!") {
    // switch to alternate game
    const params = new URLSearchParams(window.location.search);
    params.set("mode", "alt");
    window.location.search = params.toString();
    return;
  }

  switch (e.code) {
    case "KeyW": {
      // move forward along heading
      const forwardX = Math.sin(tankHeading);
      const forwardZ = Math.cos(tankHeading);

      const newX = tankPos[0] + forwardX * MOVE_SPEED;
      const newZ = tankPos[2] + forwardZ * MOVE_SPEED;

      const testPos = vec3.fromValues(newX, tankPos[1], newZ);
      if (!collision(testPos) && !collidesWithEnemies(testPos)) {
        tankPos[0] = newX;
        tankPos[2] = newZ;
      }
      
      tankPos[1] = getElevation(tankPos[0], tankPos[2]);
      break;
    }

    case "KeyS": {
      const forwardX = Math.sin(tankHeading);
      const forwardZ = Math.cos(tankHeading);

      const newX = tankPos[0] - forwardX * MOVE_SPEED;
      const newZ = tankPos[2] - forwardZ * MOVE_SPEED;

      const testPos = vec3.fromValues(newX, tankPos[1], newZ);
      if (!collision(testPos) && !collidesWithEnemies(testPos)) {
        tankPos[0] = newX;
        tankPos[2] = newZ;
      }

      tankPos[1] = getElevation(tankPos[0], tankPos[2]);
      break;
    }

    // rotate body
    case "KeyA": // turn left
      tankHeading += TURN_SPEED;
      break;

    case "KeyD": // turn right
      tankHeading -= TURN_SPEED;
      break;

    // rotate turret
    case "ArrowLeft":
      turretOffset += TURRET_TURN_SPEED;
      break;

    case "ArrowRight":
      turretOffset -= TURRET_TURN_SPEED;
      break;

    // shoot bullet with space
    case "Space": { 
      // shoot straight
      const dir = vec3.create();
      vec3.subtract(dir, aimPoint, tankPos);
      dir[1] = 0.1;     
      vec3.normalize(dir, dir);
  
      // start bullet near turret
      const startPos = vec3.fromValues(
        tankPos[0] + dir[0] * 1.2,
        tankPos[1] + 0.6,
        tankPos[2] + dir[2] * 1.2
      );

      bullets.push({
        pos: startPos,
        dir: dir,
        life: BULLET_LIFETIME,
        owner: "player"
      });

      break;
    }
  }
}

// drawing tanks
function drawTank(position, heading, turretOff, bodyColor, turretColor) {
  if (!meshes[0] || !meshes[1]) return;

  const scale = 1.0;

  // body
  const modelBody = mat4.create();
  mat4.translate(modelBody, modelBody, position);
  mat4.rotateY(modelBody, modelBody, heading);
  mat4.scale(modelBody, modelBody, vec3.fromValues(scale, scale, scale));

  gl.uniformMatrix4fv(uModelLoc, false, modelBody);
  gl.uniform3fv(uColorLoc, bodyColor);

  gl.bindBuffer(gl.ARRAY_BUFFER, meshes[0].vbo);
  gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshes[0].nbo);
  gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, meshes[0].vertexCount);

  // turret
  const modelTurret = mat4.create();
  mat4.translate(modelTurret, modelTurret, position);
  mat4.rotateY(modelTurret, modelTurret, heading + turretOff);
  mat4.scale(modelTurret, modelTurret, vec3.fromValues(scale, scale, scale));

  gl.uniformMatrix4fv(uModelLoc, false, modelTurret);
  gl.uniform3fv(uColorLoc, turretColor);

  gl.bindBuffer(gl.ARRAY_BUFFER, meshes[1].vbo);
  gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshes[1].nbo);
  gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, meshes[1].vertexCount);
}

// draw radar
function drawRadar() {
  const canvas = gl.canvas;

  const radarSize = 150;
  const margin    = 10;
  gl.viewport(canvas.width - radarSize - margin, canvas.height - radarSize - margin, radarSize, radarSize);

  // clear depth buffer
  gl.clear(gl.DEPTH_BUFFER_BIT);

  // top down projection
  const projRadar = mat4.create();
  const HALF_EXTENT = 10;

  mat4.ortho(
    projRadar,
    -HALF_EXTENT, HALF_EXTENT,   
    -HALF_EXTENT, HALF_EXTENT,   
    0.1, 200.0                   
  );
  gl.uniformMatrix4fv(uProjLoc, false, projRadar);

  const radarView   = mat4.create();
  const radarEye    = vec3.fromValues(tankPos[0], 80, tankPos[2]); // above player
  const radarCenter = vec3.fromValues(tankPos[0], 0,  tankPos[2]); // look at ground
  const radarUp     = vec3.fromValues(0, 0, -1);                   

  mat4.lookAt(radarView, radarEye, radarCenter, radarUp);
  gl.uniformMatrix4fv(uViewLoc, false, radarView);

  // draw ground on radar
  if (groundVBO && groundNBO) {
    const groundModel = mat4.create();
    gl.uniformMatrix4fv(uModelLoc, false, groundModel);
    gl.uniform3fv(uColorLoc, [0.15, 0.25, 0.15]);

    gl.bindBuffer(gl.ARRAY_BUFFER, groundVBO);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, groundNBO);
    gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, groundVertexCount);
  }

  // draw obstacles on radar
  if (pyramidVBO && pyramidNBO) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pyramidVBO);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pyramidNBO);
    gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

    for (const ob of obstacles) {
      const model = mat4.create();
      mat4.translate(model, model, vec3.fromValues(ob.pos[0], ob.pos[1], ob.pos[2]));
      mat4.scale(model, model, vec3.fromValues(ob.scale[0], ob.scale[1], ob.scale[2]));

      gl.uniformMatrix4fv(uModelLoc, false, model);
      gl.uniform3fv(uColorLoc, ob.color);

      gl.drawArrays(gl.TRIANGLES, 0, pyramidVertexCount);
    }
  }

  // draw enemies on radar
  const enemyBodyColor   = [0.8, 0.3, 0.3];
  const enemyTurretColor = [0.8, 0.3, 0.3];

  for (const e of enemies) {
    const pos = vec3.fromValues(
      e.pos[0],
      getElevation(e.pos[0], e.pos[2]),
      e.pos[2]
    );
    drawTank(pos, e.heading, e.turretOffset, enemyBodyColor, enemyTurretColor);
  }

  // draw player on radar
  const playerPos = vec3.fromValues(
    tankPos[0],
    tankPos[1],
    tankPos[2]
  );
  const playerBodyColor   = [0.3, 0.8, 0.9];
  const playerTurretColor = [0.3, 0.8, 0.9];

  drawTank(playerPos, tankHeading, turretOffset, playerBodyColor, playerTurretColor);
}

// spawn an enemy
function spawnEnemy() {
  const half = FIELD_SIZE / 8; // lowered due to size of map
  const margin = 3.0;

  const e = {
    pos: vec3.create(),
    heading: 0,
    turretOffset: 0,
    cooldown: Math.random() * ENEMY_FIRE_COOLDOWN
  };

  const forward = vec3.fromValues(Math.sin(tankHeading), 0, Math.cos(tankHeading));

  for (let attempt = 0; attempt < 40; attempt++) {
    const side = Math.floor(Math.random() * 4);
    let x, z;

    if (side === 0) {            
      x = half + margin;
      z = (Math.random() * 2 - 1) * half;
      e.heading = Math.PI;       
    } else if (side === 1) {     
      x = -half - margin;
      z = (Math.random() * 2 - 1) * half;
      e.heading = 0;
    } else if (side === 2) {     
      z = half + margin;
      x = (Math.random() * 2 - 1) * half;
      e.heading = -Math.PI / 2;
    } else {                   
      z = -half - margin;
      x = (Math.random() * 2 - 1) * half;
      e.heading = Math.PI / 2;
    }

    const testPos = vec3.fromValues(x, 0, z);
    if (collision(testPos)) continue; // can't spawn inside collidables

    const toEnemy = vec3.fromValues(x - tankPos[0], 0, z - tankPos[2]);
    const dot = toEnemy[0] * forward[0] + toEnemy[2] * forward[2];

    if (dot < 0) { 
      e.pos[0] = x;
      e.pos[2] = z;
      e.pos[1] = getElevation(x, z);
      return e;
    }
  }

  e.pos[1] = getElevation(e.pos[0], e.pos[2]);
  return e;
}

// spawn player after death
function respawnPlayer() {
  const half = FIELD_SIZE / 8;

  for (let attempt = 0; attempt < 50; attempt++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    const y = getElevation(x, z);

    const testPos = vec3.fromValues(x, y, z);

    if (collision(testPos)) continue;
    if (collidesWithEnemies(testPos)) continue;

    return testPos;
  }

  // center of map as fallback
  return vec3.fromValues(0, getElevation(0,0), 0);
}


// update the enemies behavior
function updateEnemies(dt) {
  for (const e of enemies) {
    // direction and distance to player 
    const dx = tankPos[0] - e.pos[0];
    const dz = tankPos[2] - e.pos[2];
    const dist2 = dx*dx + dz*dz;

    const targetHeading = Math.atan2(dx, dz);  

    // rotate enemy toward player 
    let diff = targetHeading - e.heading;
    if (diff > Math.PI)  diff -= 2.0 * Math.PI;
    if (diff < -Math.PI) diff += 2.0 * Math.PI;

    const turn = Math.max(-ENEMY_TURN_SPEED, Math.min(ENEMY_TURN_SPEED, diff));
    e.heading += turn;

    // move enemy forward
    if (dist2 > 4.0) {  
      const fx = Math.sin(e.heading);
      const fz = Math.cos(e.heading);

      const newX = e.pos[0] + fx * ENEMY_SPEED;
      const newZ = e.pos[2] + fz * ENEMY_SPEED;

      const testPos = vec3.fromValues(newX, e.pos[1], newZ);
      // check for collisions
      if (!collision(testPos) && !collidesWithPlayer(testPos) && !collidesWithEnemies(testPos, e)) { 
        e.pos[0] = newX;
        e.pos[2] = newZ;
        e.pos[1] = getElevation(e.pos[0], e.pos[2]); 
      }
    }

    // turret aims at player 
    const turretWorldYaw = targetHeading + Math.PI;
    let turretYaw = turretWorldYaw - e.heading;
    if (turretYaw > Math.PI)  turretYaw -= 2.0 * Math.PI;
    if (turretYaw < -Math.PI) turretYaw += 2.0 * Math.PI;
    e.turretOffset = turretYaw;

    // shoot at player 
    e.cooldown -= dt;

    if (dist2 < ENEMY_FIRE_RANGE * ENEMY_FIRE_RANGE && e.cooldown <= 0) {
      // fire a bullet at player
      const fx = Math.sin(targetHeading);
      const fz = Math.cos(targetHeading);

      const startPos = vec3.fromValues(
        e.pos[0] + fx * 1.2,
        e.pos[1] + 0.6,
        e.pos[2] + fz * 1.2
      );

      bullets.push({
        pos: startPos,
        dir: vec3.fromValues(fx, 0.05, fz), 
        life: BULLET_LIFETIME,
        owner: "enemy"
      });

      e.cooldown = ENEMY_FIRE_COOLDOWN + Math.random() * 0.4; 
    }
  }
}

// draw the scene
function drawScene() {

  const canvas = gl.canvas;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.uniformMatrix4fv(uProjLoc, false, proj);

  const view    = mat4.create();
  const worldUp = vec3.fromValues(0, 1, 0);

  const forward = vec3.fromValues(Math.sin(tankHeading), 0, Math.cos(tankHeading));

  const noseDir = vec3.clone(forward)  

  const behindDir = vec3.create();
  vec3.scale(behindDir, forward, -1.0);

  const right = vec3.create();
  vec3.cross(right, noseDir, worldUp);
  vec3.normalize(right, right);

  // camera position
  const backDist = 4.0;   
  const upDist   = 2.0;   

  const eyePos = vec3.clone(tankPos);

  // camera behind tank
  eyePos[0] += behindDir[0] * backDist;
  eyePos[1] += upDist;
  eyePos[2] += behindDir[2] * backDist;

  const lookAt = vec3.create();
  const frontDist = 8.0;
  vec3.scaleAndAdd(lookAt, tankPos, noseDir, frontDist);
  lookAt[1] += 1.0;

  mat4.lookAt(view, eyePos, lookAt, worldUp);
  gl.uniformMatrix4fv(uViewLoc, false, view);

  // update bullets
  const dt = 1.0 / 60.0;

  // calculate invincibility timer
  if (playerInvincibleTimer > 0) {
    playerInvincibleTimer -= dt;
    if (playerInvincibleTimer < 0) playerInvincibleTimer = 0;
  }
  updateEnemies(dt);
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    // move
    b.pos[0] += b.dir[0] * BULLET_SPEED;
    b.pos[1] += b.dir[1] * BULLET_SPEED;
    b.pos[2] += b.dir[2] * BULLET_SPEED;

    b.life -= dt;

    let remove = false;

    // remove bullet if it hits an obstacle
    if (bulletHitsObstacle(b.pos)) {
      remove = true;
    }

    // player bullets hit enemies
    if (b.owner === "player") {
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const dx = b.pos[0] - e.pos[0];
        const dz = b.pos[2] - e.pos[2];

        if (dx*dx + dz*dz < (TANK_RADIUS * TANK_RADIUS)) { 
          // enemy hit
          enemies.splice(j, 1);
          if (enemies.length < MAX_ENEMIES) {
            enemies.push(spawnEnemy()); // respawn 
          }

          // update score
          score += 100;
          updateScore();

          remove = true;
          break;
        }
      }
    }

    // bullets hit player
    if (!remove && b.owner === "enemy" && playerInvincibleTimer <= 0) {
      const dx = b.pos[0] - tankPos[0];
      const dz = b.pos[2] - tankPos[2];

      if (dx*dx + dz*dz < (TANK_RADIUS * TANK_RADIUS)) {
        const newPos = respawnPlayer();
        tankPos[0] = newPos[0];
        tankPos[2] = newPos[2];
        tankPos[1] = newPos[1];

        score = 0;
        updateScore();

        playerInvincibleTimer = PLAYER_INVINCIBLE_TIME; 
        remove = true;
      }
    }

    // lifetime
    if (!remove && (
        b.life <= 0 ||
        Math.abs(b.pos[0]) > FIELD_SIZE / 2 + 10 ||
        Math.abs(b.pos[2]) > FIELD_SIZE / 2 + 10)) {
      remove = true;
    }

    if (remove) {
      bullets.splice(i, 1);
    }
  }


  // turret aiming from mouse
  (function updateAimFromMouse() {
    const vp = mat4.create();
    const invVP = mat4.create();

    mat4.multiply(vp, proj, view);    
    if (!mat4.invert(invVP, vp)) {
      return;
    }

    const nearPoint = vec4.fromValues(mouseNDC.x, mouseNDC.y, -1.0, 1.0);
    const farPoint  = vec4.fromValues(mouseNDC.x, mouseNDC.y,  1.0, 1.0);

    vec4.transformMat4(nearPoint, nearPoint, invVP);
    vec4.transformMat4(farPoint,  farPoint,  invVP);

    // perspective divide
    for (let i = 0; i < 3; i++) {
      nearPoint[i] /= nearPoint[3];
      farPoint[i]  /= farPoint[3];
    }

    const rayOrigin = vec3.fromValues(nearPoint[0], nearPoint[1], nearPoint[2]);
    const rayDir    = vec3.fromValues(
      farPoint[0] - nearPoint[0],
      farPoint[1] - nearPoint[1],
      farPoint[2] - nearPoint[2]
    );
    vec3.normalize(rayDir, rayDir);

    // intersect with ground plane
    if (Math.abs(rayDir[1]) > 1e-4) {
      const t = -rayOrigin[1] / rayDir[1];
      if (t > 0.0) {
        vec3.scaleAndAdd(aimPoint, rayOrigin, rayDir, t);
      }
    }

    // find yaw angle
    const dx = aimPoint[0] - tankPos[0];
    const dz = aimPoint[2] - tankPos[2];
    const desiredYaw = Math.atan2(-dx, -dz);

    // bring turret to mouse
    turretOffset = desiredYaw - tankHeading;
    if (turretOffset > Math.PI)  turretOffset -= 2.0 * Math.PI;
    if (turretOffset < -Math.PI) turretOffset += 2.0 * Math.PI;
  })();

  const scale = 1.0;

  // draw ground
  if (groundVBO && groundNBO) {
    const groundModel = mat4.create();
    gl.uniformMatrix4fv(uModelLoc, false, groundModel);
    gl.uniform3fv(uColorLoc, [0.25, 0.35, 0.25]); 

    gl.bindBuffer(gl.ARRAY_BUFFER, groundVBO);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, groundNBO);
    gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, groundVertexCount);
  }

  // draw obstacles
  if (pyramidVBO && pyramidNBO) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pyramidVBO);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, pyramidNBO);
    gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

    for (const ob of obstacles) {
      const model = mat4.create();
      mat4.translate(model, model, vec3.fromValues(ob.pos[0], ob.pos[1], ob.pos[2]));
      mat4.scale(model, model, vec3.fromValues(ob.scale[0], ob.scale[1], ob.scale[2]));

      gl.uniformMatrix4fv(uModelLoc, false, model);
      gl.uniform3fv(uColorLoc, ob.color);

      gl.drawArrays(gl.TRIANGLES, 0, pyramidVertexCount);
    }
  }

  // draw bullets as small pyramids
  if (pyramidVBO && pyramidNBO && bullets.length > 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pyramidVBO);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pyramidNBO);
    gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0);

    for (const b of bullets) {
      const model = mat4.create();
      mat4.translate(model, model, b.pos);
      mat4.scale(model, model, vec3.fromValues(0.1, 0.1, 0.1)); 

      gl.uniformMatrix4fv(uModelLoc, false, model);
      gl.uniform3fv(uColorLoc, [1.0, 1.0, 1.0]); // white

      gl.drawArrays(gl.TRIANGLES, 0, pyramidVertexCount);
    }
  }


  // enemies
  for (const e of enemies) {
    const pos = vec3.fromValues(
      e.pos[0],
      getElevation(e.pos[0], e.pos[2]), // hills
      e.pos[2]
    );

    const enemyBodyColor   = [0.8, 0.3, 0.3];  // red
    const enemyTurretColor = [0.8, 0.3, 0.3];  // red

    drawTank(pos, e.heading, e.turretOffset, enemyBodyColor, enemyTurretColor);
  }

  // player tank
  const playerPos = vec3.fromValues(
    tankPos[0],
    tankPos[1],
    tankPos[2]
  );
  drawTank(playerPos, tankHeading, turretOffset, meshes[0].color, meshes[1].color);

  drawRadar();

  requestAnimationFrame(drawScene);
}


// main
async function main() {
  setupWebGL();
  setupShaders();

  createGround();
  createPyramidMesh();
  spawnObstacles();

  // load body & turret
  const bodyMesh   = await loadOBJ(OBJ_BODY_URL);
  const turretMesh = await loadOBJ(OBJ_TURRET_URL);

  createMeshBuffers(bodyMesh,   [0.3, 0.8, 0.9]); // blue
  createMeshBuffers(turretMesh, [0.3, 0.8, 0.9]); // blue

  meshes.push(bodyMesh, turretMesh);

  // enemy tanks
  enemies.push({
    pos: vec3.fromValues(8, 0, 5),   
    heading: Math.PI,                
    turretOffset: 0,   
    cooldown: Math.random() * ENEMY_FIRE_COOLDOWN               
  });

  enemies.push({
    pos: vec3.fromValues(-6, 0, -4),
    heading: Math.PI / 2,
    turretOffset: 0,
    cooldown: Math.random() * ENEMY_FIRE_COOLDOWN               
  });

  enemies.push({
    pos: vec3.fromValues(3, 0, -10),
    heading: 0,
    turretOffset: 0,
    cooldown: Math.random() * ENEMY_FIRE_COOLDOWN               
  });

  // have them be on the ground
  for (const e of enemies) {
    e.pos[1] = getElevation(e.pos[0], e.pos[2]);
  }

  // event listeners
  window.addEventListener("keydown", handleKeyDown);

  const canvas = document.getElementById("myWebGLCanvas");

  // for mouse
  // add in the crosshair
  const crosshair = document.getElementById("crosshair");
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();

    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2.0 - 1.0;
    mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2.0 - 1.0);

    crosshair.style.left = e.clientX + "px";
    crosshair.style.top  = e.clientY + "px";
  });

  // mouse click for firing
  canvas.addEventListener("mousedown", (e) => {
    // direction
    const dir = vec3.create(); 
    vec3.subtract(dir, aimPoint, tankPos);
    dir[1] = 0.1; 
    vec3.normalize(dir, dir);

    // start bullet near turret
    const startPos = vec3.fromValues(
      tankPos[0] + dir[0] * 1.2,
      tankPos[1] + 0.6,       
      tankPos[2] + dir[2] * 1.2
    );

    bullets.push({
      pos: startPos,
      dir: dir,
      life: BULLET_LIFETIME,
      owner: "player"
    });
  });

  // score 
  scoreElement = document.getElementById("score");
  updateScore();

  requestAnimationFrame(drawScene);
}