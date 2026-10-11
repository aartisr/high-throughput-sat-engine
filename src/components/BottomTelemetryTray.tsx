/**
 * Bottom Telemetry Tray & Real-Time Event Log
 * Features:
 * - Real-time O-C (Observed minus Computed) Residuals Chart (Recharts) for Orbit Determination (OD)
 * - Real-time Signal-to-Noise Ratio (SNR) Fluctuation Chart (Recharts) for downlink RF monitoring
 * - 60-second rolling sparkline for objects processed per second (Recharts)
 * - Kafka partition throughput waterfall
 * - Real-time SSN operational event audit log
 */

import React, { useEffect, useState, useMemo } from 'react';
import { OrbitalObject, PipelineMetrics } from '../astrodynamics/types.ts';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  Tooltip,
  YAxis,
  XAxis,
  ReferenceLine
} from 'recharts';
import {
  Terminal,
  Activity,
  ChevronUp,
  ChevronDown,
  Radio,
  Zap,
  Signal,
  Gauge,
  CheckCircle2,
  SlidersHorizontal,
  LayoutGrid
} from 'lucide-react';
import {
  GROUND_STATIONS_CATALOG,
  checkStationLineOfSight,
  CarrierBand,
  getBestTrackingStationDoppler
} from '../astrodynamics/groundStations.ts';
import { getGmstRad, getJulianDate } from '../astrodynamics/coordinates.ts';
import { propagateOrbit } from '../astrodynamics/propagator.ts';
import { SubsystemHeatmapWidget } from './SubsystemHeatmapWidget.tsx';

export interface DopplerPoint {
  second: number;
  timeLabel: string;
  dopplerShiftKhz: number;
  rangeRateKmS: number;
  dopplerRateHzS: number;
  elevationDeg: number;
  rangeKm: number;
  stationCallsign: string;
  stationName: string;
  inView: boolean;
}

interface BottomTelemetryTrayProps {
  metrics: PipelineMetrics;
  eventsLog: Array<{ id: string; time: string; text: string; type: 'info' | 'alert' | 'success' }>;
  selectedObject?: OrbitalObject | null;
  currentTimeMs?: number;
  objects?: OrbitalObject[];
  onSelectObject?: (obj: OrbitalObject | null) => void;
}

interface SparklinePoint {
  second: number;
  timeLabel: string;
  processedPerSec: number;
}

interface SnrPoint {
  second: number;
  timeLabel: string;
  snrDb: number;
  thresholdDb: number;
}

interface OcResidualPoint {
  second: number;
  timeLabel: string;
  radialM: number;      // Delta R
  inTrackM: number;     // Delta I (along-track)
  crossTrackM: number;  // Delta C (cross-track)
  rmsM: number;         // Total 3D RMS
  gateM: number;        // OD 3-sigma gate threshold (250m)
}

export const BottomTelemetryTray: React.FC<BottomTelemetryTrayProps> = ({
  metrics,
  eventsLog,
  selectedObject,
  currentTimeMs = Date.now(),
  objects = [],
  onSelectObject
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [throughputHistory, setThroughputHistory] = useState<number[]>([]);
  // Toggle between Doppler shift, O-C Residuals, and SNR view in the first card
  const [telemetryCardMode, setTelemetryCardMode] = useState<'DOPPLER' | 'RESIDUALS' | 'SNR'>('DOPPLER');
  const [carrierBand, setCarrierBand] = useState<CarrierBand>('S_BAND');
  // Overall tray view mode: 'METRICS' (4 cards) or 'HEATMAP' (full matrix)
  const [trayViewMode, setTrayViewMode] = useState<'METRICS' | 'HEATMAP'>('METRICS');
  // Toggle between Heatmap and Waterfall in the 3rd card
  const [card3Mode, setCard3Mode] = useState<'HEATMAP' | 'WATERFALL'>('HEATMAP');

  // 60-second rolling sparkline history for 'objects processed per second'
  const [sparklineData, setSparklineData] = useState<SparklinePoint[]>(() => {
    const initial: SparklinePoint[] = [];
    const baseRate = metrics.ingestionRateMsgSec || 10240;
    for (let i = 59; i >= 0; i--) {
      const jitter = (Math.sin(i * 0.3) * 0.05 + (Math.random() - 0.5) * 0.06);
      initial.push({
        second: 60 - i,
        timeLabel: `-${i}s`,
        processedPerSec: Math.round(baseRate * (1 + jitter))
      });
    }
    return initial;
  });

  // 30-second rolling history for Signal-to-Noise Ratio (SNR)
  const [snrHistory, setSnrHistory] = useState<SnrPoint[]>(() => {
    const initial: SnrPoint[] = [];
    const baseSnr = 18.5;
    for (let i = 29; i >= 0; i--) {
      const jitter = (Math.sin(i * 0.4) * 1.8 + Math.cos(i * 0.9) * 0.8 + (Math.random() - 0.5) * 0.6);
      initial.push({
        second: 30 - i,
        timeLabel: `-${i}s`,
        snrDb: parseFloat(Math.max(6.0, Math.min(28.0, baseSnr + jitter)).toFixed(1)),
        thresholdDb: 10.0
      });
    }
    return initial;
  });

  // 30-second rolling history for O-C (Observed minus Computed) Residuals
  const [residualsHistory, setResidualsHistory] = useState<OcResidualPoint[]>(() => {
    const initial: OcResidualPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const t = (30 - i) * 0.5;
      const inTrack = Math.round(120 + 35 * Math.sin(t * 0.4) + (Math.random() - 0.5) * 15);
      const radial = Math.round(18 + 8 * Math.cos(t * 0.6) + (Math.random() - 0.5) * 6);
      const crossTrack = Math.round(32 + 14 * Math.sin(t * 0.3 + 1) + (Math.random() - 0.5) * 8);
      const rms = Math.round(Math.sqrt(radial * radial + inTrack * inTrack + crossTrack * crossTrack));

      initial.push({
        second: 30 - i,
        timeLabel: `-${i}s`,
        radialM: radial,
        inTrackM: inTrack,
        crossTrackM: crossTrack,
        rmsM: rms,
        gateM: 250
      });
    }
    return initial;
  });

  // 30-second rolling history for Doppler Frequency Shift (kHz) & Range Rate (km/s)
  const [dopplerHistory, setDopplerHistory] = useState<DopplerPoint[]>(() => {
    const initial: DopplerPoint[] = [];
    let prevShift = 0;
    for (let i = 29; i >= 0; i--) {
      const t = currentTimeMs - i * 1000;
      let shift = 0;
      let rangeRate = 0;
      let elev = 22.4;
      let range = 640;
      let callsign = 'POGO';
      let name = 'Thule TTS';
      let inView = true;

      if (selectedObject) {
        const state = propagateOrbit(selectedObject.keplerian, t);
        const jdT = getJulianDate(t);
        const gmstT = getGmstRad(jdT);
        const obs = getBestTrackingStationDoppler(state.positionEci, state.velocityEci, gmstT, 'S_BAND');
        shift = obs.dopplerShiftKhz;
        rangeRate = obs.rangeRateKmS;
        elev = obs.elevationDeg;
        range = obs.rangeKm;
        callsign = obs.station.callsign;
        name = obs.station.name;
        inView = obs.inView;
      }

      const driftHzS = i === 29 ? 0 : Math.round((shift - prevShift) * 1000);
      prevShift = shift;

      initial.push({
        second: t,
        timeLabel: i === 0 ? 'now' : `-${i}s`,
        dopplerShiftKhz: parseFloat(shift.toFixed(2)),
        rangeRateKmS: parseFloat(rangeRate.toFixed(3)),
        dopplerRateHzS: driftHzS,
        elevationDeg: parseFloat(elev.toFixed(1)),
        rangeKm: Math.round(range),
        stationCallsign: callsign,
        stationName: name,
        inView
      });
    }
    return initial;
  });

  // Waterfall bars history
  useEffect(() => {
    setThroughputHistory(prev => {
      const next = [...prev, metrics.ingestionRateMsgSec];
      if (next.length > 20) next.shift();
      return next;
    });
  }, [metrics.ingestionRateMsgSec]);

  // Update 60-second rolling sparkline every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setSparklineData(prev => {
        const currentRate = metrics.ingestionRateMsgSec;
        const jitter = (Math.random() - 0.5) * (currentRate * 0.04);
        const newPoint: SparklinePoint = {
          second: Date.now(),
          timeLabel: 'now',
          processedPerSec: Math.max(0, Math.round(currentRate + jitter))
        };
        const next = [...prev.slice(1), newPoint];
        return next.map((pt, idx) => ({
          ...pt,
          timeLabel: idx === 59 ? 'now' : `-${59 - idx}s`
        }));
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [metrics.ingestionRateMsgSec]);

  // Update SNR time-series for selected satellite every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setSnrHistory(prev => {
        let currentTargetSnr = 12.5;
        let isDirectLos = false;

        if (selectedObject) {
          const jd = getJulianDate(currentTimeMs);
          const gmst = getGmstRad(jd);
          const satPos = selectedObject.currentState.positionEci;

          for (const st of GROUND_STATIONS_CATALOG) {
            const pass = checkStationLineOfSight(st, satPos, gmst);
            if (pass.inView) {
              isDirectLos = true;
              const directSnr = 14.0 + (pass.elevationDeg / 90.0) * 12.0;
              if (directSnr > currentTargetSnr) {
                currentTargetSnr = directSnr;
              }
            }
          }

          if (!isDirectLos) {
            const t = Date.now() / 3000;
            currentTargetSnr = 11.2 + Math.sin(t) * 1.8;
          }
        }

        const tNow = Date.now() / 1000;
        const rfJitter = (Math.sin(tNow * 1.6) * 0.45 + Math.cos(tNow * 2.8) * 0.35 + (Math.random() - 0.5) * 0.5);
        const computedSnr = parseFloat(Math.max(6.0, Math.min(28.5, currentTargetSnr + rfJitter)).toFixed(1));

        const newPoint: SnrPoint = {
          second: Date.now(),
          timeLabel: 'now',
          snrDb: computedSnr,
          thresholdDb: 10.0
        };

        const next = [...prev.slice(1), newPoint];
        return next.map((pt, idx) => ({
          ...pt,
          timeLabel: idx === 29 ? 'now' : `-${29 - idx}s`
        }));
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedObject, currentTimeMs]);

  // Update O-C Residuals time-series every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setResidualsHistory(prev => {
        const t = Date.now() / 2000;
        // BSTAR drag and atmospheric perturbation creates along-track in-track drift
        const bstarScale = selectedObject ? Math.max(0.5, Math.abs(selectedObject.keplerian.bstarDrag) * 1e4) : 1.0;
        const inTrack = Math.round(115 * bstarScale + 30 * Math.sin(t * 0.5) + (Math.random() - 0.5) * 18);
        const radial = Math.round(16 + 7 * Math.cos(t * 0.8) + (Math.random() - 0.5) * 5);
        const crossTrack = Math.round(28 + 12 * Math.sin(t * 0.4 + 1.2) + (Math.random() - 0.5) * 7);
        const rms = Math.round(Math.sqrt(radial * radial + inTrack * inTrack + crossTrack * crossTrack));

        const newPoint: OcResidualPoint = {
          second: Date.now(),
          timeLabel: 'now',
          radialM: radial,
          inTrackM: inTrack,
          crossTrackM: crossTrack,
          rmsM: rms,
          gateM: 250
        };

        const next = [...prev.slice(1), newPoint];
        return next.map((pt, idx) => ({
          ...pt,
          timeLabel: idx === 29 ? 'now' : `-${29 - idx}s`
        }));
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedObject]);

  // Update Doppler Shift time-series for selected satellite every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setDopplerHistory(prev => {
        let shift = 0;
        let rangeRate = 0;
        let elev = 0;
        let range = 1000;
        let callsign = 'POGO';
        let name = 'Thule TTS';
        let inView = false;

        if (selectedObject) {
          const state = propagateOrbit(selectedObject.keplerian, currentTimeMs);
          const jd = getJulianDate(currentTimeMs);
          const gmst = getGmstRad(jd);
          const obs = getBestTrackingStationDoppler(state.positionEci, state.velocityEci, gmst, carrierBand);
          shift = obs.dopplerShiftKhz;
          rangeRate = obs.rangeRateKmS;
          elev = obs.elevationDeg;
          range = obs.rangeKm;
          callsign = obs.station.callsign;
          name = obs.station.name;
          inView = obs.inView;
        }

        const lastPoint = prev[prev.length - 1];
        const driftHzS = lastPoint
          ? Math.round((shift - lastPoint.dopplerShiftKhz) * 1000)
          : 0;

        const newPoint: DopplerPoint = {
          second: currentTimeMs,
          timeLabel: 'now',
          dopplerShiftKhz: parseFloat(shift.toFixed(2)),
          rangeRateKmS: parseFloat(rangeRate.toFixed(3)),
          dopplerRateHzS: driftHzS,
          elevationDeg: parseFloat(elev.toFixed(1)),
          rangeKm: Math.round(range),
          stationCallsign: callsign,
          stationName: name,
          inView
        };

        const next = [...prev.slice(1), newPoint];
        return next.map((pt, idx) => ({
          ...pt,
          timeLabel: idx === 29 ? 'now' : `-${29 - idx}s`
        }));
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedObject, currentTimeMs, carrierBand]);

  // Recalculate Doppler history immediately on satellite selection or carrier band change
  useEffect(() => {
    if (!selectedObject) return;
    const recalculated: DopplerPoint[] = [];
    let prevShift = 0;
    for (let i = 29; i >= 0; i--) {
      const t = currentTimeMs - i * 1000;
      const state = propagateOrbit(selectedObject.keplerian, t);
      const jdT = getJulianDate(t);
      const gmstT = getGmstRad(jdT);
      const obs = getBestTrackingStationDoppler(state.positionEci, state.velocityEci, gmstT, carrierBand);
      const driftHzS = i === 29 ? 0 : Math.round((obs.dopplerShiftKhz - prevShift) * 1000);
      prevShift = obs.dopplerShiftKhz;

      recalculated.push({
        second: t,
        timeLabel: i === 0 ? 'now' : `-${i}s`,
        dopplerShiftKhz: parseFloat(obs.dopplerShiftKhz.toFixed(2)),
        rangeRateKmS: parseFloat(obs.rangeRateKmS.toFixed(3)),
        dopplerRateHzS: driftHzS,
        elevationDeg: parseFloat(obs.elevationDeg.toFixed(1)),
        rangeKm: Math.round(obs.rangeKm),
        stationCallsign: obs.station.callsign,
        stationName: obs.station.name,
        inView: obs.inView
      });
    }
    setDopplerHistory(recalculated);
  }, [selectedObject?.id, carrierBand]);

  // Compute stats for Doppler frequency shift & range-rate
  const {
    currentDoppler,
    currentRangeRate,
    currentDopplerRate,
    currentStationCallsign,
    currentStationName,
    isDopplerInView,
    dopplerDomain,
    dopplerStatus
  } = useMemo(() => {
    if (dopplerHistory.length === 0) {
      return {
        currentDoppler: 0,
        currentRangeRate: 0,
        currentDopplerRate: 0,
        currentStationCallsign: 'TTS',
        currentStationName: 'Thule TTS',
        isDopplerInView: false,
        dopplerDomain: [-50, 50] as [number, number],
        dopplerStatus: 'AWAITING TELEMETRY'
      };
    }
    const curr = dopplerHistory[dopplerHistory.length - 1];
    const allAbs = dopplerHistory.map(d => Math.abs(d.dopplerShiftKhz));
    const maxVal = Math.max(15, Math.ceil(Math.max(...allAbs) * 1.25));

    let status = 'APPROACHING (AOS)';
    if (Math.abs(curr.dopplerShiftKhz) < 2.0 && Math.abs(curr.rangeRateKmS) < 0.4) {
      status = 'TCA ZENITH (INFLECTION)';
    } else if (curr.rangeRateKmS > 0) {
      status = 'RECEDING (LOS)';
    }

    return {
      currentDoppler: curr.dopplerShiftKhz,
      currentRangeRate: curr.rangeRateKmS,
      currentDopplerRate: curr.dopplerRateHzS,
      currentStationCallsign: curr.stationCallsign,
      currentStationName: curr.stationName,
      isDopplerInView: curr.inView,
      dopplerDomain: [-maxVal, maxVal] as [number, number],
      dopplerStatus: status
    };
  }, [dopplerHistory]);

  // Compute stats for O-C Residuals
  const { currentRms, currentInTrack, currentRadial, currentCrossTrack, odStatus } = useMemo(() => {
    if (residualsHistory.length === 0) {
      return { currentRms: 0, currentInTrack: 0, currentRadial: 0, currentCrossTrack: 0, odStatus: 'NO DATA' };
    }
    const curr = residualsHistory[residualsHistory.length - 1];
    let status = 'OD CONVERGED (NOMINAL)';
    if (curr.rmsM > 250) status = 'FILTER DIVERGENCE';
    else if (curr.rmsM > 180) status = 'ATMOSPHERIC DRAG DRIFT';

    return {
      currentRms: curr.rmsM,
      currentInTrack: curr.inTrackM,
      currentRadial: curr.radialM,
      currentCrossTrack: curr.crossTrackM,
      odStatus: status
    };
  }, [residualsHistory]);

  // Compute SNR stats
  const { currentSnr, avgSnr, linkStatus } = useMemo(() => {
    if (snrHistory.length === 0) {
      return { currentSnr: 0, avgSnr: 0, linkStatus: 'NO SIGNAL' };
    }
    const vals = snrHistory.map(d => d.snrDb);
    const curr = vals[vals.length - 1];
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = parseFloat((sum / vals.length).toFixed(1));

    let status = 'OPTIMAL LOCK';
    if (curr < 10.0) status = 'CARRIER FADE';
    else if (curr < 15.0) status = 'RELAY MARGINAL';

    return { currentSnr: curr, avgSnr: avg, linkStatus: status };
  }, [snrHistory]);

  // Compute stats for throughput sparkline
  const { currentVal, avgVal, peakVal } = useMemo(() => {
    if (sparklineData.length === 0) {
      return { currentVal: 0, avgVal: 0, peakVal: 0 };
    }
    const vals = sparklineData.map(d => d.processedPerSec);
    const sum = vals.reduce((a, b) => a + b, 0);
    return {
      currentVal: vals[vals.length - 1],
      avgVal: Math.round(sum / vals.length),
      peakVal: Math.max(...vals)
    };
  }, [sparklineData]);

  const maxWaterfall = Math.max(1000, ...throughputHistory, 25000);

  return (
    <footer className="bg-[#0B0E17] border-t border-slate-800 text-slate-200 select-none transition-all">
      {/* Ribbon Bar Header */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#07090E] border-b border-slate-800/80 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
            <Activity className="w-3.5 h-3.5" />
            <span>ORBIT DETERMINATION &amp; KAFKA TELEMETRY TRAY</span>
          </div>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">
            Buffer: <span className="text-cyan-300 font-bold">{metrics.queueDepth} pkts</span>
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">
            Latency: <span className="text-emerald-300 font-bold">{(metrics.batchComputeLatencyUs / 1000).toFixed(3)} ms</span>
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">
            O-C RMS: <span className="text-cyan-300 font-bold tabular-nums">{currentRms} m</span>
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">
            Downlink SNR: <span className={`font-bold tabular-nums ${currentSnr >= 15 ? 'text-emerald-400' : currentSnr >= 10 ? 'text-amber-400' : 'text-rose-400'}`}>{currentSnr} dB</span>
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">
            Doppler Shift: <span className="text-amber-300 font-bold tabular-nums">{currentDoppler >= 0 ? '+' : ''}{currentDoppler.toFixed(1)} kHz</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View switcher: Cards vs Full Fleet Heatmap Matrix */}
          <div className="flex items-center p-0.5 bg-[#0F172A] rounded border border-slate-800 text-[10px]">
            <button
              onClick={() => {
                setTrayViewMode('METRICS');
                if (!isExpanded) setIsExpanded(true);
              }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                trayViewMode === 'METRICS'
                  ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3 h-3" />
              <span>CARDS</span>
            </button>
            <button
              onClick={() => {
                setTrayViewMode('HEATMAP');
                if (!isExpanded) setIsExpanded(true);
              }}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
                trayViewMode === 'HEATMAP'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Gauge className="w-3 h-3 text-emerald-400" />
              <span>FLEET HEATMAP</span>
              <span className="px-1 rounded bg-emerald-500/30 text-emerald-300 text-[9px] font-bold">
                {objects?.length || 48}
              </span>
            </button>
          </div>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span>{isExpanded ? 'COLLAPSE' : 'EXPAND'}</span>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        trayViewMode === 'HEATMAP' ? (
          <div className="p-3">
            <SubsystemHeatmapWidget
              objects={objects}
              selectedObject={selectedObject}
              onSelectObject={onSelectObject ? (obj) => onSelectObject(obj) : undefined}
              currentTimeMs={currentTimeMs}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 p-3 text-xs font-mono">
          {/* 1. Orbit Determination & RF Telemetry: Doppler Frequency Shift / O-C Residuals / Downlink SNR Card */}
          <div className="p-2.5 bg-[#0F172A] border border-slate-800 rounded-lg flex flex-col justify-between">
            <div className="flex justify-between items-center text-[11px] mb-1">
              {/* Tab Selector: Doppler vs O-C Residuals vs SNR */}
              <div className="flex items-center gap-1 p-0.5 bg-[#07090E] rounded border border-slate-800">
                <button
                  onClick={() => setTelemetryCardMode('DOPPLER')}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                    telemetryCardMode === 'DOPPLER'
                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/50'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Real-time Doppler Frequency Shift & Range Rate Monitoring"
                >
                  DOPPLER (kHz)
                </button>
                <button
                  onClick={() => setTelemetryCardMode('RESIDUALS')}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                    telemetryCardMode === 'RESIDUALS'
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/50'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Orbit Determination O-C Residuals (Observed minus Computed)"
                >
                  O-C RESID (m)
                </button>
                <button
                  onClick={() => setTelemetryCardMode('SNR')}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                    telemetryCardMode === 'SNR'
                      ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/50'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Downlink Signal-to-Noise Ratio Link Margin"
                >
                  SNR (dB)
                </button>
              </div>

              {telemetryCardMode === 'DOPPLER' ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCarrierBand(prev => prev === 'S_BAND' ? 'X_BAND' : prev === 'X_BAND' ? 'KA_BAND' : 'S_BAND')}
                    className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-[#07090E] border border-slate-700 hover:border-amber-500/60 text-amber-300/90 transition-colors"
                    title="Cycle Downlink Carrier Frequency Band (S: 2.2GHz, X: 8.45GHz, Ka: 26.5GHz)"
                  >
                    {carrierBand === 'S_BAND' ? 'S: 2.2G' : carrierBand === 'X_BAND' ? 'X: 8.4G' : 'Ka: 26G'}
                  </button>
                  <span className={`font-bold tabular-nums ${
                    Math.abs(currentDoppler) < 3 ? 'text-amber-400' : currentDoppler > 0 ? 'text-cyan-400' : 'text-purple-400'
                  }`}>
                    {currentDoppler >= 0 ? '+' : ''}{currentDoppler.toFixed(1)} <span className="text-[10px] text-slate-400">kHz</span>
                  </span>
                </div>
              ) : telemetryCardMode === 'RESIDUALS' ? (
                <span className="text-cyan-400 font-bold tabular-nums">
                  RMS: {currentRms} <span className="text-[10px] text-slate-400">m</span>
                </span>
              ) : (
                <span className={`font-bold tabular-nums ${currentSnr >= 15 ? 'text-emerald-400' : currentSnr >= 10 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {currentSnr} <span className="text-[10px] text-slate-400">dB</span>
                </span>
              )}
            </div>

            {/* Canvas Area: Doppler, O-C Residuals, or SNR */}
            <div className="w-full h-16 relative mt-1">
              <ResponsiveContainer width="100%" height="100%">
                {telemetryCardMode === 'DOPPLER' ? (
                  /* Recharts AreaChart for Real-Time Doppler Frequency Shift & Range Rate */
                  <AreaChart
                    data={dopplerHistory}
                    margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="dopplerGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={currentDoppler >= 0 ? '#06b6d4' : '#a855f7'}
                          stopOpacity={0.45}
                        />
                        <stop
                          offset="95%"
                          stopColor={currentDoppler >= 0 ? '#06b6d4' : '#a855f7'}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="timeLabel" hide />
                    <YAxis domain={dopplerDomain} hide />
                    <ReferenceLine
                      y={0}
                      stroke="#f59e0b"
                      strokeDasharray="2 2"
                      strokeWidth={1}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload as DopplerPoint;
                          return (
                            <div className="bg-[#0B0E17] border border-amber-500/60 px-2 py-1.5 rounded text-[10px] font-mono shadow-xl space-y-0.5 z-50">
                              <div className="text-slate-400 flex justify-between items-center gap-2">
                                <span>{data.timeLabel} · DOPPLER SHIFT</span>
                                <span className={data.inView ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                                  {data.inView ? 'DIRECT LOS' : 'OVER HORIZON'}
                                </span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-slate-400">Doppler Shift (Δf):</span>
                                <span className={`font-bold tabular-nums ${data.dopplerShiftKhz >= 0 ? 'text-cyan-300' : 'text-purple-300'}`}>
                                  {data.dopplerShiftKhz >= 0 ? '+' : ''}{data.dopplerShiftKhz.toFixed(2)} kHz
                                </span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-slate-400">Range Rate (dρ/dt):</span>
                                <span className="text-white font-bold tabular-nums">
                                  {data.rangeRateKmS >= 0 ? '+' : ''}{data.rangeRateKmS.toFixed(3)} km/s
                                </span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-slate-400">Doppler Drift Rate:</span>
                                <span className="text-amber-300 font-bold tabular-nums">
                                  {data.dopplerRateHzS >= 0 ? '+' : ''}{data.dopplerRateHzS.toFixed(0)} Hz/s
                                </span>
                              </div>
                              <div className="flex justify-between gap-3 text-[9px] text-slate-500 pt-0.5 border-t border-slate-800">
                                <span>Station: <strong className="text-slate-300">{data.stationCallsign}</strong></span>
                                <span>El: <strong className="text-slate-300">{data.elevationDeg.toFixed(1)}°</strong></span>
                                <span>Range: <strong className="text-slate-300">{data.rangeKm} km</strong></span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="dopplerShiftKhz"
                      stroke={currentDoppler >= 0 ? '#06b6d4' : '#a855f7'}
                      strokeWidth={1.5}
                      fillOpacity={1}
                      fill="url(#dopplerGradient)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                ) : telemetryCardMode === 'RESIDUALS' ? (
                  /* Recharts LineChart for O-C Residuals (Observed minus Computed) */
                  <LineChart
                    data={residualsHistory}
                    margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                  >
                    <XAxis dataKey="timeLabel" hide />
                    <YAxis domain={[0, 300]} hide />
                    <ReferenceLine
                      y={250}
                      stroke="#f59e0b"
                      strokeDasharray="2 2"
                      strokeWidth={1}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload as OcResidualPoint;
                          return (
                            <div className="bg-[#0B0E17] border border-cyan-500/60 px-2 py-1 rounded text-[10px] font-mono shadow-lg">
                              <div className="text-slate-400">{data.timeLabel} · O-C RESIDUALS</div>
                              <div className="text-cyan-300 font-bold">
                                3D RMS: {data.rmsM} m
                              </div>
                              <div className="text-slate-300">
                                In-Track (ΔI): {data.inTrackM} m
                              </div>
                              <div className="text-emerald-400">
                                Radial (ΔR): {data.radialM} m
                              </div>
                              <div className="text-purple-400">
                                Cross-Track (ΔC): {data.crossTrackM} m
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    {/* In-Track Residual Line (dominant drift) */}
                    <Line
                      type="monotone"
                      dataKey="inTrackM"
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {/* Radial Residual Line */}
                    <Line
                      type="monotone"
                      dataKey="radialM"
                      stroke="#10b981"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {/* Cross-Track Residual Line */}
                    <Line
                      type="monotone"
                      dataKey="crossTrackM"
                      stroke="#c084fc"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                ) : (
                  /* Recharts AreaChart for Downlink SNR */
                  <AreaChart
                    data={snrHistory}
                    margin={{ top: 4, right: 2, left: 2, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="snrGradient2" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={currentSnr >= 15 ? '#10b981' : currentSnr >= 10 ? '#f59e0b' : '#ef4444'}
                          stopOpacity={0.45}
                        />
                        <stop
                          offset="95%"
                          stopColor={currentSnr >= 15 ? '#10b981' : currentSnr >= 10 ? '#f59e0b' : '#ef4444'}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="timeLabel" hide />
                    <YAxis domain={[5, 30]} hide />
                    <ReferenceLine
                      y={10}
                      stroke="#ef4444"
                      strokeDasharray="2 2"
                      strokeWidth={1}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload as SnrPoint;
                          return (
                            <div className="bg-[#0B0E17] border border-slate-700 px-2 py-1 rounded text-[10px] font-mono shadow-lg">
                              <div className="text-slate-400">{data.timeLabel}</div>
                              <div className="text-cyan-300 font-bold">
                                SNR: {data.snrDb} dB
                              </div>
                              <div className="text-slate-500 text-[9px]">
                                Margin: {(data.snrDb - data.thresholdDb).toFixed(1)} dB
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="snrDb"
                      stroke={currentSnr >= 15 ? '#10b981' : currentSnr >= 10 ? '#f59e0b' : '#ef4444'}
                      strokeWidth={1.5}
                      fillOpacity={1}
                      fill="url(#snrGradient2)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Sub-bar Stats */}
            {telemetryCardMode === 'DOPPLER' ? (
              <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                <span className="truncate">
                  Range-Rate: <strong className="text-white font-bold tabular-nums">{currentRangeRate >= 0 ? '+' : ''}{currentRangeRate.toFixed(3)} km/s</strong>
                  <span className="text-[9px] text-slate-500 ml-1">
                    ({currentRangeRate < -0.1 ? 'Approaching' : currentRangeRate > 0.1 ? 'Receding' : 'Zenith'})
                  </span>
                </span>
                <span>
                  Drift: <strong className={Math.abs(currentDopplerRate) > 100 ? 'text-amber-400 font-bold' : 'text-slate-300'}>{currentDopplerRate >= 0 ? '+' : ''}{currentDopplerRate} Hz/s</strong>
                </span>
                <span className="truncate">
                  Node: <strong className={isDopplerInView ? 'text-emerald-400 font-bold' : 'text-slate-300'}>{currentStationCallsign}</strong>
                </span>
              </div>
            ) : telemetryCardMode === 'RESIDUALS' ? (
              <div className="flex justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                <span className="truncate">
                  Status: <strong className="text-cyan-300">{odStatus}</strong>
                </span>
                <span>
                  ΔI: <strong className="text-cyan-400">{currentInTrack}m</strong> · ΔR: <strong className="text-emerald-400">{currentRadial}m</strong>
                </span>
              </div>
            ) : (
              <div className="flex justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                <span className="truncate">
                  Status: <strong className={currentSnr >= 15 ? 'text-emerald-400' : currentSnr >= 10 ? 'text-amber-400' : 'text-rose-400'}>{linkStatus}</strong>
                </span>
                <span>Avg: <strong className="text-slate-200">{avgSnr} dB</strong></span>
                <span>Margin: <strong className="text-cyan-300">+{(currentSnr - 10).toFixed(1)} dB</strong></span>
              </div>
            )}
          </div>

          {/* 2. Recharts Sparkline Chart: Objects Processed Per Second (60s Window) */}
          <div className="p-2.5 bg-[#0F172A] border border-slate-800 rounded-lg flex flex-col justify-between">
            <div className="flex justify-between items-center text-[11px] mb-1">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-300 font-semibold">OBJECTS PROCESSED / SEC (60s)</span>
              </div>
              <span className="text-cyan-400 font-bold tabular-nums">
                {currentVal.toLocaleString()} <span className="text-[10px] text-slate-400">obj/s</span>
              </span>
            </div>

            {/* Sparkline Canvas */}
            <div className="w-full h-16 relative mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={sparklineData}
                  margin={{ top: 4, right: 2, left: 2, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="processedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="timeLabel" hide />
                  <YAxis domain={['dataMin - 500', 'dataMax + 500']} hide />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload as SparklinePoint;
                        return (
                          <div className="bg-[#0B0E17] border border-cyan-500/60 px-2 py-1 rounded text-[10px] font-mono shadow-lg">
                            <div className="text-slate-400">{data.timeLabel}</div>
                            <div className="text-cyan-300 font-bold">
                              {data.processedPerSec.toLocaleString()} obj/s
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="processedPerSec"
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#processedGradient)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Sparkline Stats Sub-bar */}
            <div className="flex justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
              <span>60s Avg: <strong className="text-slate-200">{avgVal.toLocaleString()}</strong></span>
              <span>Peak: <strong className="text-emerald-400">{peakVal.toLocaleString()}</strong></span>
            </div>
          </div>

          {/* 3. Subsystem Health Heatmap Widget / Kafka Waterfall Card */}
          <div className="p-2.5 bg-[#0F172A] border border-slate-800 rounded-lg flex flex-col justify-between">
            {card3Mode === 'HEATMAP' ? (
              <div className="flex flex-col h-full justify-between">
                <div className="flex justify-between items-center text-[11px] mb-1">
                  <div className="flex items-center gap-1 p-0.5 bg-[#07090E] rounded border border-slate-800">
                    <button
                      onClick={() => setCard3Mode('HEATMAP')}
                      className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/50"
                    >
                      HEATMAP
                    </button>
                    <button
                      onClick={() => setCard3Mode('WATERFALL')}
                      className="px-1.5 py-0.5 text-[10px] font-mono rounded text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      WATERFALL
                    </button>
                  </div>
                  <button
                    onClick={() => setTrayViewMode('HEATMAP')}
                    className="text-[10px] text-cyan-400 hover:text-cyan-200 transition-colors flex items-center gap-1"
                    title="Open full fleet matrix"
                  >
                    <span>FULL MATRIX</span>
                  </button>
                </div>

                <div className="flex-1 mt-0.5">
                  <SubsystemHeatmapWidget
                    compact={true}
                    objects={objects}
                    selectedObject={selectedObject}
                    onSelectObject={onSelectObject ? (obj) => onSelectObject(obj) : undefined}
                    currentTimeMs={currentTimeMs}
                    onExpandMatrix={() => setTrayViewMode('HEATMAP')}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full justify-between">
                <div className="flex justify-between items-center text-[11px] mb-1">
                  <div className="flex items-center gap-1 p-0.5 bg-[#07090E] rounded border border-slate-800">
                    <button
                      onClick={() => setCard3Mode('HEATMAP')}
                      className="px-1.5 py-0.5 text-[10px] font-mono rounded text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      HEATMAP
                    </button>
                    <button
                      onClick={() => setCard3Mode('WATERFALL')}
                      className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/50"
                    >
                      WATERFALL
                    </button>
                  </div>
                  <span className="text-cyan-400 font-bold tabular-nums">
                    {metrics.ingestionRateMsgSec.toLocaleString()} <span className="text-[10px] text-slate-400">msg/s</span>
                  </span>
                </div>

                {/* Waterfall sparkline bars */}
                <div className="h-16 flex items-end gap-1 pt-1 border-b border-slate-800">
                  {throughputHistory.map((val, idx) => {
                    const heightPct = Math.min(100, Math.max(8, (val / maxWaterfall) * 100));
                    return (
                      <div
                        key={idx}
                        className="flex-1 bg-cyan-500/70 hover:bg-cyan-400 rounded-t transition-all"
                        style={{ height: `${heightPct}%` }}
                        title={`${val} msg/s`}
                      />
                    );
                  })}
                </div>

                <div className="flex justify-between text-[10px] text-slate-500 pt-1">
                  <span>-20s</span>
                  <span>-10s</span>
                  <span className="text-cyan-400 font-semibold">LIVE</span>
                </div>
              </div>
            )}
          </div>

          {/* 4. Real-Time SSN Conjunction & Telemetry Event Log */}
          <div className="p-2.5 bg-[#0F172A] border border-slate-800 rounded-lg flex flex-col h-28 xl:h-auto justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-semibold mb-1 border-b border-slate-800/80 pb-1">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>LIVE SSN CONJUNCTION &amp; TELEMETRY LOG</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 text-[11px] pr-1 max-h-20">
              {eventsLog.map(ev => (
                <div key={ev.id} className="flex items-start gap-2">
                  <span className="text-slate-500 shrink-0">{ev.time}</span>
                  <span
                    className={
                      ev.type === 'alert'
                        ? 'text-rose-400 font-semibold'
                        : ev.type === 'success'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-slate-300'
                    }
                  >
                    {ev.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        )
      )}
    </footer>
  );
};
