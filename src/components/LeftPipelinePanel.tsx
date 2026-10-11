/**
 * Left Pipeline & Space Surveillance Network (SSN) Panel
 * Features real-time search bar filtering by NORAD ID or satellite name,
 * Kafka stream controls, backpressure modes, and SSN catalog browsing.
 */

import React, { useState, useMemo } from 'react';
import { OrbitalObject, OrbitRegime, PipelineMetrics } from '../astrodynamics/types.ts';
import { BackpressureMode } from '../pipeline/streamEngine.ts';
import { Play, Pause, Search, X, Sliders, Database, Shield, Flame, Activity, Satellite } from 'lucide-react';

interface LeftPipelinePanelProps {
  objects: OrbitalObject[];
  selectedObject: OrbitalObject | null;
  onSelectObject: (obj: OrbitalObject) => void;
  metrics: PipelineMetrics;
  isStreamRunning: boolean;
  onToggleStream: () => void;
  onSetIngestionRate: (rate: number) => void;
  onSetBackpressureMode: (mode: BackpressureMode) => void;
  onSetPopulationCount: (count: number) => void;
}

export const LeftPipelinePanel: React.FC<LeftPipelinePanelProps> = ({
  objects,
  selectedObject,
  onSelectObject,
  metrics,
  isStreamRunning,
  onToggleStream,
  onSetIngestionRate,
  onSetBackpressureMode,
  onSetPopulationCount
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRegime, setSelectedRegime] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'CATALOG' | 'STREAM'>('CATALOG');

  // Real-time filter by NORAD ID, satellite name, or international designator
  const filteredObjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return objects.filter(obj => {
      if (q.length > 0) {
        const matchesName = obj.name.toLowerCase().includes(q);
        const matchesNorad = obj.noradId.toString().includes(q);
        const matchesIntl = obj.intlDesignator.toLowerCase().includes(q);
        if (!matchesName && !matchesNorad && !matchesIntl) {
          return false;
        }
      }

      if (selectedRegime === 'ALL') return true;
      if (selectedRegime === 'PROTECTED') return obj.isProtectedAsset;
      if (selectedRegime === 'DEBRIS') return obj.classification === 'DEBRIS';
      return obj.regime === selectedRegime;
    });
  }, [objects, searchQuery, selectedRegime]);

  // When search query is entered, auto-switch to CATALOG view for immediate visibility
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length > 0 && activeTab !== 'CATALOG') {
      setActiveTab('CATALOG');
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  return (
    <aside className="w-80 md:w-96 flex flex-col bg-[#0B0E17] border-r border-slate-800 text-slate-100 h-full select-none">
      {/* Top Permanent Real-Time Search Bar */}
      <div className="p-3 bg-[#07090E] border-b border-slate-800 space-y-2">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-cyan-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search NORAD ID or satellite name... (e.g. 25544, ISS)"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-[#0F172A] border border-slate-700/80 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 font-mono transition-colors"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-200 transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Real-time search match counter */}
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-0.5">
          <span>
            {searchQuery ? (
              <>
                Matches: <strong className="text-cyan-300">{filteredObjects.length}</strong> of {objects.length}
              </>
            ) : (
              <>
                Catalog: <strong className="text-slate-200">{objects.length.toLocaleString()}</strong> objects tracked
              </>
            )}
          </span>
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="text-[10px] text-cyan-400 hover:underline"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex border-b border-slate-800 bg-[#07090E]">
        <button
          onClick={() => setActiveTab('CATALOG')}
          className={`flex-1 py-2.5 text-xs font-mono font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'CATALOG'
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-[#0F172A]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>SSN CATALOG ({filteredObjects.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('STREAM')}
          className={`flex-1 py-2.5 text-xs font-mono font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'STREAM'
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-[#0F172A]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>INGESTION PIPELINE</span>
        </button>
      </div>

      {activeTab === 'CATALOG' ? (
        /* SSN Catalog Filtered List Tab */
        <div className="flex-1 flex flex-col min-h-0 p-3 space-y-3">
          {/* Regime Filter Chips */}
          <div className="flex flex-wrap gap-1">
            {['ALL', 'PROTECTED', 'LEO', 'MEO', 'GEO', 'DEBRIS'].map(regime => (
              <button
                key={regime}
                onClick={() => setSelectedRegime(regime)}
                className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                  selectedRegime === regime
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {regime}
              </button>
            ))}
          </div>

          {/* Real-time Filtered Object List */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filteredObjects.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-slate-500 bg-[#0F172A] rounded border border-slate-800 mt-2">
                No orbital objects matched "{searchQuery}".
              </div>
            ) : (
              filteredObjects.slice(0, 100).map(obj => {
                const isSelected = selectedObject?.id === obj.id;
                return (
                  <div
                    key={obj.id}
                    onClick={() => onSelectObject(obj)}
                    className={`p-2.5 rounded border cursor-pointer transition-colors text-xs font-mono ${
                      isSelected
                        ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                        : 'bg-[#0F172A]/70 border-slate-800/80 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            obj.classification === 'ACTIVE_PAYLOAD'
                              ? 'bg-cyan-400'
                              : obj.classification === 'DEBRIS'
                              ? 'bg-amber-400'
                              : 'bg-slate-400'
                          }`}
                        />
                        <span className="font-bold truncate text-slate-100">{obj.name}</span>
                      </div>
                      <span className="text-[10px] text-cyan-400/90 font-semibold shrink-0">
                        #{obj.noradId}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                      <span>ALT: <strong className="text-slate-200">{obj.currentState.altitudeKm.toFixed(0)} km</strong></span>
                      <span>VEL: <strong className="text-slate-200">{obj.currentState.speedKmS.toFixed(2)} km/s</strong></span>
                      <span className="text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-300">
                        {obj.regime}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Ingestion Pipeline Tab */
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Stream Master Controls */}
          <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400">TELEMETRY STREAM:</span>
              <button
                onClick={onToggleStream}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
                  isStreamRunning
                    ? 'bg-rose-950 border border-rose-500/60 text-rose-300 hover:bg-rose-900'
                    : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                }`}
              >
                {isStreamRunning ? (
                  <>
                    <Pause className="w-3 h-3" />
                    <span>PAUSE STREAM</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>RESUME STREAM</span>
                  </>
                )}
              </button>
            </div>

            {/* Target Ingestion Rate */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Target Ingestion:</span>
                <span className="text-cyan-400 font-bold tabular-nums">
                  {metrics.ingestionRateMsgSec.toLocaleString()} msg/s
                </span>
              </div>
              <input
                type="range"
                min="1000"
                max="25000"
                step="500"
                value={metrics.ingestionRateMsgSec}
                onChange={e => onSetIngestionRate(Number(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
              <div className="flex justify-between gap-1 pt-1">
                {[1000, 5000, 10240, 20000].map(r => (
                  <button
                    key={r}
                    onClick={() => onSetIngestionRate(r)}
                    className="px-2 py-0.5 text-[10px] font-mono bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                  >
                    {r >= 1000 ? `${r / 1000}k` : r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Backpressure & Partition Governance */}
          <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-3">
            <span className="text-xs font-mono text-slate-400 block">BACKPRESSURE &amp; SHEDDING:</span>
            
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'SAMPLE_DROP', label: 'Rate Drop' },
                { id: 'PRIORITY_SHED', label: 'Priority Shed' },
                { id: 'FIFO_BUFFER', label: 'FIFO Queue' }
              ].map(bp => (
                <button
                  key={bp.id}
                  onClick={() => onSetBackpressureMode(bp.id as BackpressureMode)}
                  className="px-2 py-1.5 text-[11px] font-mono text-center rounded border border-slate-700 hover:border-cyan-500/50 transition-colors bg-slate-900/60 text-slate-200"
                >
                  {bp.label}
                </button>
              ))}
            </div>

            {/* Ingestion Pipeline Telemetry Metrics */}
            <div className="space-y-2 pt-1 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Kafka Partitions:</span>
                <span className="text-slate-200 font-bold">{metrics.activePartitions} Channels</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Partition Buffer Depth:</span>
                <span className="text-cyan-300 font-bold tabular-nums">{metrics.queueDepth} pkts</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Batch Compute Latency:</span>
                <span className="text-emerald-400 font-bold tabular-nums">
                  {(metrics.batchComputeLatencyUs / 1000).toFixed(3)} ms
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Dropped / Filtered:</span>
                <span className="text-amber-400 font-bold tabular-nums">
                  {metrics.droppedMessages.toLocaleString()} pkts
                </span>
              </div>
            </div>
          </div>

          {/* High-Density Object Scale Selector */}
          <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-2">
            <span className="text-xs font-mono text-slate-400 block">SIMULATION CATALOG DENSITY:</span>
            <div className="grid grid-cols-4 gap-1.5">
              {[500, 1500, 3000, 5000].map(cnt => (
                <button
                  key={cnt}
                  onClick={() => onSetPopulationCount(cnt)}
                  className={`py-1.5 text-xs font-mono rounded border transition-colors ${
                    objects.length === cnt
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cnt >= 1000 ? `${cnt / 1000}k` : cnt}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 font-mono pt-1">
              Simulates concurrent orbit trajectories with sub-millisecond vector propagation.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
};
