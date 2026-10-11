/**
 * Tactical 3D Astrodynamics Globe Viewport
 * Built with Three.js WebGL: renders Earth, Keplerian orbit paths with eclipse shading,
 * instanced satellite points, 3D encounter covariance ellipsoids,
 * Ground Station Line-of-Sight visibility cones, 360-degree radar sweep,
 * and dynamic Solar Position lighting with Earth day/night terminator & eclipse detection.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { CameraMode, ConjunctionEvent, OrbitalObject } from '../../astrodynamics/types.ts';
import { generateOrbitPathEci, propagateOrbit } from '../../astrodynamics/propagator.ts';
import { getGmstRad, getJulianDate } from '../../astrodynamics/coordinates.ts';
import { GROUND_STATIONS_CATALOG, GroundStation, checkStationLineOfSight, DownlinkPassState } from '../../astrodynamics/groundStations.ts';
import { calculateSunPositionEci, calculateSatelliteEclipse, SatelliteEclipseResult } from '../../astrodynamics/solarCalculator.ts';
import { createEarthCanvasTexture } from './earthTexture.ts';
import { createRadarSweepTexture } from './radarSweepTexture.ts';
import { RotateCcw, Compass, Radio, Antenna, Scan, Sun, Moon } from 'lucide-react';

interface TacticalGlobeProps {
  objects: OrbitalObject[];
  selectedObject: OrbitalObject | null;
  onSelectObject: (obj: OrbitalObject | null) => void;
  selectedConjunction: ConjunctionEvent | null;
  currentTimeMs: number;
  timeWarp: number;
  onTimeWarpChange: (warp: number) => void;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
}

// 1 Three.js unit = 1,000 km
const EARTH_RADIUS_UNITS = 6.378137;

/**
 * Converts geographic coordinates (latitude, longitude) to 3D Cartesian position
 * matching the procedural Earth texture equirectangular projection.
 */
function geoToVector3(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = latDeg * (Math.PI / 180);
  const theta = (lonDeg + 180) * (Math.PI / 180);
  const x = -(radius * Math.cos(phi) * Math.cos(theta));
  const y = radius * Math.sin(phi);
  const z = radius * Math.cos(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

export const TacticalGlobe: React.FC<TacticalGlobeProps> = ({
  objects,
  selectedObject,
  onSelectObject,
  selectedConjunction,
  currentTimeMs,
  timeWarp,
  onTimeWarpChange,
  cameraMode,
  onCameraModeChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Layer toggles
  const [showOrbits, setShowOrbits] = useState<boolean>(true);
  const [showDebrisCloud, setShowDebrisCloud] = useState<boolean>(true);
  const [showCovariance, setShowCovariance] = useState<boolean>(true);
  const [showGroundStations, setShowGroundStations] = useState<boolean>(true);
  const [showRadarSweep, setShowRadarSweep] = useState<boolean>(true);
  const [showSunLighting, setShowSunLighting] = useState<boolean>(true);

  // Active Downlink Pass State
  const [activeDownlink, setActiveDownlink] = useState<DownlinkPassState | null>(null);
  // Current radar sweep azimuth angle in degrees
  const [sweepAzimuthDeg, setSweepAzimuthDeg] = useState<number>(0);
  // Selected satellite eclipse state
  const [satelliteEclipse, setSatelliteEclipse] = useState<SatelliteEclipseResult | null>(null);

  // Three.js instances ref
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    earthMesh: THREE.Mesh;
    atmosphereMesh: THREE.Mesh;
    earthGroup: THREE.Group;
    ambientLight: THREE.AmbientLight;
    sunLight: THREE.DirectionalLight;
    sunMarkerGroup: THREE.Group;
    orbitLinesGroup: THREE.Group;
    debrisPointCloud: THREE.Points | null;
    activePointCloud: THREE.Points | null;
    covarianceGroup: THREE.Group;
    groundStationsGroup: THREE.Group;
    downlinkLinesGroup: THREE.Group;
    stationConeMeshes: Map<string, THREE.Mesh>;
    radarGroup: THREE.Group;
    radarSweepMesh: THREE.Mesh;
    targetLockTarget: THREE.Vector3;
    isDragging: boolean;
    previousMousePosition: { x: number; y: number };
    spherical: { radius: number; theta: number; phi: number };
  } | null>(null);

  // Initialize Scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#07090E');

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    camera.position.set(0, 8, 26);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Groups
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);

    // Earth Sphere Geometry
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 64, 48);
    const earthTexture = createEarthCanvasTexture();
    const earthMaterial = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.85,
      metalness: 0.1
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    earthGroup.add(earthMesh);

    // Atmosphere Glow Mesh
    const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.025, 48, 36);
    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    earthGroup.add(atmosphereMesh);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
    sunLight.position.set(40, 10, 20);
    scene.add(sunLight);

    // Sun Marker Group (Visual Sun in the sky)
    const sunMarkerGroup = new THREE.Group();
    const sunGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMarkerGroup.add(sunMesh);

    const sunCoronaGeo = new THREE.RingGeometry(1.5, 3.6, 32);
    const sunCoronaMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide
    });
    const sunCoronaMesh = new THREE.Mesh(sunCoronaGeo, sunCoronaMat);
    sunCoronaMesh.lookAt(new THREE.Vector3(0, 0, 0));
    sunMarkerGroup.add(sunCoronaMesh);

    scene.add(sunMarkerGroup);

    // Orbit lines group
    const orbitLinesGroup = new THREE.Group();
    scene.add(orbitLinesGroup);

    // Covariance encounter group
    const covarianceGroup = new THREE.Group();
    scene.add(covarianceGroup);

    // Downlink beams group (in inertial space)
    const downlinkLinesGroup = new THREE.Group();
    scene.add(downlinkLinesGroup);

    // Ground Stations Group (attached directly to earthMesh)
    const groundStationsGroup = new THREE.Group();
    earthMesh.add(groundStationsGroup);

    const stationConeMeshes = new Map<string, THREE.Mesh>();

    // Build Ground Station Cones & Antenna Markers
    const coneHeight = 2.0;
    const coneTopRadius = 2.3;

    GROUND_STATIONS_CATALOG.forEach(station => {
      const stationPos = geoToVector3(station.latitudeDeg, station.longitudeDeg, EARTH_RADIUS_UNITS);
      const normal = stationPos.clone().normalize();

      const beaconGeo = new THREE.SphereGeometry(0.065, 12, 12);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.copy(stationPos);
      groundStationsGroup.add(beaconMesh);

      const coneGeo = new THREE.ConeGeometry(coneTopRadius, coneHeight, 32, 1, true);
      coneGeo.rotateX(Math.PI);
      coneGeo.translate(0, coneHeight / 2, 0);

      const coneMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const coneMesh = new THREE.Mesh(coneGeo, coneMat);

      coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      coneMesh.position.copy(stationPos);
      groundStationsGroup.add(coneMesh);
      stationConeMeshes.set(station.id, coneMesh);

      const rimGeo = new THREE.BufferGeometry();
      const rimPoints: THREE.Vector3[] = [];
      const segments = 36;
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        rimPoints.push(new THREE.Vector3(Math.cos(theta) * coneTopRadius, coneHeight, Math.sin(theta) * coneTopRadius));
      }
      rimGeo.setFromPoints(rimPoints);
      const rimMat = new THREE.LineBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.35
      });
      const rimLine = new THREE.Line(rimGeo, rimMat);
      rimLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      rimLine.position.copy(stationPos);
      groundStationsGroup.add(rimLine);
    });

    // 3D Orbital Debris Radar Sweep Overlay Group
    const radarGroup = new THREE.Group();
    radarGroup.rotation.x = Math.PI / 2;
    scene.add(radarGroup);

    const rangeRingRadii = [8.4, 11.5, 15.0];
    rangeRingRadii.forEach(r => {
      const ringPoints: THREE.Vector3[] = [];
      const segs = 64;
      for (let i = 0; i <= segs; i++) {
        const angle = (i / segs) * Math.PI * 2;
        ringPoints.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
      const ringMat = new THREE.LineBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.18
      });
      const ringLine = new THREE.Line(ringGeo, ringMat);
      radarGroup.add(ringLine);
    });

    const maxRadius = 15.2;
    const crosshairGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-maxRadius, 0, 0),
      new THREE.Vector3(maxRadius, 0, 0),
      new THREE.Vector3(0, -maxRadius, 0),
      new THREE.Vector3(0, maxRadius, 0)
    ]);
    const crosshairMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.14
    });
    const crosshairLine = new THREE.LineSegments(crosshairGeo, crosshairMat);
    radarGroup.add(crosshairLine);

    const sweepRingGeo = new THREE.RingGeometry(EARTH_RADIUS_UNITS * 1.01, maxRadius, 64, 1);
    const radarSweepTexture = createRadarSweepTexture();
    const sweepMat = new THREE.MeshBasicMaterial({
      map: radarSweepTexture,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const radarSweepMesh = new THREE.Mesh(sweepRingGeo, sweepMat);
    radarGroup.add(radarSweepMesh);

    // Camera Spherical Coordinates
    const spherical = {
      radius: 28,
      theta: 0.6,
      phi: 1.2
    };

    sceneRef.current = {
      scene,
      camera,
      renderer,
      earthMesh,
      atmosphereMesh,
      earthGroup,
      ambientLight,
      sunLight,
      sunMarkerGroup,
      orbitLinesGroup,
      debrisPointCloud: null,
      activePointCloud: null,
      covarianceGroup,
      groundStationsGroup,
      downlinkLinesGroup,
      stationConeMeshes,
      radarGroup,
      radarSweepMesh,
      targetLockTarget: new THREE.Vector3(0, 0, 0),
      isDragging: false,
      previousMousePosition: { x: 0, y: 0 },
      spherical
    };

    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      sceneRef.current.camera.aspect = w / h;
      sceneRef.current.camera.updateProjectionMatrix();
      sceneRef.current.renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      sweepRingGeo.dispose();
      sweepMat.dispose();
    };
  }, []);

  // Mouse Interaction (Orbit Controls)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      if (!sceneRef.current) return;
      sceneRef.current.isDragging = true;
      sceneRef.current.previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!sceneRef.current || !sceneRef.current.isDragging) return;
      const deltaX = e.clientX - sceneRef.current.previousMousePosition.x;
      const deltaY = e.clientY - sceneRef.current.previousMousePosition.y;

      sceneRef.current.spherical.theta -= deltaX * 0.006;
      sceneRef.current.spherical.phi = Math.max(
        0.08,
        Math.min(Math.PI - 0.08, sceneRef.current.spherical.phi - deltaY * 0.006)
      );

      sceneRef.current.previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      if (sceneRef.current) {
        sceneRef.current.isDragging = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!sceneRef.current) return;
      const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
      sceneRef.current.spherical.radius = Math.max(
        EARTH_RADIUS_UNITS * 1.15,
        Math.min(120, sceneRef.current.spherical.radius * zoomFactor)
      );
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Update Points & Geometry for Satellites / Debris
  useEffect(() => {
    if (!sceneRef.current || objects.length === 0) return;
    const { scene } = sceneRef.current;

    if (sceneRef.current.debrisPointCloud) scene.remove(sceneRef.current.debrisPointCloud);
    if (sceneRef.current.activePointCloud) scene.remove(sceneRef.current.activePointCloud);

    const activePositions: number[] = [];
    const debrisPositions: number[] = [];

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const [x, y, z] = obj.currentState.positionEci;
      const uX = x / 1000.0;
      const uY = z / 1000.0;
      const uZ = -y / 1000.0;

      if (obj.classification === 'ACTIVE_PAYLOAD') {
        activePositions.push(uX, uY, uZ);
      } else {
        debrisPositions.push(uX, uY, uZ);
      }
    }

    const activeGeo = new THREE.BufferGeometry();
    activeGeo.setAttribute('position', new THREE.Float32BufferAttribute(activePositions, 3));
    const activeMat = new THREE.PointsMaterial({
      color: 0x06b6d4,
      size: 0.16,
      transparent: true,
      opacity: 0.9
    });
    const activePoints = new THREE.Points(activeGeo, activeMat);
    scene.add(activePoints);
    sceneRef.current.activePointCloud = activePoints;

    if (showDebrisCloud) {
      const debrisGeo = new THREE.BufferGeometry();
      debrisGeo.setAttribute('position', new THREE.Float32BufferAttribute(debrisPositions, 3));
      const debrisMat = new THREE.PointsMaterial({
        color: 0xf59e0b,
        size: 0.11,
        transparent: true,
        opacity: 0.65
      });
      const debrisPoints = new THREE.Points(debrisGeo, debrisMat);
      scene.add(debrisPoints);
      sceneRef.current.debrisPointCloud = debrisPoints;
    }
  }, [objects, showDebrisCloud]);

  // Visibility toggle for Ground Stations, Radar Sweep, & Sun Lighting
  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.groundStationsGroup.visible = showGroundStations;
    sceneRef.current.downlinkLinesGroup.visible = showGroundStations;
    sceneRef.current.radarGroup.visible = showRadarSweep;
    sceneRef.current.sunMarkerGroup.visible = showSunLighting;

    if (showSunLighting) {
      sceneRef.current.ambientLight.intensity = 0.16;
      sceneRef.current.sunLight.intensity = 2.4;
    } else {
      sceneRef.current.ambientLight.intensity = 0.65;
      sceneRef.current.sunLight.intensity = 1.2;
    }
  }, [showGroundStations, showRadarSweep, showSunLighting]);

  // Update Orbit Trajectories & Encounter Ellipsoids with Eclipse Shading
  useEffect(() => {
    if (!sceneRef.current) return;
    const { orbitLinesGroup, covarianceGroup } = sceneRef.current;

    while (orbitLinesGroup.children.length > 0) {
      const child = orbitLinesGroup.children[0] as THREE.Object3D;
      orbitLinesGroup.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }

    while (covarianceGroup.children.length > 0) {
      const child = covarianceGroup.children[0] as THREE.Mesh;
      covarianceGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }

    if (!showOrbits) return;

    const jd = getJulianDate(currentTimeMs);
    const sunPos = calculateSunPositionEci(jd);
    const sunVecEci = sunPos.sunVectorEci;

    // Helper to build orbit line segments with eclipse vertex colors
    const buildOrbitSegments = (keplerian: any, baseColorHex: number, threat: boolean = false) => {
      const samples = 120;
      const periodSec = keplerian.periodMinutes * 60.0;
      const dt = periodSec / samples;

      const positions: number[] = [];
      const colors: number[] = [];

      const colorSun = new THREE.Color(baseColorHex);
      const colorUmbra = new THREE.Color(threat ? 0x991b1b : 0x6366f1); // Darker indigo/violet in eclipse
      const colorPenumbra = new THREE.Color(threat ? 0xd97706 : 0xa855f7);

      for (let i = 0; i < samples; i++) {
        const t1 = currentTimeMs + i * dt * 1000.0;
        const t2 = currentTimeMs + (i + 1) * dt * 1000.0;

        const s1 = propagateOrbit(keplerian, t1);
        const s2 = propagateOrbit(keplerian, t2);

        positions.push(
          s1.positionEci[0] / 1000.0, s1.positionEci[2] / 1000.0, -s1.positionEci[1] / 1000.0,
          s2.positionEci[0] / 1000.0, s2.positionEci[2] / 1000.0, -s2.positionEci[1] / 1000.0
        );

        if (showSunLighting) {
          const midPos: [number, number, number] = [
            (s1.positionEci[0] + s2.positionEci[0]) / 2,
            (s1.positionEci[1] + s2.positionEci[1]) / 2,
            (s1.positionEci[2] + s2.positionEci[2]) / 2
          ];
          const eclipse = calculateSatelliteEclipse(midPos, sunVecEci);

          const c = eclipse.state === 'UMBRA' ? colorUmbra : eclipse.state === 'PENUMBRA' ? colorPenumbra : colorSun;
          colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        } else {
          colors.push(colorSun.r, colorSun.g, colorSun.b, colorSun.r, colorSun.g, colorSun.b);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: threat ? 2.5 : 2,
        transparent: true,
        opacity: 0.95
      });

      return new THREE.LineSegments(geo, mat);
    };

    // 1. Draw Selected Object Orbit
    if (selectedObject) {
      const orbitSegments = buildOrbitSegments(selectedObject.keplerian, 0x06b6d4, false);
      orbitLinesGroup.add(orbitSegments);
    }

    // 2. Draw Conjunction Pair Orbits
    if (selectedConjunction) {
      const primary = selectedConjunction.primaryObject;
      const secondary = selectedConjunction.secondaryObject;

      const pSegments = buildOrbitSegments(primary.keplerian, 0x00f0ff, false);
      orbitLinesGroup.add(pSegments);

      const sSegments = buildOrbitSegments(secondary.keplerian, 0xef4444, true);
      orbitLinesGroup.add(sSegments);

      // 3. Render 3D Covariance Ellipsoids at TCA
      if (showCovariance) {
        const pTcaState = propagateOrbit(primary.keplerian, selectedConjunction.tcaTimestampMs);
        const sTcaState = propagateOrbit(secondary.keplerian, selectedConjunction.tcaTimestampMs);

        const pPos = new THREE.Vector3(
          pTcaState.positionEci[0] / 1000.0,
          pTcaState.positionEci[2] / 1000.0,
          -pTcaState.positionEci[1] / 1000.0
        );

        const sPos = new THREE.Vector3(
          sTcaState.positionEci[0] / 1000.0,
          sTcaState.positionEci[2] / 1000.0,
          -sTcaState.positionEci[1] / 1000.0
        );

        const [sigR, sigI, sigC] = primary.covarianceSigmaKm;
        const scaleFactor = 0.8;

        const pEllipGeo = new THREE.SphereGeometry(1, 24, 16);
        pEllipGeo.scale(
          Math.max(0.12, sigR * 3.0 * scaleFactor),
          Math.max(0.12, sigC * 3.0 * scaleFactor),
          Math.max(0.12, sigI * 3.0 * scaleFactor)
        );
        const pEllipMat = new THREE.MeshBasicMaterial({
          color: 0x06b6d4,
          wireframe: true,
          transparent: true,
          opacity: 0.45
        });
        const pEllipMesh = new THREE.Mesh(pEllipGeo, pEllipMat);
        pEllipMesh.position.copy(pPos);
        covarianceGroup.add(pEllipMesh);

        const [sSigR, sSigI, sSigC] = secondary.covarianceSigmaKm;
        const sEllipGeo = new THREE.SphereGeometry(1, 24, 16);
        sEllipGeo.scale(
          Math.max(0.12, sSigR * 3.0 * scaleFactor),
          Math.max(0.12, sSigC * 3.0 * scaleFactor),
          Math.max(0.12, sSigI * 3.0 * scaleFactor)
        );
        const sEllipMat = new THREE.MeshBasicMaterial({
          color: 0xef4444,
          wireframe: true,
          transparent: true,
          opacity: 0.65
        });
        const sEllipMesh = new THREE.Mesh(sEllipGeo, sEllipMat);
        sEllipMesh.position.copy(sPos);
        covarianceGroup.add(sEllipMesh);

        const missLineGeo = new THREE.BufferGeometry().setFromPoints([pPos, sPos]);
        const missLineMat = new THREE.LineDashedMaterial({
          color: 0xffffff,
          dashSize: 0.2,
          gapSize: 0.1
        });
        const missLine = new THREE.Line(missLineGeo, missLineMat);
        missLine.computeLineDistances();
        covarianceGroup.add(missLine);
      }
    }
  }, [selectedObject, selectedConjunction, showOrbits, showCovariance, showSunLighting, currentTimeMs]);

  // Main Render Animation Loop
  useEffect(() => {
    let animId: number;
    let frameCount = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (!sceneRef.current) return;

      const {
        camera,
        renderer,
        scene,
        earthMesh,
        spherical,
        targetLockTarget,
        downlinkLinesGroup,
        stationConeMeshes,
        radarSweepMesh,
        sunLight,
        sunMarkerGroup
      } = sceneRef.current;

      const jd = getJulianDate(currentTimeMs);
      const gmstRad = getGmstRad(jd);
      earthMesh.rotation.y = gmstRad;

      // Update Sun position and dynamic day/night terminator
      const sunPos = calculateSunPositionEci(jd);
      const [sx, sy, sz] = sunPos.sunVectorEci;
      // Convert to Three.js coordinates (Z is Up, Y is negated Z)
      const sunDirThree = new THREE.Vector3(sx, sz, -sy).normalize();

      if (showSunLighting) {
        sunLight.position.copy(sunDirThree.clone().multiplyScalar(50.0));
        sunMarkerGroup.position.copy(sunDirThree.clone().multiplyScalar(46.0));
      }

      // Rotate 360-degree radar sweep disk
      if (showRadarSweep && radarSweepMesh) {
        radarSweepMesh.rotation.z += 0.015;
        frameCount++;
        if (frameCount % 6 === 0) {
          const az = Math.floor(((radarSweepMesh.rotation.z * 180) / Math.PI) % 360);
          setSweepAzimuthDeg(az >= 0 ? az : az + 360);
        }
      }

      // Camera positioning based on mode
      let center = new THREE.Vector3(0, 0, 0);

      if (cameraMode === 'TARGET_LOCK' && selectedObject) {
        const [x, y, z] = selectedObject.currentState.positionEci;
        targetLockTarget.set(x / 1000.0, z / 1000.0, -y / 1000.0);
        center = targetLockTarget;
      }

      const sinPhiRadius = spherical.radius * Math.sin(spherical.phi);
      camera.position.x = center.x + sinPhiRadius * Math.sin(spherical.theta);
      camera.position.y = center.y + spherical.radius * Math.cos(spherical.phi);
      camera.position.z = center.z + sinPhiRadius * Math.cos(spherical.theta);

      camera.lookAt(center);

      // Check Ground Station Line-of-Sight & Eclipse State for Selected Object
      while (downlinkLinesGroup.children.length > 0) {
        const child = downlinkLinesGroup.children[0] as THREE.Line;
        downlinkLinesGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
      }

      let detectedPass: DownlinkPassState | null = null;

      if (selectedObject) {
        const satPosEci = selectedObject.currentState.positionEci;
        const satThreePos = new THREE.Vector3(
          satPosEci[0] / 1000.0,
          satPosEci[2] / 1000.0,
          -satPosEci[1] / 1000.0
        );

        // Detect satellite eclipse
        const eclipseRes = calculateSatelliteEclipse(satPosEci, sunPos.sunVectorEci);
        setSatelliteEclipse(eclipseRes);

        if (showGroundStations) {
          for (const station of GROUND_STATIONS_CATALOG) {
            const pass = checkStationLineOfSight(station, satPosEci, gmstRad);
            const coneMesh = stationConeMeshes.get(station.id);

            if (pass.inView) {
              if (!detectedPass || pass.elevationDeg > detectedPass.elevationDeg) {
                detectedPass = pass;
              }

              if (coneMesh) {
                (coneMesh.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
                (coneMesh.material as THREE.MeshBasicMaterial).opacity = 0.28;
              }

              const stationLocalPos = geoToVector3(station.latitudeDeg, station.longitudeDeg, EARTH_RADIUS_UNITS);
              const stationWorldPos = stationLocalPos.clone().applyEuler(earthMesh.rotation);

              const beamGeo = new THREE.BufferGeometry().setFromPoints([stationWorldPos, satThreePos]);
              const beamMat = new THREE.LineBasicMaterial({
                color: 0x10b981,
                linewidth: 2,
                transparent: true,
                opacity: 0.95
              });
              const beamLine = new THREE.Line(beamGeo, beamMat);
              downlinkLinesGroup.add(beamLine);
            } else {
              if (coneMesh) {
                (coneMesh.material as THREE.MeshBasicMaterial).color.setHex(0x06b6d4);
                (coneMesh.material as THREE.MeshBasicMaterial).opacity = 0.08;
              }
            }
          }
        }
      } else {
        setSatelliteEclipse(null);
      }

      setActiveDownlink(detectedPass);
      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [cameraMode, selectedObject, currentTimeMs, showGroundStations, showRadarSweep, showSunLighting]);

  const handleResetCamera = () => {
    if (!sceneRef.current) return;
    sceneRef.current.spherical = { radius: 28, theta: 0.6, phi: 1.2 };
  };

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[460px] bg-[#07090E] overflow-hidden select-none">
      <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

      {/* Top Left HUD: Tactical Coordinate Frame, Solar Illumination & Radar */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 pointer-events-auto">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0f172a]/90 backdrop-blur-md border border-slate-700/80 rounded-md text-xs font-mono text-slate-200">
          <Compass className="w-3.5 h-3.5 text-cyan-400" />
          <span>FRAME:</span>
          <span className="font-semibold text-cyan-400">{cameraMode}</span>
          <span className="text-slate-500">·</span>
          <span>WGS-84</span>
        </div>

        {/* Real-Time Solar Illumination & Eclipse Status Badge */}
        {showSunLighting && satelliteEclipse && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur-md rounded-md text-xs font-mono border ${
            satelliteEclipse.state === 'SUNLIGHT'
              ? 'bg-[#0f172a]/90 border-amber-500/60 text-amber-300'
              : satelliteEclipse.state === 'PENUMBRA'
              ? 'bg-amber-950/80 border-amber-500/80 text-amber-300'
              : 'bg-indigo-950/90 border-indigo-500/80 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.35)]'
          }`}>
            {satelliteEclipse.state === 'SUNLIGHT' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            )}
            <span className="font-bold">
              {satelliteEclipse.state === 'SUNLIGHT'
                ? 'SUNLIT'
                : satelliteEclipse.state === 'PENUMBRA'
                ? 'PENUMBRA'
                : 'UMBRA (ECLIPSE)'}
            </span>
            <span className="text-slate-500">·</span>
            <span className="tabular-nums">{(satelliteEclipse.illuminationFraction * 100).toFixed(0)}% ILLUM</span>
            {satelliteEclipse.state === 'UMBRA' && (
              <span className="text-[10px] text-rose-400 font-bold ml-1">BATTERY DISCHARGE</span>
            )}
          </div>
        )}

        {/* 360-Degree Active Radar Sweep Status Banner */}
        {showRadarSweep && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0f172a]/90 backdrop-blur-md border border-cyan-500/60 rounded-md text-xs font-mono text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.25)]">
            <Scan className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>RADAR:</span>
            <span className="font-bold text-white tabular-nums">{sweepAzimuthDeg}° AZ</span>
            <span className="text-slate-500">·</span>
            <span className="text-[11px] text-cyan-400/90 font-semibold">DEBRIS SCAN</span>
          </div>
        )}

        {selectedConjunction && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/80 backdrop-blur-md border border-rose-500/60 rounded-md text-xs font-mono text-rose-300">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>CARA FOCUS:</span>
            <span className="font-bold">{selectedConjunction.primaryObject.name} ⚔ {selectedConjunction.secondaryObject.name}</span>
          </div>
        )}

        {/* Live Ground Station Downlink Telemetry Banner */}
        {activeDownlink && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-950/90 backdrop-blur-md border border-emerald-500/80 rounded-md text-xs font-mono text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="font-bold">DOWNLINK LOCK:</span>
            <span className="text-white font-semibold">{activeDownlink.station.callsign} ({activeDownlink.station.name})</span>
            <span className="text-emerald-500">·</span>
            <span>EL: <strong className="text-emerald-300">{activeDownlink.elevationDeg.toFixed(1)}°</strong></span>
            <span className="text-emerald-500">·</span>
            <span>AZ: <strong className="text-emerald-300">{activeDownlink.azimuthDeg.toFixed(1)}°</strong></span>
            <span className="text-emerald-500">·</span>
            <span>RANGE: <strong className="text-emerald-300">{activeDownlink.rangeKm.toFixed(0)} km</strong></span>
            <span className="text-emerald-500">·</span>
            <span className="text-emerald-400 font-bold">{activeDownlink.dataRateMbps} Mbps</span>
          </div>
        )}
      </div>

      {/* Top Right HUD: Viewport Layer Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 pointer-events-auto">
        <button
          onClick={() => setShowOrbits(!showOrbits)}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
            showOrbits
              ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
          title="Toggle Orbit Trajectory Lines"
        >
          ORBITS
        </button>

        <button
          onClick={() => setShowSunLighting(!showSunLighting)}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors flex items-center gap-1 ${
            showSunLighting
              ? 'bg-amber-950/80 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
          title="Toggle Dynamic Sun-Lighting & Eclipse Shading"
        >
          <Sun className="w-3 h-3 text-amber-400" />
          <span>SUN LIGHT</span>
        </button>

        <button
          onClick={() => setShowRadarSweep(!showRadarSweep)}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors flex items-center gap-1 ${
            showRadarSweep
              ? 'bg-cyan-950/80 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
          title="Toggle 360° Orbital Debris Surveillance Radar Sweep"
        >
          <Scan className="w-3 h-3 text-cyan-400" />
          <span>RADAR</span>
        </button>

        <button
          onClick={() => setShowGroundStations(!showGroundStations)}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors flex items-center gap-1 ${
            showGroundStations
              ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
          title="Toggle Ground Station Line-of-Sight Visibility Cones"
        >
          <Antenna className="w-3 h-3" />
          <span>STATIONS</span>
        </button>

        <button
          onClick={() => setShowDebrisCloud(!showDebrisCloud)}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
            showDebrisCloud
              ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
          title="Toggle Tracked Space Debris Cloud"
        >
          DEBRIS
        </button>

        <button
          onClick={() => setShowCovariance(!showCovariance)}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
            showCovariance
              ? 'bg-rose-950/80 border-rose-500/60 text-rose-300'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
          title="Toggle 3D Covariance Ellipsoids"
        >
          COVARIANCE
        </button>

        <button
          onClick={handleResetCamera}
          className="p-1.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded text-slate-300 transition-colors"
          title="Reset Camera Center"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom Floating Time Scrub & Camera Mode Toolbar */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Camera Frame Mode Selectors */}
        <div className="flex items-center gap-1 p-1 bg-[#0f172a]/90 backdrop-blur-md border border-slate-800 rounded-lg pointer-events-auto">
          <button
            onClick={() => onCameraModeChange('ECI')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              cameraMode === 'ECI'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ECI J2000
          </button>
          <button
            onClick={() => onCameraModeChange('ECEF')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              cameraMode === 'ECEF'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ECEF WGS-84
          </button>
          <button
            onClick={() => onCameraModeChange('TARGET_LOCK')}
            disabled={!selectedObject}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              cameraMode === 'TARGET_LOCK'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : selectedObject ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            LOCK ASSET
          </button>
        </div>

        {/* Time Warp HUD Controller */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0f172a]/90 backdrop-blur-md border border-slate-800 rounded-lg pointer-events-auto">
          <span className="text-xs font-mono text-slate-400">TIME WARP:</span>
          <div className="flex items-center gap-1">
            {[0, 1, 10, 60, 300].map(warp => (
              <button
                key={warp}
                onClick={() => onTimeWarpChange(warp)}
                className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                  timeWarp === warp
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {warp === 0 ? 'PAUSE' : `${warp}×`}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-[#0f172a]/90 backdrop-blur-md border border-slate-800 rounded-lg text-xs font-mono text-slate-400 pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <span>Sunlit Orbit</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span>Eclipse (Umbra)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>Station Downlink</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>Debris</span>
          </div>
        </div>
      </div>
    </div>
  );
};
