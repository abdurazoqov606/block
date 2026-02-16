
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { HandResults } from './types';

declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const previewCubeRef = useRef<THREE.Group | null>(null);
  const placedCubesRef = useRef<THREE.Group[]>([]);
  const lastPinchStateRef = useRef<boolean>(false);
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [blockCount, setBlockCount] = useState(0);

  // Constants
  const GRID_SIZE = 1;
  const PINCH_THRESHOLD = 0.045; // Fine-tuned for mobile
  const BUILD_DISTANCE = 6; // Units away from camera

  // Initialize Three.js
  useEffect(() => {
    if (!containerRef.current || !videoRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.set(0, 0, 0); // Camera at origin for AR
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // AR Video Background
    const videoTexture = new THREE.VideoTexture(videoRef.current);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    scene.background = videoTexture;

    // Preview Cube
    const createVoxel = (color: number, opacity: number, outlineColor: number) => {
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE);
      const material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity });
      const mesh = new THREE.Mesh(geometry, material);
      
      const edges = new THREE.EdgesGeometry(geometry);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: outlineColor, linewidth: 2 }));
      
      group.add(mesh);
      group.add(line);
      return group;
    };

    const preview = createVoxel(0x3b82f6, 0.6, 0x60a5fa);
    preview.visible = false;
    scene.add(preview);
    previewCubeRef.current = preview;

    const handleResize = () => {
      if (!camera || !renderer) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    const animate = () => {
      requestAnimationFrame(animate);
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // Screen to Snapped World Coords
  const getSnappedWorldPosition = useCallback((x: number, y: number) => {
    if (!cameraRef.current) return new THREE.Vector3();

    // MediaPipe (0,0) is top-left. Three.js NDC (-1 to 1)
    const ndcX = (x * 2) - 1;
    const ndcY = -(y * 2) + 1;

    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(cameraRef.current);
    const dir = vector.sub(cameraRef.current.position).normalize();
    const targetPos = cameraRef.current.position.clone().add(dir.multiplyScalar(BUILD_DISTANCE));

    // Snapping logic
    return new THREE.Vector3(
      Math.round(targetPos.x / GRID_SIZE) * GRID_SIZE,
      Math.round(targetPos.y / GRID_SIZE) * GRID_SIZE,
      Math.round(targetPos.z / GRID_SIZE) * GRID_SIZE
    );
  }, []);

  const placeBlock = (position: THREE.Vector3) => {
    if (!sceneRef.current) return;
    
    // Check for overlap
    const exists = placedCubesRef.current.some(c => c.position.equals(position));
    if (exists) return;

    const voxel = new THREE.Group();
    const geometry = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 1.5 }));
    
    voxel.add(mesh);
    voxel.add(line);
    voxel.position.copy(position);
    
    sceneRef.current.add(voxel);
    placedCubesRef.current.push(voxel);
    setBlockCount(prev => prev + 1);
  };

  // MediaPipe Initialization
  useEffect(() => {
    if (!videoRef.current) return;

    const hands = new window.Hands({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.8,
      minTrackingConfidence: 0.8
    });

    hands.onResults((results: HandResults) => {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];

        const dist = Math.sqrt(
          Math.pow(thumbTip.x - indexTip.x, 2) +
          Math.pow(thumbTip.y - indexTip.y, 2) +
          Math.pow(thumbTip.z - indexTip.z, 2)
        );

        const isPinching = dist < PINCH_THRESHOLD;
        const midpointX = (thumbTip.x + indexTip.x) / 2;
        const midpointY = (thumbTip.y + indexTip.y) / 2;

        const snappedPos = getSnappedWorldPosition(midpointX, midpointY);

        if (previewCubeRef.current) {
          previewCubeRef.current.position.copy(snappedPos);
          previewCubeRef.current.visible = isPinching;
        }

        // Trigger on release
        if (lastPinchStateRef.current && !isPinching) {
          placeBlock(snappedPos);
        }

        lastPinchStateRef.current = isPinching;
      } else {
        if (previewCubeRef.current) previewCubeRef.current.visible = false;
        lastPinchStateRef.current = false;
      }
    });

    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 1280,
      height: 720,
      facingMode: 'environment' // Use back camera
    });

    camera.start().then(() => setIsLoaded(true));

    return () => camera.stop();
  }, [getSnappedWorldPosition]);

  const resetScene = () => {
    if (!sceneRef.current) return;
    placedCubesRef.current.forEach(c => sceneRef.current?.remove(c));
    placedCubesRef.current = [];
    setBlockCount(0);
  };

  return (
    <div className="relative w-full h-full">
      <video ref={videoRef} playsInline muted />
      
      <div ref={containerRef} className="absolute inset-0 z-10" />

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 p-6 z-20 pointer-events-none w-full flex justify-between items-start">
        <div className="flex flex-col">
          <h1 className="text-3xl font-black text-blue-500 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] tracking-tighter uppercase italic">
            AR Voxel
          </h1>
          <p className="text-xs text-white/70 font-bold tracking-widest bg-black/40 px-2 py-0.5 rounded backdrop-blur-sm self-start">
            GRID SNAPPING ACTIVE
          </p>
        </div>
        
        <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
          <span className="text-white/50 text-[10px] uppercase font-bold mr-2">Blocks</span>
          <span className="text-xl font-mono font-bold text-white">{blockCount}</span>
        </div>
      </div>

      {/* Help Hint */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex flex-col items-center opacity-40">
         <div className="w-1 border-l-2 border-white/20 h-20 mb-4" />
         <p className="text-[10px] text-white uppercase tracking-[0.3em]">Building Plane</p>
         <div className="w-1 border-l-2 border-white/20 h-20 mt-4" />
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-10 left-0 w-full px-8 z-30 flex justify-center items-center pointer-events-none">
        <div className="flex space-x-4 pointer-events-auto">
          <button 
            onClick={resetScene}
            className="bg-red-500 hover:bg-red-600 px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl transition-all active:scale-95"
          >
            Clear Scene
          </button>
        </div>
      </div>

      {/* Interaction Instruction */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center">
         <div className="bg-blue-500/20 backdrop-blur-xl border border-blue-500/30 px-6 py-3 rounded-2xl">
            <p className="text-xs font-bold text-white/90">
              <span className="text-blue-400">Pinch</span> to Preview • <span className="text-blue-400">Release</span> to Build
            </p>
         </div>
      </div>

      {/* Loader */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-bold tracking-[0.5em] text-white uppercase animate-pulse">
            Booting Neural AR
          </p>
        </div>
      )}
    </div>
  );
};

export default App;
