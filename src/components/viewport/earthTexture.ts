/**
 * Procedural Earth Canvas Texture Generator
 * Creates an offline, publication-grade WGS-84 Earth texture with oceans, continents,
 * latitude/longitude graticules, and equator markers without external image dependencies.
 */

import * as THREE from 'three';

export function createEarthCanvasTexture(): THREE.CanvasTexture {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  // 1. Base Deep Ocean Fill
  const oceanGradient = ctx.createLinearGradient(0, 0, 0, height);
  oceanGradient.addColorStop(0, '#061325'); // Arctic deep blue
  oceanGradient.addColorStop(0.5, '#040d1a'); // Equatorial abyss
  oceanGradient.addColorStop(1, '#061325'); // Antarctic deep blue
  ctx.fillStyle = oceanGradient;
  ctx.fillRect(0, 0, width, height);

  // 2. Simplified Continental Polygons (Equirectangular Projection)
  ctx.fillStyle = '#0f2744'; // Continental landmass base
  ctx.strokeStyle = '#1e4875'; // Coastlines
  ctx.lineWidth = 1.5;

  const toX = (lonDeg: number) => ((lonDeg + 180) / 360) * width;
  const toY = (latDeg: number) => ((90 - latDeg) / 180) * height;

  function drawContinent(points: [number, number][]) {
    if (!ctx || points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(toX(points[0][0]), toY(points[0][1]));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i][0]), toY(points[i][1]));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // North America
  drawContinent([
    [-165, 65], [-140, 70], [-100, 72], [-65, 62], [-55, 50],
    [-75, 35], [-80, 25], [-97, 20], [-105, 23], [-117, 32],
    [-124, 48], [-135, 58], [-165, 65]
  ]);

  // South America
  drawContinent([
    [-80, 10], [-50, -5], [-35, -7], [-40, -22], [-55, -35],
    [-68, -54], [-75, -45], [-72, -30], [-80, -5], [-80, 10]
  ]);

  // Eurasia & Europe
  drawContinent([
    [-10, 36], [0, 44], [15, 55], [30, 70], [60, 73], [100, 76],
    [170, 68], [140, 50], [120, 35], [105, 20], [80, 15],
    [65, 25], [45, 30], [35, 37], [25, 40], [10, 44], [-5, 48], [-10, 36]
  ]);

  // Africa
  drawContinent([
    [-15, 30], [10, 37], [32, 31], [43, 12], [51, 10],
    [40, -15], [30, -32], [18, -34], [12, -18], [0, 5],
    [-15, 12], [-17, 22], [-15, 30]
  ]);

  // Australia
  drawContinent([
    [115, -22], [130, -12], [142, -11], [150, -23], [152, -33],
    [140, -38], [128, -35], [115, -34], [115, -22]
  ]);

  // Antarctica
  drawContinent([
    [-180, -75], [0, -70], [180, -75], [180, -90], [-180, -90]
  ]);

  // 3. Coordinate Graticule (Lat/Lon grid)
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)'; // Subtle Cyan hairline
  ctx.lineWidth = 1;

  // Parallels (every 30 degrees)
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = toY(lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Meridians (every 30 degrees)
  for (let lon = -150; lon <= 180; lon += 30) {
    const x = toX(lon);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Equator Highlight (0 deg lat)
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, toY(0));
  ctx.lineTo(width, toY(0));
  ctx.stroke();

  // Prime Meridian Highlight (0 deg lon)
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
  ctx.beginPath();
  ctx.moveTo(toX(0), 0);
  ctx.lineTo(toX(0), height);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
