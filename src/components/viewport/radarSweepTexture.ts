/**
 * Procedural Radar Sweep Canvas Texture Generator
 * Generates an angular phosphor sweep with leading bright edge
 * and fading exponential wake for 3D orbital space surveillance visualization.
 */

import * as THREE from 'three';

export function createRadarSweepTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Angular gradient sweep over 60 degrees (pi / 3 radians)
  // Draw pie slices with decreasing opacity to simulate radar phosphor wake
  const sweepAngleRad = Math.PI / 2.5; // ~72 degrees wake
  const steps = 72;

  for (let i = 0; i < steps; i++) {
    const startAngle = (i / steps) * sweepAngleRad;
    const endAngle = ((i + 1) / steps) * sweepAngleRad;
    // Exponential fade for realistic phosphor persistence
    const alpha = Math.pow(i / steps, 2.5) * 0.38;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();

    ctx.fillStyle = `rgba(6, 182, 212, ${alpha})`;
    ctx.fill();
  }

  // Leading sharp radar scan line at the front edge
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  const leadX = cx + radius * Math.cos(sweepAngleRad);
  const leadY = cy + radius * Math.sin(sweepAngleRad);
  ctx.lineTo(leadX, leadY);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Subtle glow around leading line
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(leadX, leadY);
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
  ctx.lineWidth = 6;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
