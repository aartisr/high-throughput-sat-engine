/**
 * Conjunction Assessment Risk Analysis (CARA) Engine
 * Implements Time of Closest Approach (TCA) refinement,
 * Foster 2D Encounter Plane Probability of Collision (Pc),
 * and CCSDS Conjunction Data Message (CDM) generation.
 */

import {
  DEFAULT_HBR_METERS,
  MISS_DISTANCE_CRITICAL_KM,
  MISS_DISTANCE_WARNING_KM,
  PC_CRITICAL_THRESHOLD,
  PC_WARNING_THRESHOLD
} from './constants.ts';
import { computeRICEncounter, dotProduct, vectorNorm } from './coordinates.ts';
import { propagateOrbit } from './propagator.ts';
import { ConjunctionEvent, ConjunctionRiskLevel, OrbitalObject } from './types.ts';

/**
 * Searches for Time of Closest Approach (TCA) within a time window [startMs, endMs]
 */
export function findTCA(
  primary: OrbitalObject,
  secondary: OrbitalObject,
  startMs: number,
  durationHours: number = 24
): { tcaMs: number; minDistanceKm: number } {
  const endMs = startMs + durationHours * 3600 * 1000;
  const coarseStepMs = 60 * 1000; // 1-minute coarse step
  
  let bestTimeMs = startMs;
  let minDistanceKm = Infinity;

  // Step 1: Coarse sweep
  for (let t = startMs; t <= endMs; t += coarseStepMs) {
    const sP = propagateOrbit(primary.keplerian, t);
    const sS = propagateOrbit(secondary.keplerian, t);
    const dx = sS.positionEci[0] - sP.positionEci[0];
    const dy = sS.positionEci[1] - sP.positionEci[1];
    const dz = sS.positionEci[2] - sP.positionEci[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < minDistanceKm) {
      minDistanceKm = dist;
      bestTimeMs = t;
    }
  }

  // Step 2: Fine golden section search around best coarse time (+/- 2 minutes)
  let left = Math.max(startMs, bestTimeMs - 2 * 60 * 1000);
  let right = Math.min(endMs, bestTimeMs + 2 * 60 * 1000);
  const phi = (Math.sqrt(5) - 1) / 2;

  let x1 = right - phi * (right - left);
  let x2 = left + phi * (right - left);

  const getDistanceAt = (t: number): number => {
    const sP = propagateOrbit(primary.keplerian, t);
    const sS = propagateOrbit(secondary.keplerian, t);
    const dx = sS.positionEci[0] - sP.positionEci[0];
    const dy = sS.positionEci[1] - sP.positionEci[1];
    const dz = sS.positionEci[2] - sP.positionEci[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  let f1 = getDistanceAt(x1);
  let f2 = getDistanceAt(x2);

  for (let iter = 0; iter < 18; iter++) {
    if (f1 < f2) {
      right = x2;
      x2 = x1;
      f2 = f1;
      x1 = right - phi * (right - left);
      f1 = getDistanceAt(x1);
    } else {
      left = x1;
      x1 = x2;
      f1 = f2;
      x2 = left + phi * (right - left);
      f2 = getDistanceAt(x2);
    }
  }

  const finalTcaMs = (left + right) / 2;
  return {
    tcaMs: finalTcaMs,
    minDistanceKm: getDistanceAt(finalTcaMs)
  };
}

/**
 * Calculates Foster 2D Encounter-Plane Probability of Collision (Pc)
 * References: Foster, J. L., "A Method for Calculating Collision Probability Between Satellites"
 */
export function calculateFosterCollisionProbability(
  missDistanceKm: number,
  sigma1Km: number,
  sigma2Km: number,
  hardBodyRadiusMeters: number
): { pc: number; maxPc: number } {
  // Convert hard-body radius to km
  const rHbrKm = hardBodyRadiusMeters / 1000.0;
  
  // Safe bounds on standard deviations
  const s1 = Math.max(sigma1Km, 0.05);
  const s2 = Math.max(sigma2Km, 0.05);

  // Encounter plane miss coordinates (assume aligned on principal axis for bounding)
  const d = Math.max(missDistanceKm, 0.0);
  
  // Exponent argument: -0.5 * (d^2 / s1^2)
  const exponent = -0.5 * (d * d) / (s1 * s1);

  // Closed-form approximation for rHbr << sigma
  // Pc = (rHbr^2 / (2 * s1 * s2)) * exp(-0.5 * d^2 / s1^2)
  let pc = (rHbrKm * rHbrKm) / (2.0 * s1 * s2) * Math.exp(exponent);

  // Cap Pc within [0, 1]
  pc = Math.min(Math.max(pc, 0.0), 1.0);

  // Alfriend Maximum Probability boundary
  // Max Pc occurs when sigma = d / sqrt(2)
  const maxPc = (rHbrKm * rHbrKm) / (d * d * Math.E);
  const clampedMaxPc = Math.min(Math.max(maxPc, pc), 1.0);

  return {
    pc,
    maxPc: clampedMaxPc
  };
}

/**
 * Determines Conjunction Risk Level (CRITICAL / WARNING / NOMINAL)
 */
export function determineRiskLevel(
  pc: number,
  missDistanceKm: number
): ConjunctionRiskLevel {
  if (pc >= PC_CRITICAL_THRESHOLD || missDistanceKm <= MISS_DISTANCE_CRITICAL_KM) {
    return 'CRITICAL';
  }
  if (pc >= PC_WARNING_THRESHOLD || missDistanceKm <= MISS_DISTANCE_WARNING_KM) {
    return 'WARNING';
  }
  return 'NOMINAL';
}

/**
 * Generates official CCSDS 508.0-B-1 Conjunction Data Message (CDM)
 */
export function generateCcsdsCdmMessage(
  primary: OrbitalObject,
  secondary: OrbitalObject,
  tcaUtc: string,
  missDistanceKm: number,
  radialMissKm: number,
  inTrackMissKm: number,
  crossTrackMissKm: number,
  relativeVelocityKmS: number,
  pc: number
): string {
  const missMeters = (missDistanceKm * 1000).toFixed(1);
  const relSpeedMps = (relativeVelocityKmS * 1000).toFixed(2);
  const pcScientific = pc.toExponential(4);

  return `CCSDS_CDM_VERS = 1.0
COMMENT = ==============================================================
COMMENT = CCSDS CONJUNCTION DATA MESSAGE (CDM) - 18th SPACE DEFENSE SQN
COMMENT = Generated by AURA-SDA Orbit Determination & CARA Engine
COMMENT = ==============================================================
CREATION_DATE        = ${new Date().toISOString()}
ORIGINATOR           = USSF_SPOC_AURA_SDA
MESSAGE_ID           = CDM-${primary.noradId}-${secondary.noradId}-${Date.now()}
TCA                  = ${tcaUtc}
MISS_DISTANCE        = ${missMeters} [m]
RELATIVE_SPEED       = ${relSpeedMps} [m/s]
RELATIVE_POSITION_R  = ${(radialMissKm * 1000).toFixed(2)} [m]
RELATIVE_POSITION_T  = ${(inTrackMissKm * 1000).toFixed(2)} [m]
RELATIVE_POSITION_N  = ${(crossTrackMissKm * 1000).toFixed(2)} [m]
COLLISION_PROBABILITY= ${pcScientific}
COLLISION_PROB_METHOD= FOSTER_2D
SCREENING_VOLUME     = 20.0 x 40.0 x 20.0 [km]

OBJECT_1:
  OBJECT_NAME        = ${primary.name}
  INTERNATIONAL_DES  = ${primary.intlDesignator}
  CATALOG_NUMBER     = ${primary.noradId}
  OBJECT_TYPE        = ${primary.classification}
  OPERATOR           = SPACE OPERATIONS COMMAND (SpOC)
  COV_REF_FRAME      = RIC
  HARD_BODY_RADIUS   = ${primary.hardBodyRadiusM} [m]

OBJECT_2:
  OBJECT_NAME        = ${secondary.name}
  INTERNATIONAL_DES  = ${secondary.intlDesignator}
  CATALOG_NUMBER     = ${secondary.noradId}
  OBJECT_TYPE        = ${secondary.classification}
  COV_REF_FRAME      = RIC
  HARD_BODY_RADIUS   = ${secondary.hardBodyRadiusM} [m]
`;
}

/**
 * Evaluates an active conjunction between two objects at TCA
 */
export function evaluateConjunction(
  primary: OrbitalObject,
  secondary: OrbitalObject,
  tcaTimestampMs: number
): ConjunctionEvent {
  const pState = propagateOrbit(primary.keplerian, tcaTimestampMs);
  const sState = propagateOrbit(secondary.keplerian, tcaTimestampMs);

  const ric = computeRICEncounter(
    pState.positionEci,
    pState.velocityEci,
    sState.positionEci,
    sState.velocityEci
  );

  const combinedHbr = primary.hardBodyRadiusM + secondary.hardBodyRadiusM;
  const combinedSigma1 = Math.sqrt(
    primary.covarianceSigmaKm[0] * primary.covarianceSigmaKm[0] +
    secondary.covarianceSigmaKm[0] * secondary.covarianceSigmaKm[0]
  );
  const combinedSigma2 = Math.sqrt(
    primary.covarianceSigmaKm[1] * primary.covarianceSigmaKm[1] +
    secondary.covarianceSigmaKm[1] * secondary.covarianceSigmaKm[1]
  );

  const { pc, maxPc } = calculateFosterCollisionProbability(
    ric.totalMissKm,
    combinedSigma1,
    combinedSigma2,
    combinedHbr
  );

  const riskLevel = determineRiskLevel(pc, ric.totalMissKm);
  const tcaDate = new Date(tcaTimestampMs);
  const tcaUtc = tcaDate.toISOString();
  const timeToTcaSeconds = Math.max(0, (tcaTimestampMs - Date.now()) / 1000);

  const cdm = generateCcsdsCdmMessage(
    primary,
    secondary,
    tcaUtc,
    ric.totalMissKm,
    ric.radialMissKm,
    ric.inTrackMissKm,
    ric.crossTrackMissKm,
    ric.relativeVelocityKmS,
    pc
  );

  return {
    id: `CONJ-${primary.noradId}-${secondary.noradId}`,
    primaryObject: primary,
    secondaryObject: secondary,
    tcaUtc,
    tcaTimestampMs,
    timeToTcaSeconds,
    missDistanceKm: ric.totalMissKm,
    ric,
    probabilityOfCollisionPc: pc,
    maxPc,
    riskLevel,
    combinedHardBodyRadiusM: combinedHbr,
    combinedCovarianceSigmaKm: [combinedSigma1, combinedSigma2],
    cdmMessage: cdm
  };
}
