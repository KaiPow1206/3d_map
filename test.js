import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdcdcdc);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(200, 300, 200);
camera.up.set(0, 1, 0);
camera.lookAt(0, 0, 0);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- OrbitControls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = true;
controls.enableDamping = true;
controls.screenSpacePanning = true;
controls.enableZoom = true;
controls.enablePan = true;

controls.dampingFactor = 0.1;
controls.panSpeed = 0.5;
controls.zoomSpeed = 1;
controls.rotateSpeed = 0.5;

// Giới hạn zoom
controls.minDistance = 50;
controls.maxDistance = 400;

// Giới hạn pan (toàn cục)
let panLimit = null;


// Giới hạn xoay
controls.minPolarAngle = 0.6;   // ~28° từ ngang lên, giữ nguyên
controls.maxPolarAngle = 2.5;   // ~86° từ ngang xuống, nghiêng thêm chút


// Cho phép xoay trái/phải nhẹ (azimuth)
controls.minAzimuthAngle = -Math.PI / 3;
controls.maxAzimuthAngle = Math.PI /3;

// --- Lights ---
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(100, 200, 100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 500;
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
scene.add(dirLight);

const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
dirLight2.position.set(-100, 100, 100);
scene.add(dirLight2);

scene.add(new THREE.AmbientLight(0x404040, 0.6));

// --- Load OpenCV ---
async function loadOpenCv() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.x/opencv.js';
    script.onload = () => {
      cv['onRuntimeInitialized'] = () => resolve();
    };
    document.body.appendChild(script);
  });
}

// --- Init ---
async function init() {
  await loadOpenCv();
  console.log("OpenCV loaded");

  const fileInput = document.getElementById("upload");
  fileInput.disabled = false;

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'svg') {
      const text = await file.text();
      loadSVG(text);
    } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      const url = URL.createObjectURL(file);
      convertImageToSVG(url).then(svgText => loadSVG(svgText));
    }
  });
}

// --- Convert PNG/JPG → SVG ---
async function convertImageToSVG(imgUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxDim = 512;
      let scale = Math.min(maxDim / img.width, maxDim / img.height, 1);

      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let src = cv.imread(canvas);
      let gray = new cv.Mat();
      let edges = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
      cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
      cv.Canny(gray, edges, 20, 100);

      let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
      cv.morphologyEx(gray, gray, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, kernel);
      kernel.delete();

      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let svgPaths = '';
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const minArea = (canvas.width * canvas.height) * 0.00001;
        if (area < minArea) { contour.delete(); continue; }

        let pathD = '';
        for (let j = 0; j < contour.data32S.length; j += 2) {
          const x = contour.data32S[j];
          const y = contour.data32S[j + 1];
          pathD += (j === 0 ? `M${x},${y}` : ` L${x},${y}`);
        }
        pathD += ' Z';
        svgPaths += `<path d="${pathD}" fill="black"/>`;
        contour.delete();
      }

      const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">${svgPaths}</svg>`;
      src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
      resolve(svgText);
    };
    img.src = imgUrl;
  });
}

// --- Load SVG và tạo mesh 3D ---
function loadSVG(svgText) {
  const loader = new SVGLoader();
  const svgData = loader.parse(svgText);

  const group = new THREE.Group();
  svgData.paths.forEach(path => {
    const shapes = SVGLoader.createShapes(path);
    shapes.forEach(shape => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 70, // tăng độ dày
        bevelEnabled: true,
        bevelThickness: 1,
        bevelSize: 1,
        bevelOffset: 0,
        bevelSegments: 3
      });

      const material = new THREE.MeshPhongMaterial({
        color: 0xff6b35,
        shininess: 35,
        specular: 0x111111,
        side: THREE.DoubleSide,
        flatShading: false
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  });

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const scale = 200 / maxSize;
  group.scale.set(scale, scale, scale);

  const heightOffset = size.z * scale / 2; // làm vật thể nổi lên
  group.position.y += heightOffset;

  // Giới hạn pan quanh vật thể (sau khi đã di chuyển)
  const actualCenter = group.position.clone();
  panLimit = {
    xMin: actualCenter.x - size.x * scale * 0.2,
    xMax: actualCenter.x + size.x * scale * 0.5,
    yMin: actualCenter.y - size.y * scale * 0.2,
    yMax: actualCenter.y + size.y * scale * 0.5,
    zMin: actualCenter.z - size.z * scale * 0.5,
    zMax: actualCenter.z + size.z * scale * 0.5
  };

  const old = scene.getObjectByName('svgGroup');
  if (old) scene.remove(old);
  group.name = 'svgGroup';
  scene.add(group);

  resetCameraToTopView(group);
}

// --- Giới hạn pan ---
function clampControlsTarget() {
  if (!panLimit) return;
  const t = controls.target;
  t.x = Math.max(panLimit.xMin, Math.min(panLimit.xMax, t.x));
  t.y = Math.max(panLimit.yMin, Math.min(panLimit.yMax, t.y));
  t.z = Math.max(panLimit.zMin, Math.min(panLimit.zMax, t.z));
}

// --- Camera top view ---
function resetCameraToTopView(group) {
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);

  const distance = maxSize * 2;
  const height = maxSize * 1.5;

  camera.position.set(center.x, center.y + height, center.z + distance);
  camera.lookAt(center.x, center.y, center.z);

  controls.target.copy(center);
  controls.update();
}

// --- Animate ---
function animate() {
  requestAnimationFrame(animate);

  // Giới hạn pan
  clampControlsTarget();

  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
