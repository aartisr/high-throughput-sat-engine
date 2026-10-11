/**
 * Astrodynamics & Space Domain Awareness (SDA) Data Types
 * Conforms to Space Operations Command (SpOC) & CCSDS standards.
 */

export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO';
export type ObjectClassification = 'ACTIVE_PAYLOAD' | 'DEBRIS' | 'ROCKET_BODY' | 'UNKNOWN';
export type ConjunctionRiskLevel = 'CRITICAL' | 'WARNING' | 'NOMINAL';
export type CameraMode = 'ECI' | 'ECEF' | 'TARGET_LOCK';

export interface KeplerianElements {
  semiMajorAxisKm: number;    // a (km)
  eccentricity: number;        // e (dimensionless, 0 <= e < 1 for elliptical)
  inclinationDeg: number;      // i (degrees)
  raanDeg: number;             // Right Ascension of Ascending Node (Omega, degrees)
  argPerigeeDeg: number;       // Argument of Perigee (omega, degrees)
  meanAnomalyDeg: number;      // Mean Anomaly at epoch (M, degrees)
  meanMotionRevDay: number;    // n (revolutions per solar day)
  epochYear: number;           // Two-digit or four-digit epoch year
  epochDay: number;            // Fractional day of year
  bstarDrag: number;           // B* drag term (1/Earth radii)
  periodMinutes: number;       // Orbital period (minutes)
  apogeeAltitudeKm: number;    // Apogee altitude above Earth surface (km)
  perigeeAltitudeKm: number;   // Perigee altitude above Earth surface (km)
}

export interface StateVector {
  timestampMs: number;
  // Earth-Centered Inertial (ECI J2000 / TEME) coordinates
  positionEci: [number, number, number]; // [X, Y, Z] in km
  velocityEci: [number, number, number]; // [Vx, Vy, Vz] in km/s
  speedKmS: number;
  
  // Earth-Centered Earth-Fixed (ECEF WGS84) coordinates
  positionEcef: [number, number, number]; // [X, Y, Z] in km
  
  // Geodetic sub-satellite coordinates
  latitudeDeg: number;   // phi (-90 to +90)
  longitudeDeg: number;  // lambda (-180 to +180)
  altitudeKm: number;    // altitude above WGS84 ellipsoid
}

export interface OrbitalObject {
  id: string;
  noradId: number;
  name: string;
  intlDesignator: string;
  classification: ObjectClassification;
  regime: OrbitRegime;
  keplerian: KeplerianElements;
  tleLine1: string;
  tleLine2: string;
  currentState: StateVector;
  massKg: number;
  crossSectionM2: number;
  hardBodyRadiusM: number;
  // Standard position covariance uncertainty 1-sigma [R, I, C] in km
  covarianceSigmaKm: [number, number, number];
  isProtectedAsset?: boolean;
}

export interface RICEncounter {
  radialMissKm: number;     // Delta R (radial along position vector)
  inTrackMissKm: number;    // Delta I (along-track / transverse)
  crossTrackMissKm: number; // Delta C (out-of-plane / normal)
  totalMissKm: number;      // Euclidean norm
  relativeVelocityKmS: number;
}

export interface ConjunctionEvent {
  id: string;
  primaryObject: OrbitalObject;
  secondaryObject: OrbitalObject;
  tcaUtc: string;               // Time of Closest Approach ISO string
  tcaTimestampMs: number;
  timeToTcaSeconds: number;
  missDistanceKm: number;
  ric: RICEncounter;
  probabilityOfCollisionPc: number; // Foster 2D encounter-plane Pc
  maxPc: number;                    // Alfriend maximum Pc boundary
  riskLevel: ConjunctionRiskLevel;
  combinedHardBodyRadiusM: number;
  combinedCovarianceSigmaKm: [number, number]; // 2D encounter plane semi-axes
  cdmMessage: string;               // CCSDS 508.0-B-1 Conjunction Data Message
  maneuverExecuted?: boolean;
}

export interface ManeuverPlan {
  id: string;
  conjunctionId: string;
  targetObjectId: string;
  burnEpochUtc: string;
  burnEpochTimestampMs: number;
  burnType: 'ALONG_TRACK_PROGRADE' | 'ALONG_TRACK_RETROGRADE' | 'CROSS_TRACK_INCLINATION';
  deltaVVectorMs: [number, number, number]; // [DeltaVR, DeltaVT, DeltaVN] in m/s
  deltaVMagnitudeMs: number;
  thrusterType: 'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION';
  ispSeconds: number;
  propellantMassKg: number;
  dryMassKg: number;
  postBurnMissDistanceKm: number;
  postBurnPc: number;
  burnDurationSeconds: number;
}

export interface PipelineMetrics {
  timestamp: number;
  ingestionRateMsgSec: number;
  batchComputeLatencyUs: number;
  queueDepth: number;
  droppedMessages: number;
  activeObjectCount: number;
  activePartitions: number;
  backpressureActive: boolean;
  cpuLoadPercent: number;
}

export interface WhatIfDeltaV {
  alongTrackMs: number;  // Delta-V Along-track / Transverse (m/s) (+ prograde, - retrograde)
  radialMs: number;      // Delta-V Radial (m/s) (+ radial out, - radial in)
  crossTrackMs: number;  // Delta-V Cross-track / Normal (m/s) (+ north, - south)
  thrusterType: 'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION';
  isActive: boolean;
}

export interface WhatIfManeuverResult {
  deltaV: {
    alongTrackMs: number;
    radialMs: number;
    crossTrackMs: number;
    totalMs: number;
  };
  thrusterType: 'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION';
  propellantMassKg: number;
  burnDurationSeconds: number;
  revisedKeplerian: KeplerianElements;
  predictedMissDistanceKm: number;
  predictedPc: number;
  deltaApogeeKm: number;
  deltaPerigeeKm: number;
  deltaPeriodSeconds: number;
  burnEpochMs: number;
}

