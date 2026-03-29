// --- SPRINGY RUBBER VERSION ---

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
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.08, 2.35);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeHit = new THREE.Vector3();
const dragStartPoint = new THREE.Vector3();
const worldNormal = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const inverseMatrix = new THREE.Matrix4();

let sculptMesh = null;
let basePositions, offsets, velocities;

let isDragging = false;
let lastHit = new THREE.Vector3();

let sculptRadius = 0.15;
let sculptStrength = 0.05;

// 🔥 spring settings
const STIFFNESS = 12.0;
const DAMPING = 0.82;

const loader = new GLTFLoader();
loader.load('./assets/head.glb', (gltf) => {
  const root = gltf.scene;
  scene.add(root);

  root.traverse((c) => {
    if (c.isMesh && !sculptMesh) sculptMesh = c;
  });

  if (!sculptMesh) return;

  let geo = sculptMesh.geometry;
  geo = geo.index ? geo.toNonIndexed() : geo.clone();
  sculptMesh.geometry = geo;

  basePositions = geo.attributes.position.array.slice();
  offsets = new Float32Array(basePositions.length);
  velocities = new Float32Array(basePositions.length);
});

function updatePointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(sculptMesh)[0];
  if (!hit) return;

  isDragging = true;
  lastHit.copy(sculptMesh.worldToLocal(hit.point.clone()));

  worldNormal.copy(hit.face.normal).transformDirection(sculptMesh.matrixWorld);
  dragPlane.setFromNormalAndCoplanarPoint(worldNormal, hit.point);

  raycaster.ray.intersectPlane(dragPlane, dragStartPoint);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!isDragging) return;

  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);

  if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
    const delta = tempVec.copy(planeHit).sub(dragStartPoint);
    dragStartPoint.copy(planeHit);

    inverseMatrix.copy(sculptMesh.matrixWorld).invert();
    delta.transformDirection(inverseMatrix);

    for (let i = 0; i < offsets.length; i += 3) {
      const dx = basePositions[i] - lastHit.x;
      const dy = basePositions[i + 1] - lastHit.y;
      const dz = basePositions[i + 2] - lastHit.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

      if (dist > sculptRadius) continue;

      const f = (1 - dist / sculptRadius) ** 2 * sculptStrength;

      offsets[i] += delta.x * f;
      offsets[i+1] += delta.y * f;
      offsets[i+2] += delta.z * f;

      velocities[i] += delta.x * f * 20;
      velocities[i+1] += delta.y * f * 20;
      velocities[i+2] += delta.z * f * 20;
    }
  }
});

window.addEventListener('pointerup', () => isDragging = false);

resetBtn.onclick = () => {
  offsets.fill(0);
  velocities.fill(0);
};

function updateSpring(dt) {
  for (let i = 0; i < offsets.length; i++) {
    velocities[i] += (-offsets[i] * STIFFNESS) * dt;
    velocities[i] *= DAMPING;
    offsets[i] += velocities[i] * dt;
  }
}

function applyOffsets() {
  const pos = sculptMesh.geometry.attributes.position.array;
  for (let i = 0; i < pos.length; i++) {
    pos[i] = basePositions[i] + offsets[i];
  }
  sculptMesh.geometry.attributes.position.needsUpdate = true;
  sculptMesh.geometry.computeVertexNormals();
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (sculptMesh) {
    updateSpring(dt);
    applyOffsets();
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();
