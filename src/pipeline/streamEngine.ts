/**
 * High-Throughput Telemetry Streaming Pipeline Engine
 * Simulates an Apache Kafka message ingestion stream across partitions,
 * executing sub-millisecond vectorized orbital propagation,
 * tracking buffer lag and metrics, and enforcing backpressure policies.
 */

import { evaluateConjunction } from '../astrodynamics/caraEngine.ts';
import { batchPropagate } from '../astrodynamics/propagator.ts';
import { ConjunctionEvent, OrbitalObject, PipelineMetrics } from '../astrodynamics/types.ts';
import { generateHighDensityPopulation, initializeBaseCatalog } from '../data/catalogData.ts';

export type BackpressureMode = 'FIFO_BUFFER' | 'SAMPLE_DROP' | 'PRIORITY_SHED';

export interface StreamEngineListener {
  onMetricsUpdate: (metrics: PipelineMetrics) => void;
  onConjunctionsUpdate: (conjunctions: ConjunctionEvent[]) => void;
  onObjectsUpdate?: (objects: OrbitalObject[]) => void;
}

export class TelemetryStreamEngine {
  private objects: OrbitalObject[] = [];
  private isRunning: boolean = false;
  private targetIngestionRate: number = 10240; // Default 10,240 msg/s
  private backpressureMode: BackpressureMode = 'SAMPLE_DROP';
  private partitionCount: number = 8;
  private queueDepth: number = 142;
  private droppedCount: number = 0;
  private lastMetricsTimestamp: number = Date.now();
  private messagesProcessedInInterval: number = 0;
  private latestMetrics: PipelineMetrics;
  private listeners: Set<StreamEngineListener> = new Set();
  private timerId: number | null = null;
  private conjunctionEvents: ConjunctionEvent[] = [];
  private lastCaraScanTimestamp: number = 0;

  constructor() {
    this.objects = generateHighDensityPopulation(3000);
    this.latestMetrics = {
      timestamp: Date.now(),
      ingestionRateMsgSec: this.targetIngestionRate,
      batchComputeLatencyUs: 320,
      queueDepth: this.queueDepth,
      droppedMessages: 0,
      activeObjectCount: this.objects.length,
      activePartitions: this.partitionCount,
      backpressureActive: false,
      cpuLoadPercent: 18.5
    };
    this.initializeInitialConjunctions();
  }

  private initializeInitialConjunctions() {
    const baseList = initializeBaseCatalog();
    const iss = baseList.find(o => o.name.includes('ISS')) || baseList[0];
    const hst = baseList.find(o => o.name.includes('HST')) || baseList[1];
    const cosmosDeb = baseList.find(o => o.name.includes('COSMOS 2251')) || baseList[11];
    const iridiumDeb = baseList.find(o => o.name.includes('IRIDIUM 33')) || baseList[12];
    const fengyunDeb = baseList.find(o => o.name.includes('FENGYUN 1C')) || baseList[13];

    const now = Date.now();

    // Critical Close Approach: ISS vs COSMOS 2251 DEBRIS at T + 42 minutes
    const conj1 = evaluateConjunction(iss, cosmosDeb, now + 42 * 60 * 1000);
    // Warning Close Approach: HST vs IRIDIUM 33 DEBRIS at T + 2.5 hours
    const conj2 = evaluateConjunction(hst, iridiumDeb, now + 150 * 60 * 1000);
    // Nominal Watch: ISS vs FENGYUN 1C at T + 6.2 hours
    const conj3 = evaluateConjunction(iss, fengyunDeb, now + 372 * 60 * 1000);

    this.conjunctionEvents = [conj1, conj2, conj3];
  }

  public subscribe(listener: StreamEngineListener): () => void {
    this.listeners.add(listener);
    listener.onMetricsUpdate(this.latestMetrics);
    listener.onConjunctionsUpdate(this.conjunctionEvents);
    return () => this.listeners.delete(listener);
  }

  public getObjects(): OrbitalObject[] {
    return this.objects;
  }

  public getConjunctions(): ConjunctionEvent[] {
    return this.conjunctionEvents;
  }

  public getMetrics(): PipelineMetrics {
    return this.latestMetrics;
  }

  public setIngestionRate(rate: number) {
    this.targetIngestionRate = Math.max(500, Math.min(rate, 35000));
  }

  public setBackpressureMode(mode: BackpressureMode) {
    this.backpressureMode = mode;
  }

  public setTargetObjectCount(count: number) {
    this.objects = generateHighDensityPopulation(count);
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastMetricsTimestamp = Date.now();
    this.messagesProcessedInInterval = 0;

    const intervalMs = 50; // 20 ticks per second (50ms interval)

    this.timerId = window.setInterval(() => {
      this.tick(intervalMs);
    }, intervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public isStreamActive(): boolean {
    return this.isRunning;
  }

  public updateConjunctionEvent(updated: ConjunctionEvent) {
    this.conjunctionEvents = this.conjunctionEvents.map(c => c.id === updated.id ? updated : c);
    this.notifyListeners();
  }

  public addCustomObject(newObj: OrbitalObject) {
    this.objects.unshift(newObj);
  }

  private tick(intervalMs: number) {
    const t0 = performance.now();
    const now = Date.now();

    // Calculate messages to process in this 50ms slice based on target rate
    const messagesThisTick = Math.round((this.targetIngestionRate * intervalMs) / 1000);
    this.messagesProcessedInInterval += messagesThisTick;

    // Simulate batch orbital propagation across active objects
    // Sample a batch for sub-millisecond calculation
    const batchSize = Math.min(this.objects.length, 500);
    const subBatch = this.objects.slice(0, batchSize);
    const propagatedStates = batchPropagate(subBatch, now);

    // Update object current states in place
    for (let i = 0; i < batchSize; i++) {
      this.objects[i].currentState = propagatedStates[i];
    }

    const t1 = performance.now();
    const batchDurationMs = t1 - t0;
    const batchDurationUs = Math.round(batchDurationMs * 1000);

    // Queue depth and backpressure dynamics
    let backpressureActive = false;
    if (this.targetIngestionRate > 15000) {
      this.queueDepth = Math.min(2500, this.queueDepth + Math.floor(Math.random() * 20) - 5);
      if (this.queueDepth > 1200) {
        backpressureActive = true;
        if (this.backpressureMode === 'SAMPLE_DROP') {
          const dropped = Math.floor(this.targetIngestionRate * 0.08);
          this.droppedCount += dropped;
          this.queueDepth = Math.max(300, this.queueDepth - 150);
        } else if (this.backpressureMode === 'PRIORITY_SHED') {
          const dropped = Math.floor(this.targetIngestionRate * 0.04);
          this.droppedCount += dropped;
          this.queueDepth = Math.max(200, this.queueDepth - 200);
        }
      }
    } else {
      this.queueDepth = Math.max(40, this.queueDepth + Math.floor(Math.random() * 15) - 8);
    }

    // Refresh CARA scan every 5 seconds or on initial load
    if (now - this.lastCaraScanTimestamp > 5000) {
      this.lastCaraScanTimestamp = now;
      this.refreshConjunctions(now);
    }

    // Emit metrics every 250ms
    if (now - this.lastMetricsTimestamp >= 250) {
      const elapsedSec = (now - this.lastMetricsTimestamp) / 1000.0;
      const actualRate = Math.round(this.messagesProcessedInInterval / elapsedSec);
      this.messagesProcessedInInterval = 0;
      this.lastMetricsTimestamp = now;

      const cpuLoad = Math.min(95, Math.max(8, (this.targetIngestionRate / 30000) * 65 + (batchDurationMs * 12)));

      this.latestMetrics = {
        timestamp: now,
        ingestionRateMsgSec: actualRate,
        batchComputeLatencyUs: batchDurationUs,
        queueDepth: this.queueDepth,
        droppedMessages: this.droppedCount,
        activeObjectCount: this.objects.length,
        activePartitions: this.partitionCount,
        backpressureActive,
        cpuLoadPercent: parseFloat(cpuLoad.toFixed(1))
      };

      this.notifyListeners();
    }
  }

  private refreshConjunctions(now: number) {
    // Update countdown timers on existing conjunctions
    let changed = false;
    this.conjunctionEvents = this.conjunctionEvents.map(conj => {
      const remainingSec = Math.max(0, (conj.tcaTimestampMs - now) / 1000);
      if (Math.abs(remainingSec - conj.timeToTcaSeconds) > 1) {
        changed = true;
        return {
          ...conj,
          timeToTcaSeconds: remainingSec
        };
      }
      return conj;
    });

    if (changed) {
      for (const listener of this.listeners) {
        listener.onConjunctionsUpdate(this.conjunctionEvents);
      }
    }
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener.onMetricsUpdate(this.latestMetrics);
      listener.onConjunctionsUpdate(this.conjunctionEvents);
    }
  }
}

// Global Singleton for the application session
export const globalStreamEngine = new TelemetryStreamEngine();
