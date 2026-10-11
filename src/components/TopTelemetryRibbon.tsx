/**
 * Top Telemetry Ribbon - Space Operations Command (SpOC)
 * Displays real-time UTC, Julian Date, GMST, SSN catalog count,
 * stream throughput (msg/s), sub-millisecond compute latency, and CARA threat DEFCON.
 */

import React, { useEffect, useState } from 'react';
import { ConjunctionRiskLevel, PipelineMetrics } from '../astrodynamics/types.ts';
import { getGmstRad, getJulianDate } from '../astrodynamics/coordinates.ts';
import { RAD2DEG } from '../astrodynamics/constants.ts';
import { Activity, AlertTriangle, ShieldCheck, Cpu, UploadCloud, Radio } from 'lucide-react';

interface TopTelemetryRibbonProps {
  currentTimeMs: number;
  metrics: PipelineMetrics;
  highestRisk: ConjunctionRiskLevel;
  onOpenIngestModal: () => void;
  onResetSimulation: () => void;
}

export const TopTelemetryRibbon: React.FC<TopTelemetryRibbonProps> = ({
  currentTimeMs,
  metrics,
  highestRisk,
  onOpenIngestModal,
  onResetSimulation
}) => {
  const [missionElapsedSec, setMissionElapsedSec] = useState<number>(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setMissionElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatMET = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `T+${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const jd = getJulianDate(currentTimeMs).toFixed(4);
  const gmstDeg = (getGmstRad(getJulianDate(currentTimeMs)) * RAD2DEG).toFixed(2);
  const utcString = new Date(currentTimeMs).toISOString().replace('T', ' ').substring(0, 19) + 'Z';

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-[#0B0E17] border-b border-slate-800 text-slate-100 select-none">
      {/* Brand & Mission Profile */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 rotate-45 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <h1 className="text-sm font-bold tracking-wider font-mono text-cyan-400 uppercase">
            AURA-SDA
          </h1>
        </div>
        <span className="text-slate-600 font-mono">/</span>
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span>SPOC ORBIT DETERMINATION &amp; CARA</span>
          <span className="text-slate-600">·</span>
          <span className="text-cyan-300 font-semibold">{formatMET(missionElapsedSec)}</span>
        </div>
      </div>

      {/* Center Telemetry Readouts (UTC, JD, GMST, Stream Throughput) */}
      <div className="hidden lg:flex items-center gap-5 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">UTC:</span>
          <span className="text-slate-200 tabular-nums">{utcString}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">JD:</span>
          <span className="text-slate-200 tabular-nums">{jd}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">GMST:</span>
          <span className="text-slate-200 tabular-nums">{gmstDeg}°</span>
        </div>

        {/* Throughput & Latency */}
        <div className="flex items-center gap-2 px-2.5 py-1 bg-[#131c2e] border border-slate-700/80 rounded">
          <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="text-slate-400">INGEST:</span>
          <span className="text-cyan-300 font-bold tabular-nums">
            {metrics.ingestionRateMsgSec.toLocaleString()}
          </span>
          <span className="text-[10px] text-slate-500">msg/s</span>

          <span className="text-slate-600">|</span>

          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-400">LATENCY:</span>
          <span className="text-emerald-300 font-bold tabular-nums">
            {(metrics.batchComputeLatencyUs / 1000).toFixed(2)}
          </span>
          <span className="text-[10px] text-slate-500">ms</span>
        </div>
      </div>

      {/* Right Zone: CARA Hazard Alert & Ingest Action */}
      <div className="flex items-center gap-3">
        {/* CARA Status DEFCON */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono font-semibold ${
          highestRisk === 'CRITICAL'
            ? 'bg-rose-950/90 border-rose-500 text-rose-300 animate-pulse'
            : highestRisk === 'WARNING'
            ? 'bg-amber-950/80 border-amber-500 text-amber-300'
            : 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300'
        }`}>
          {highestRisk === 'CRITICAL' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          ) : highestRisk === 'WARNING' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span>CARA:</span>
          <span>{highestRisk}</span>
        </div>

        {/* Ingest TLE Button */}
        <button
          onClick={onOpenIngestModal}
          className="flex items-center gap-1.5 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs rounded transition-colors"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          <span>INGEST TLE</span>
        </button>

        {/* Reset Simulation Button */}
        <button
          onClick={onResetSimulation}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-mono rounded transition-colors"
          title="Reset Simulation Clock & Replay"
        >
          RESET
        </button>
      </div>
    </header>
  );
};
