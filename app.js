import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('app');
const resetBtn = document.getElementById('resetBtn');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);
camera.position.set(0, 0.08, 2.35);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.minDistance = 1.0;
controls.maxDistance = 4.0;
controls.target.set(0, 0.05, 0);

// lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0x334466, 1.65);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(1.4, 1.7, 2.2);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.75);
rimLight.position.set(-1.5, 0.5, -1.5);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xffffff, 0.55, 8);
fillLight.position.set(0, -0.25, 1.3);
scene.add(fillLight);

// interaction helpers
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeHit = new THREE.Vector3();
const dragStartPoint = new THREE.Vector3();
const worldNormal = new THREE.Vector3();
const hitPointWorld = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const inverseMatrix = new THREE.Matrix4();
const localDeltaVec = new THREE.Vector3();

let modelRoot = null;
let sculptMesh = null;
let basePositions = null;
let currentOffsets = null;
let vertexVelocities = null;

let isDraggingMesh = false;
let dragPointerId = null;
let lastLocalHit = new THREE.Vector3();

let baseModelY = 0;
let floatPhase = 0;

// tuned settings
let sculptRadius = 0.30;
let sculptStrength = 0.015;

const TOUCH_FORCE_MULTIPLIER = 0.20;
const MOUSE_FORCE_MULTIPLIER = 1.0;
const MAX_WORLD_DELTA_PER_STEP = 0.016;

const SPRING_STIFFNESS = 50.0;
const SPRING_DAMPING = 0.5;
const MAX_OFFSET_FROM_BASE = 0.09;

const loader = new GLTFLoader();
loader.load(
  './assets/head.glb',
  (gltf) => {
    modelRoot = gltf.scene;
    scene.add(modelRoot);

    let largestMesh = null;
    let largestScore = -Infinity;

    modelRoot.traverse((child) => {
      if (!child.isMesh) return;

      child.castShadow = false;
      child.receiveShadow = false;

      if (child.material) {
        child.material = child.material.clone();
        child.material.needsUpdate = true;
      }

      const geo = child.geometry;
      if (!geo?.attributes?.position) return;

      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const size = new THREE.Vector3();
      bb.getSize(size);
      const score = size.x * size.y * size.z;

      if (score > largestScore) {
        largestScore = score;
        largestMesh = child;
      }
    });

    if (!largestMesh) {
      console.warn('No editable mesh found in head.glb');
      return;
    }

    sculptMesh = largestMesh;

    if (sculptMesh.geometry.index) {
      sculptMesh.geometry = sculptMesh.geometry.toNonIndexed();
    } else {
      sculptMesh.geometry = sculptMesh.geometry.clone();
    }

    sculptMesh.geometry.computeVertexNormals();
    sculptMesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

    basePositions = sculptMesh.geometry.attributes.position.array.slice();
    currentOffsets = new Float32Array(basePositions.length);
    vertexVelocities = new Float32Array(basePositions.length);

    frameModel();
    syncGeometryFromOffsets();
  },
  undefined,
  (err) => {
    console.error(err);
    alert('Could not load ./assets/head.glb');
  }
);

function frameModel() {
  if (!modelRoot) return;

  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  modelRoot.position.sub(center);
  modelRoot.position.y -= size.y * 0.02;

  const maxDim = Math.max(size.x, size.y, size.z);
  const fitScale = 1.6 / maxDim;
  modelRoot.scale.setScalar(fitScale);

  const box2 = new THREE.Box3().setFromObject(modelRoot);
  const size2 = new THREE.Vector3();
  const center2 = new THREE.Vector3();
  box2.getSize(size2);
  box2.getCenter(center2);

  controls.target.copy(center2);
  camera.position.set(
    center2.x,
    center2.y + size2.y * 0.03,
    center2.z + size2.z * 1.85
  );
  controls.minDistance = size2.z * 0.7;
  controls.maxDistance = size2.z * 3.5;
  controls.update();

  baseModelY = modelRoot.position.y;

  // broad fleshy default based on actual object size
  sculptRadius = Math.max(size2.x, size2.y, size2.z) * 0.11;
}

function updatePointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getMeshHit(event) {
  if (!sculptMesh) return null;

  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(sculptMesh, false);
  return hits[0] || null;
}

function startMeshDrag(event, hit) {
  isDraggingMesh = true;
  dragPointerId = event.pointerId;
  controls.enabled = false;

  hitPointWorld.copy(hit.point);
  lastLocalHit.copy(sculptMesh.worldToLocal(hit.point.clone()));

  worldNormal.copy(hit.face.normal)
    .transformDirection(sculptMesh.matrixWorld)
    .normalize();

  dragPlane.setFromNormalAndCoplanarPoint(worldNormal, hit.point);

  raycaster.setFromCamera(pointer, camera);
  raycaster.ray.intersectPlane(dragPlane, dragStartPoint);
}

function getPointerForceMultiplier(event) {
  return event.pointerType === 'touch'
    ? TOUCH_FORCE_MULTIPLIER
    : MOUSE_FORCE_MULTIPLIER;
}

function clampOffsetAtIndex(i) {
  const ox = currentOffsets[i];
  const oy = currentOffsets[i + 1];
  const oz = currentOffsets[i + 2];
  const len = Math.hypot(ox, oy, oz);

  if (len > MAX_OFFSET_FROM_BASE) {
    const scale = MAX_OFFSET_FROM_BASE / len;
    currentOffsets[i] *= scale;
    currentOffsets[i + 1] *= scale;
    currentOffsets[i + 2] *= scale;
  }
}

function syncGeometryFromOffsets() {
  if (!sculptMesh || !basePositions || !currentOffsets) return;

  const geometry = sculptMesh.geometry;
  const posAttr = geometry.attributes.position;
  const normalAttr = geometry.attributes.normal;
  const positions = posAttr.array;

  for (let i = 0; i < positions.length; i++) {
    positions[i] = basePositions[i] + currentOffsets[i];
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  if (normalAttr) normalAttr.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function applySculptDelta(newPlanePoint, event) {
  if (!sculptMesh || !currentOffsets || !vertexVelocities) return;

  const deltaWorld = tempVec.copy(newPlanePoint).sub(dragStartPoint);
  const deltaLength = deltaWorld.length();
  if (deltaLength === 0) return;

  const clampedDeltaLength = Math.min(deltaLength, MAX_WORLD_DELTA_PER_STEP);
  deltaWorld
    .normalize()
    .multiplyScalar(clampedDeltaLength * getPointerForceMultiplier(event));

  inverseMatrix.copy(sculptMesh.matrixWorld).invert();
  const deltaLocal = localDeltaVec.copy(deltaWorld).transformDirection(inverseMatrix);

  for (let i = 0; i < basePositions.length; i += 3) {
    const bx = basePositions[i];
    const by = basePositions[i + 1];
    const bz = basePositions[i + 2];

    const dist = Math.hypot(
      bx - lastLocalHit.x,
      by - lastLocalHit.y,
      bz - lastLocalHit.z
    );

    if (dist > sculptRadius) continue;

    const normalized = dist / sculptRadius;
    const falloff = Math.max(0, 1 - normalized);

    // broad, fleshy falloff instead of pointy poke
    const influence = (0.35 + 0.65 * falloff) * falloff * sculptStrength;

    currentOffsets[i] += deltaLocal.x * influence;
    currentOffsets[i + 1] += deltaLocal.y * influence;
    currentOffsets[i + 2] += deltaLocal.z * influence;

    // spring impulse for rubbery recoil
    vertexVelocities[i] += deltaLocal.x * influence * 18.0;
    vertexVelocities[i + 1] += deltaLocal.y * influence * 18.0;
    vertexVelocities[i + 2] += deltaLocal.z * influence * 18.0;

    clampOffsetAtIndex(i);
  }

  syncGeometryFromOffsets();
  dragStartPoint.copy(newPlanePoint);
}

function endMeshDrag(event) {
  if (event.pointerId !== dragPointerId) return;
  isDraggingMesh = false;
  dragPointerId = null;
  controls.enabled = true;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  const hit = getMeshHit(event);
  if (!hit) return;

  updatePointerFromEvent(event);
  startMeshDrag(event, hit);
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!isDraggingMesh || event.pointerId !== dragPointerId) return;

  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
    applySculptDelta(planeHit, event);
  }
});

renderer.domElement.addEventListener('pointerup', endMeshDrag);
renderer.domElement.addEventListener('pointercancel', endMeshDrag);
renderer.domElement.addEventListener('lostpointercapture', () => {
  isDraggingMesh = false;
  dragPointerId = null;
  controls.enabled = true;
});

resetBtn.addEventListener('click', () => {
  if (!currentOffsets || !vertexVelocities) return;
  currentOffsets.fill(0);
  vertexVelocities.fill(0);
  syncGeometryFromOffsets();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function updateSpring(dt) {
  if (!sculptMesh || !currentOffsets || !vertexVelocities) return;

  let hasMotion = false;

  for (let i = 0; i < currentOffsets.length; i++) {
    const offset = currentOffsets[i];
    let velocity = vertexVelocities[i];

    const springForce = -offset * SPRING_STIFFNESS;
    velocity += springForce * dt;
    velocity *= Math.pow(SPRING_DAMPING, dt * 60);

    currentOffsets[i] += velocity * dt;

    if (Math.abs(currentOffsets[i]) < 0.00001 && Math.abs(velocity) < 0.00001) {
      currentOffsets[i] = 0;
      velocity = 0;
    } else {
      hasMotion = true;
    }

    vertexVelocities[i] = velocity;
  }

  if (hasMotion) {
    syncGeometryFromOffsets();
  }
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 1 / 30);
  floatPhase += dt;

  updateSpring(dt);

  if (modelRoot) {
    modelRoot.position.y = baseModelY + Math.sin(floatPhase * 1.3) * 0.0009;
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
