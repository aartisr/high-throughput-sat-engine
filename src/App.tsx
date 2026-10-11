/**
 * AURA-SDA: High-Throughput Satellite Telemetry & Orbit Determination Engine
 * Space Operations Command (SpOC) Mission-Grade Tactical C2 Console
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CameraMode, ConjunctionEvent, ConjunctionRiskLevel, ManeuverPlan, OrbitalObject, PipelineMetrics, WhatIfDeltaV } from './astrodynamics/types.ts';
import { globalStreamEngine, BackpressureMode } from './pipeline/streamEngine.ts';
import { TopTelemetryRibbon } from './components/TopTelemetryRibbon.tsx';
import { LeftPipelinePanel } from './components/LeftPipelinePanel.tsx';
import { RightCARAPanel } from './components/RightCARAPanel.tsx';
import { BottomTelemetryTray } from './components/BottomTelemetryTray.tsx';
import { TacticalGlobe } from './components/viewport/TacticalGlobe.tsx';
import { TLEIngestModal } from './components/TLEIngestModal.tsx';

export default function App() {
  const [objects, setObjects] = useState<OrbitalObject[]>(() => globalStreamEngine.getObjects());
  const [selectedObject, setSelectedObject] = useState<OrbitalObject | null>(() => {
    const list = globalStreamEngine.getObjects();
    return list.find(o => o.name.includes('ISS')) || list[0] || null;
  });
  const [conjunctions, setConjunctions] = useState<ConjunctionEvent[]>(() => globalStreamEngine.getConjunctions());
  const [selectedConjunction, setSelectedConjunction] = useState<ConjunctionEvent | null>(() => {
    const conjs = globalStreamEngine.getConjunctions();
    return conjs[0] || null;
  });

  const [metrics, setMetrics] = useState<PipelineMetrics>(() => globalStreamEngine.getMetrics());
  const [isStreamRunning, setIsStreamRunning] = useState<boolean>(true);

  // Simulation Clock & Time Warp
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(Date.now());
  const [timeWarp, setTimeWarp] = useState<number>(1);
  const [cameraMode, setCameraMode] = useState<CameraMode>('ECI');

  // Predictive What-If Trajectory Delta-V State (synced across CARA Panel & 3D Globe)
  const [whatIfDeltaV, setWhatIfDeltaV] = useState<WhatIfDeltaV>({
    alongTrackMs: 1.45,
    radialMs: 0.0,
    crossTrackMs: 0.0,
    thrusterType: 'MONOPROPELLANT_HYDRAZINE',
    isActive: true
  });

  const [isIngestModalOpen, setIsIngestModalOpen] = useState<boolean>(false);
  const [eventsLog, setEventsLog] = useState<Array<{ id: string; time: string; text: string; type: 'info' | 'alert' | 'success' }>>([
    {
      id: 'log-1',
      time: new Date().toISOString().substring(11, 19),
      text: 'AURA-SDA Engine initialized. SGP4/Keplerian batch propagator online.',
      type: 'info'
    },
    {
      id: 'log-2',
      time: new Date().toISOString().substring(11, 19),
      text: 'CARA Screening: Critical conjunction detected: ISS (ZARYA) vs COSMOS 2251 DEBRIS.',
      type: 'alert'
    }
  ]);

  // Start engine and subscribe on mount
  useEffect(() => {
    globalStreamEngine.start();

    const unsubscribe = globalStreamEngine.subscribe({
      onMetricsUpdate: (newMetrics) => {
        setMetrics(newMetrics);
      },
      onConjunctionsUpdate: (newConjunctions) => {
        setConjunctions(newConjunctions);
      }
    });

    return () => {
      unsubscribe();
      globalStreamEngine.stop();
    };
  }, []);

  // Time acceleration animation loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      animId = requestAnimationFrame(loop);
      const deltaSec = (now - lastTime) / 1000.0;
      lastTime = now;

      if (timeWarp > 0) {
        setCurrentTimeMs(prev => prev + deltaSec * 1000.0 * timeWarp);
      }
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [timeWarp]);

  // Determine highest CARA risk across active conjunctions
  const highestRisk: ConjunctionRiskLevel = conjunctions.some(c => c.riskLevel === 'CRITICAL' && !c.maneuverExecuted)
    ? 'CRITICAL'
    : conjunctions.some(c => c.riskLevel === 'WARNING' && !c.maneuverExecuted)
    ? 'WARNING'
    : 'NOMINAL';

  // Handlers
  const handleToggleStream = () => {
    if (globalStreamEngine.isStreamActive()) {
      globalStreamEngine.stop();
      setIsStreamRunning(false);
      addLog('Kafka telemetry stream paused by operator.', 'info');
    } else {
      globalStreamEngine.start();
      setIsStreamRunning(true);
      addLog('Kafka telemetry stream resumed.', 'info');
    }
  };

  const handleSetIngestionRate = (rate: number) => {
    globalStreamEngine.setIngestionRate(rate);
  };

  const handleSetBackpressureMode = (mode: BackpressureMode) => {
    globalStreamEngine.setBackpressureMode(mode);
    addLog(`Backpressure policy changed to ${mode}.`, 'info');
  };

  const handleSetPopulationCount = (count: number) => {
    globalStreamEngine.setTargetObjectCount(count);
    setObjects(globalStreamEngine.getObjects());
    addLog(`Catalog scaled to ${count.toLocaleString()} concurrent orbital objects.`, 'info');
  };

  const handleSelectObject = (obj: OrbitalObject | null) => {
    setSelectedObject(obj);
    if (obj) {
      addLog(`Tracking focus shifted to NORAD #${obj.noradId} (${obj.name}).`, 'info');
    }
  };

  const handleSelectConjunction = (conj: ConjunctionEvent) => {
    setSelectedConjunction(conj);
    setSelectedObject(conj.primaryObject);
    addLog(`CARA Inspector locked on encounter ${conj.id}.`, 'info');
  };

  const handleExecuteManeuver = (plan: ManeuverPlan, updatedConjunction: ConjunctionEvent) => {
    globalStreamEngine.updateConjunctionEvent(updatedConjunction);
    setSelectedConjunction(updatedConjunction);

    addLog(
      `COLA MANEUVER EXECUTED: ΔV=${plan.deltaVMagnitudeMs.toFixed(3)} m/s, Propellant=${plan.propellantMassKg.toFixed(2)}kg. New miss distance > ${plan.postBurnMissDistanceKm.toFixed(1)} km.`,
      'success'
    );
  };

  const handleIngestTLE = (newObj: OrbitalObject) => {
    globalStreamEngine.addCustomObject(newObj);
    setObjects([...globalStreamEngine.getObjects()]);
    setSelectedObject(newObj);
    addLog(`New TLE ingested: ${newObj.name} (NORAD #${newObj.noradId}). Added to live propagation.`, 'success');
  };

  const handleResetSimulation = () => {
    setCurrentTimeMs(Date.now());
    setTimeWarp(1);
    addLog('Simulation clock reset to Realtime UTC (T+0).', 'info');
  };

  const addLog = (text: string, type: 'info' | 'alert' | 'success') => {
    setEventsLog(prev => [
      {
        id: `log-${Date.now()}-${Math.random()}`,
        time: new Date().toISOString().substring(11, 19),
        text,
        type
      },
      ...prev.slice(0, 40)
    ]);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#07090E] text-slate-100 overflow-hidden font-sans">
      {/* Top Telemetry Ribbon */}
      <TopTelemetryRibbon
        currentTimeMs={currentTimeMs}
        metrics={metrics}
        highestRisk={highestRisk}
        onOpenIngestModal={() => setIsIngestModalOpen(true)}
        onResetSimulation={handleResetSimulation}
      />

      {/* Main Tactical C2 Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pipeline & Catalog Panel */}
        <LeftPipelinePanel
          objects={objects}
          selectedObject={selectedObject}
          onSelectObject={handleSelectObject}
          metrics={metrics}
          isStreamRunning={isStreamRunning}
          onToggleStream={handleToggleStream}
          onSetIngestionRate={handleSetIngestionRate}
          onSetBackpressureMode={handleSetBackpressureMode}
          onSetPopulationCount={handleSetPopulationCount}
        />

        {/* Center 3D Astrodynamics Globe Viewport */}
        <main className="flex-1 relative flex flex-col min-w-0 bg-[#07090E]">
          <TacticalGlobe
            objects={objects}
            selectedObject={selectedObject}
            onSelectObject={handleSelectObject}
            selectedConjunction={selectedConjunction}
            currentTimeMs={currentTimeMs}
            timeWarp={timeWarp}
            onTimeWarpChange={setTimeWarp}
            cameraMode={cameraMode}
            onCameraModeChange={setCameraMode}
            whatIfDeltaV={whatIfDeltaV}
            onWhatIfDeltaVChange={setWhatIfDeltaV}
          />
        </main>

        {/* Right CARA & COLA Maneuver Panel */}
        <RightCARAPanel
          conjunctions={conjunctions}
          selectedConjunction={selectedConjunction}
          onSelectConjunction={handleSelectConjunction}
          onExecuteManeuver={handleExecuteManeuver}
          whatIfDeltaV={whatIfDeltaV}
          onWhatIfDeltaVChange={setWhatIfDeltaV}
        />
      </div>

      {/* Bottom Telemetry Tray & Event Audit */}
      <BottomTelemetryTray
        metrics={metrics}
        eventsLog={eventsLog}
        selectedObject={selectedObject}
        currentTimeMs={currentTimeMs}
        objects={objects}
        onSelectObject={handleSelectObject}
      />

      {/* TLE Ingest Modal */}
      <TLEIngestModal
        isOpen={isIngestModalOpen}
        onClose={() => setIsIngestModalOpen(false)}
        onIngest={handleIngestTLE}
      />
    </div>
  );
}
