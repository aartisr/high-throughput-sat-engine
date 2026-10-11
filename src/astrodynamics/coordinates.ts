/**
 * Precision Coordinate Transformations: TEME / ECI (J2000) <-> ECEF <-> Geodetic <-> RIC Encounter Frame
 * Conforms to WGS-84 and IERS conventions.
 */

import {
  DEG2RAD,
  EARTH_ECC_SQUARED,
  EARTH_FLATTENING,
  R_EARTH_EQUATORIAL_KM,
  R_EARTH_POLAR_KM,
  RAD2DEG
} from './constants.ts';
import { RICEncounter } from './types.ts';

/**
 * Computes Julian Date (JD) from Unix Epoch timestamp (milliseconds)
 */
export function getJulianDate(timestampMs: number): number {
  return timestampMs / 86400000.0 + 2440587.5;
}

/**
 * Computes Greenwich Mean Sidereal Time (GMST) in radians from Julian Date
 * Uses IAU 1982 / 2000 GMST polynomial.
 */
export function getGmstRad(julianDate: number): number {
  const d = julianDate - 2451545.0; // days since J2000.0
  // GMST at 0h UT1 in degrees
  let gmstDeg = 280.46061837 + 360.98564736629 * d;
  gmstDeg = ((gmstDeg % 360.0) + 360.0) % 360.0;
  return gmstDeg * DEG2RAD;
}

/**
 * Converts ECI (Earth-Centered Inertial) position to ECEF (Earth-Centered Earth-Fixed)
 * by rotating about Z-axis by the GMST angle theta.
 */
export function eciToEcef(
  positionEci: [number, number, number],
  gmstRad: number
): [number, number, number] {
  const [x, y, z] = positionEci;
  const cosT = Math.cos(gmstRad);
  const sinT = Math.sin(gmstRad);

  const xEcef = x * cosT + y * sinT;
  const yEcef = -x * sinT + y * cosT;
  const zEcef = z;

  return [xEcef, yEcef, zEcef];
}

/**
 * Converts ECEF coordinates (km) to Geodetic Latitude, Longitude, and Altitude
 * using Bowring's closed-form algorithm (accurate to within millimeters on WGS-84).
 */
export function ecefToGeodetic(
  positionEcef: [number, number, number]
): { latitudeDeg: number; longitudeDeg: number; altitudeKm: number } {
  const [x, y, z] = positionEcef;
  const p = Math.sqrt(x * x + y * y);
  
  if (p < 1e-6) {
    // Polar singularity
    const lat = z >= 0 ? 90.0 : -90.0;
    const alt = Math.abs(z) - R_EARTH_POLAR_KM;
    return { latitudeDeg: lat, longitudeDeg: 0, altitudeKm: alt };
  }

  // Longitude lambda = atan2(y, x)
  let lonDeg = Math.atan2(y, x) * RAD2DEG;
  if (lonDeg > 180.0) lonDeg -= 360.0;
  if (lonDeg < -180.0) lonDeg += 360.0;

  // Bowring's method for latitude
  const a = R_EARTH_EQUATORIAL_KM;
  const b = R_EARTH_POLAR_KM;
  const e2 = EARTH_ECC_SQUARED;
  const ep2 = (a * a - b * b) / (b * b); // second eccentricity squared

  const theta = Math.atan2(z * a, p * b);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const latRad = Math.atan2(
    z + ep2 * b * sinTheta * sinTheta * sinTheta,
    p - e2 * a * cosTheta * cosTheta * cosTheta
  );

  const sinLat = Math.sin(latRad);
  const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat); // Radius of curvature in prime vertical
  const altKm = p / Math.cos(latRad) - N;

  return {
    latitudeDeg: latRad * RAD2DEG,
    longitudeDeg: lonDeg,
    altitudeKm: altKm
  };
}

/**
 * Cross Product of two 3D vectors
 */
export function crossProduct(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/**
 * Dot Product of two 3D vectors
 */
export function dotProduct(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Vector magnitude (Euclidean norm)
 */
export function vectorNorm(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Vector normalizer
 */
export function normalizeVector(v: [number, number, number]): [number, number, number] {
  const norm = vectorNorm(v);
  if (norm < 1e-12) return [0, 0, 0];
  return [v[0] / norm, v[1] / norm, v[2] / norm];
}

/**
 * Computes the Relative RIC (Radial, In-track, Cross-track) encounter frame
 * centered on the primary object.
 *
 * R (Radial) = r / ||r|| (unit position vector pointing away from Earth center)
 * C (Cross-track) = (r x v) / ||r x v|| (orbit normal vector)
 * I (In-track) = C x R (transverse along velocity direction in circular orbit)
 */
export function computeRICEncounter(
  rPrimary: [number, number, number],
  vPrimary: [number, number, number],
  rSecondary: [number, number, number],
  vSecondary: [number, number, number]
): RICEncounter {
  // Primary unit frame vectors
  const uR = normalizeVector(rPrimary);
  const h = crossProduct(rPrimary, vPrimary);
  const uC = normalizeVector(h);
  const uI = normalizeVector(crossProduct(uC, uR));

  // Relative vectors
  const deltaR_vec: [number, number, number] = [
    rSecondary[0] - rPrimary[0],
    rSecondary[1] - rPrimary[1],
    rSecondary[2] - rPrimary[2]
  ];
  const deltaV_vec: [number, number, number] = [
    vSecondary[0] - vPrimary[0],
    vSecondary[1] - vPrimary[1],
    vSecondary[2] - vPrimary[2]
  ];

  // Project into RIC axes
  const radialMissKm = dotProduct(deltaR_vec, uR);
  const inTrackMissKm = dotProduct(deltaR_vec, uI);
  const crossTrackMissKm = dotProduct(deltaR_vec, uC);
  const totalMissKm = vectorNorm(deltaR_vec);
  const relativeVelocityKmS = vectorNorm(deltaV_vec);

  return {
    radialMissKm,
    inTrackMissKm,
    crossTrackMissKm,
    totalMissKm,
    relativeVelocityKmS
  };
}
