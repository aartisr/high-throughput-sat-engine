/**
 * Standard Astrodynamics & WGS-84 Physical Constants
 */

// Earth Gravitational Parameter (GM) in km^3 / s^2 (EGM96 / WGS-84)
export const MU_EARTH = 398600.4418;

// WGS-84 Earth Equatorial Semi-major Axis in km
export const R_EARTH_EQUATORIAL_KM = 6378.137;

// WGS-84 Earth Polar Semi-minor Axis in km
export const R_EARTH_POLAR_KM = 6356.7523142;

// WGS-84 Earth Flattening parameter f = (a - b) / a
export const EARTH_FLATTENING = 1.0 / 298.257223563;

// Earth first eccentricity squared e^2 = 2f - f^2
export const EARTH_ECC_SQUARED = 2.0 * EARTH_FLATTENING - EARTH_FLATTENING * EARTH_FLATTENING;

// Second Zonal Gravitational Harmonic (oblateness J2)
export const J2_HARMONIC = 1.08262668e-3;

// Earth Angular Rotation Rate in radians / second (WGS-84)
export const EARTH_ROTATION_RATE_RAD_S = 7.2921151467e-5;

// Standard gravity at Earth surface (m / s^2)
export const G0_STANDARD = 9.80665;

// Radians to degrees and vice versa
export const DEG2RAD = Math.PI / 180.0;
export const RAD2DEG = 180.0 / Math.PI;

// Seconds in a solar day
export const SECONDS_PER_DAY = 86400.0;

// Minutes in a solar day
export const MINUTES_PER_DAY = 1440.0;

// Hard body collision default radius in meters (5m default spacecraft envelope)
export const DEFAULT_HBR_METERS = 10.0;

// Probability of Collision (Pc) Risk Thresholds (Standard CARA / NASA / SpOC criteria)
export const PC_CRITICAL_THRESHOLD = 1e-4; // 1 in 10,000 -> RED alert
export const PC_WARNING_THRESHOLD = 1e-7;  // 1 in 10,000,000 -> YELLOW alert
export const MISS_DISTANCE_CRITICAL_KM = 1.0;
export const MISS_DISTANCE_WARNING_KM = 5.0;
