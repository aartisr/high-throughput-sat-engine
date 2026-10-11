# AURA-SDA: High-Throughput Satellite Telemetry & Orbit Determination Engine

A mission-grade Space Domain Awareness (SDA) and Conjunction Assessment Risk Analysis (CARA) platform engineered for Space Operations Command (SpOC) and aerospace mission controllers. Built with React, TypeScript, Three.js WebGL, and Recharts.

---

## Capabilities & Architecture

### 1. High-Throughput Telemetry Ingestion Pipeline
- **Partitioned Stream Architecture**: Simulates an Apache Kafka message ingestion stream across multiple partitions.
- **High Ingestion Rates**: Scales from 1,000 to over 10,000+ objects/sec with sub-millisecond propagation latency tracking.
- **Dynamic Backpressure Controls**: Configurable buffer drop strategies (`FIFO_DROP`, `SAMPLE_DROP`, `PRIORITY_SHED`) to prevent lag under heavy telemetry loads.

### 2. High-Precision Astrodynamics Engine
- **SGP4 / SDP4 & Keplerian Mechanics**: Analytical orbital propagation incorporating secular perturbations from Earth's oblateness ($J_2$ zonal harmonic).
- **Coordinate Transformations**: High-precision conversions between ECI (TEME / J2000), ECEF (WGS-84), Geodetic coordinates (via Bowring's method), and the RIC (Radial, In-track, Cross-track) encounter frame.
- **Julian Date & GMST**: Real-time Greenwich Mean Sidereal Time computation and dynamic epoch updates.

### 3. Conjunction Assessment Risk Analysis (CARA)
- **Time of Closest Approach (TCA)**: Sub-second iterative encounter refinement between primary operational assets and secondary catalog objects/debris.
- **Foster 2D Collision Probability ($P_c$)**: Projected covariance encounter ellipse integration on the B-plane collision disk.
- **Encounter Geometry**: Radial ($\Delta R$), In-track ($\Delta I$), and Cross-track ($\Delta C$) miss distance vectors and relative velocity ($V_{rel}$).
- **CCSDS CDM Export**: Compliant Consultative Committee for Space Data Systems Conjunction Data Message generation.

### 4. Automated Collision Avoidance (COLA) Maneuver Executive
- **Delta-V Burn Optimization**: Calculates prograde, retrograde, and cross-track impulse burns to achieve clearance distance.
- **Tsiolkovsky Rocket Equation**: Computes propellant mass expenditure based on thruster specific impulse ($I_{sp}$) and spacecraft dry mass.
- **Post-Burn Verification**: Live re-propagation verifying collision risk abatement.

### 5. 3D Tactical Astrodynamics Viewport (Three.js WebGL)
- **3D Interactive Earth**: WGS-84 globe with procedural continents, equator, and latitude/longitude graticules.
- **Dynamic Solar Lighting**: Real-time solar position calculator rendering Earth day/night terminators and orbital eclipse shading (umbra vs. direct sunlight).
- **Ground Station Visibility Cones**: 3D geometric line-of-sight masks for Svalbard, Goldstone, Madrid, Canberra, Guam, and Cape Canaveral.
- **Radar-Style Sweep**: 360-degree azimuthal beam scanning debris fields in real-time.
- **Camera Modes**: ECI inertial frame, ECEF Earth-fixed frame, and Target Lock tracking.

### 6. Orbit Determination & Subsystem Health Monitoring
- **O-C Residuals Chart**: Real-time Observed minus Computed tracking residuals ($\Delta R, \Delta I, \Delta C$, 3D RMS) with 3-sigma gate thresholds.
- **Downlink RF SNR Monitoring**: Real-time Signal-to-Noise Ratio fluctuation tracking based on ground station passes and elevation angles.
- **Throughput Sparklines**: 60-second rolling window tracking objects processed per second.
- **Fleet Subsystem Heatmap**: Real-time matrix monitoring battery state of charge (EPS), thermal control temperatures (TCS), attitude pointing (ADCS), RF transponders (COMM), and propulsion pressure (PROP) across tracked spacecraft.

---

## Tech Stack

- **Framework**: React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **3D Visualization**: Three.js WebGL
- **Data Visualization**: Recharts
- **Icons**: Lucide React
- **Build Tool**: Vite

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/aartisr/high-throughput-sat-engine.git

# Navigate to project directory
cd high-throughput-sat-engine

# Install dependencies
npm install

# Start local development server
npm run dev
```

### Production Build
```bash
# Build production bundle
npm run build

# Preview build locally
npm run preview
```

---

## License

MIT License.
