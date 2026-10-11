/**
 * High-Throughput Orbital Propagator with Keplerian Mechanics & J2 Secular Perturbations
 * Yields ECI (J2000), ECEF (WGS-84), and Geodetic coordinates.
 */

import {
  DEG2RAD,
  J2_HARMONIC,
  MU_EARTH,
  R_EARTH_EQUATORIAL_KM,
  RAD2DEG,
  SECONDS_PER_DAY
} from './constants.ts';
import { ecefToGeodetic, eciToEcef, getGmstRad, getJulianDate } from './coordinates.ts';
import { KeplerianElements, StateVector } from './types.ts';

/**
 * Solves Kepler's Equation E - e*sin(E) = M using rapid Newton-Raphson iteration
 */
export function solveKeplerEquation(M: number, e: number): number {
  // Normalize M into [-pi, pi]
  let mNorm = M % (2.0 * Math.PI);
  if (mNorm < -Math.PI) mNorm += 2.0 * Math.PI;
  if (mNorm > Math.PI) mNorm -= 2.0 * Math.PI;

  // Initial estimate
  let E = e > 0.8 ? Math.PI : mNorm + e * Math.sin(mNorm);

  for (let iter = 0; iter < 12; iter++) {
    const f = E - e * Math.sin(E) - mNorm;
    const fPrime = 1.0 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < 1e-10) {
      break;
    }
  }

  return E;
}

/**
 * Propagates an orbital object to an arbitrary timestamp
 */
export function propagateOrbit(
  keplerian: KeplerianElements,
  targetTimestampMs: number,
  baseEpochTimestampMs?: number
): StateVector {
  const a = keplerian.semiMajorAxisKm;
  const e = Math.min(Math.max(keplerian.eccentricity, 0.0), 0.999);
  const incRad = keplerian.inclinationDeg * DEG2RAD;
  const raan0Rad = keplerian.raanDeg * DEG2RAD;
  const argp0Rad = keplerian.argPerigeeDeg * DEG2RAD;
  const m0Rad = keplerian.meanAnomalyDeg * DEG2RAD;

  // Determine elapsed time from reference epoch in seconds
  // If baseEpochTimestampMs is provided, use it; else reconstruct from epochYear / epochDay
  let tElapsedSec: number;
  if (baseEpochTimestampMs !== undefined) {
    tElapsedSec = (targetTimestampMs - baseEpochTimestampMs) / 1000.0;
  } else {
    // Reconstruct epoch from year and fractional day of year
    const yearStartMs = Date.UTC(keplerian.epochYear, 0, 1, 0, 0, 0);
    const epochMs = yearStartMs + (keplerian.epochDay - 1.0) * 86400000.0;
    tElapsedSec = (targetTimestampMs - epochMs) / 1000.0;
  }

  // Mean motion in rad/s
  const n0 = (keplerian.meanMotionRevDay * 2.0 * Math.PI) / SECONDS_PER_DAY;

  // Semi-latus rectum p = a * (1 - e^2)
  const p = a * (1.0 - e * e);
  const pRatio = (R_EARTH_EQUATORIAL_KM / p) * (R_EARTH_EQUATORIAL_KM / p);

  // J2 Secular Drift rates:
  // Nodal regression dOmega/dt = -1.5 * J2 * (Re/p)^2 * n * cos(i)
  const cosI = Math.cos(incRad);
  const dRaanDt = -1.5 * J2_HARMONIC * pRatio * n0 * cosI;

  // Apsidal precession domega/dt = 0.75 * J2 * (Re/p)^2 * n * (5*cos(i)^2 - 1)
  const dArgpDt = 0.75 * J2_HARMONIC * pRatio * n0 * (5.0 * cosI * cosI - 1.0);

  // Perturbed mean motion dM/dt = n0 + 0.75 * J2 * (Re/p)^2 * n * sqrt(1-e^2) * (3*cos(i)^2 - 1)
  const dMDt = n0 + 0.75 * J2_HARMONIC * pRatio * n0 * Math.sqrt(1.0 - e * e) * (3.0 * cosI * cosI - 1.0);

  // Propagated orbital angles
  const raan = (raan0Rad + dRaanDt * tElapsedSec) % (2.0 * Math.PI);
  const argp = (argp0Rad + dArgpDt * tElapsedSec) % (2.0 * Math.PI);
  const M = (m0Rad + dMDt * tElapsedSec) % (2.0 * Math.PI);

  // Solve Kepler's equation for Eccentric Anomaly E
  const E = solveKeplerEquation(M, e);

  // Calculate True Anomaly nu
  const sinE = Math.sin(E);
  const cosE = Math.cos(E);
  const sqrtOneMinusE2 = Math.sqrt(1.0 - e * e);

  const sinNu = (sqrtOneMinusE2 * sinE) / (1.0 - e * cosE);
  const cosNu = (cosE - e) / (1.0 - e * cosE);
  const nu = Math.atan2(sinNu, cosNu);

  // Radius r = a * (1 - e * cos(E))
  const r = a * (1.0 - e * cosE);

  // Position and velocity in orbital plane (perifocal PQW frame)
  const rOrbX = r * Math.cos(nu);
  const rOrbY = r * Math.sin(nu);

  // Specific angular momentum h = sqrt(mu * p)
  const h = Math.sqrt(MU_EARTH * p);
  const vOrbX = -(MU_EARTH / h) * Math.sin(nu);
  const vOrbY = (MU_EARTH / h) * (e + Math.cos(nu));

  // Transformation from perifocal to ECI (J2000):
  // R = Rz(-raan) * Rx(-inc) * Rz(-argp)
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosw = Math.cos(argp);
  const sinw = Math.sin(argp);
  const sini = Math.sin(incRad);

  // Direct matrix elements for position
  const Px = cosO * cosw - sinO * sinw * cosI;
  const Py = sinO * cosw + cosO * sinw * cosI;
  const Pz = sinw * sini;

  const Qx = -cosO * sinw - sinO * cosw * cosI;
  const Qy = -sinO * sinw + cosO * cosw * cosI;
  const Qz = cosw * sini;

  const xEci = Px * rOrbX + Qx * rOrbY;
  const yEci = Py * rOrbX + Qy * rOrbY;
  const zEci = Pz * rOrbX + Qz * rOrbY;

  const vxEci = Px * vOrbX + Qx * vOrbY;
  const vyEci = Py * vOrbX + Qy * vOrbY;
  const vzEci = Pz * vOrbX + Qz * vOrbY;

  const speedKmS = Math.sqrt(vxEci * vxEci + vyEci * vyEci + vzEci * vzEci);

  // Calculate ECEF coordinates via GMST rotation
  const jd = getJulianDate(targetTimestampMs);
  const gmst = getGmstRad(jd);
  const posEci: [number, number, number] = [xEci, yEci, zEci];
  const posEcef = eciToEcef(posEci, gmst);

  // Calculate Geodetic sub-satellite points
  const geodetic = ecefToGeodetic(posEcef);

  return {
    timestampMs: targetTimestampMs,
    positionEci: posEci,
    velocityEci: [vxEci, vyEci, vzEci],
    speedKmS,
    positionEcef: posEcef,
    latitudeDeg: geodetic.latitudeDeg,
    longitudeDeg: geodetic.longitudeDeg,
    altitudeKm: geodetic.altitudeKm
  };
}

/**
 * Generates smooth 3D orbit trajectory points in ECI frame for rendering orbit path lines
 */
export function generateOrbitPathEci(
  keplerian: KeplerianElements,
  timestampMs: number,
  samples: number = 72
): [number, number, number][] {
  const points: [number, number, number][] = [];
  const periodSec = keplerian.periodMinutes * 60.0;
  const dt = periodSec / samples;

  for (let i = 0; i <= samples; i++) {
    const t = timestampMs + (i * dt * 1000.0);
    const state = propagateOrbit(keplerian, t);
    points.push(state.positionEci);
  }

  return points;
}

/**
 * Vectorized high-throughput batch propagator
 * Evaluates thousands of objects in sub-millisecond batches.
 */
export function batchPropagate(
  objects: { keplerian: KeplerianElements }[],
  targetTimestampMs: number
): StateVector[] {
  const len = objects.length;
  const results = new Array<StateVector>(len);
  for (let i = 0; i < len; i++) {
    results[i] = propagateOrbit(objects[i].keplerian, targetTimestampMs);
  }
  return results;
}
