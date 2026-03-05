import { machines } from "@/data/mockData";

export interface EnergyOutputRecord {
  date: Date;
  machine: string;
  machineName: string;
  energy: number;
  production: number;
  runtime_hours: number;
  idle_hours: number;
  energy_per_part: number;
  cost_per_part: number;
  efficiency_score: number;
  status: 'running' | 'idle' | 'maintenance';
}

// Generate 30 days of daily records per machine
function generateRecords(): EnergyOutputRecord[] {
  const records: EnergyOutputRecord[] = [];
  const today = new Date();

  for (let d = 0; d < 30; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    date.setHours(0, 0, 0, 0);

    for (const m of machines) {
      const dayFactor = 0.85 + Math.random() * 0.3;
      const energy = Math.round(m.kWh * dayFactor * 10) / 10;
      const production = Math.max(1, Math.round(m.parts_produced * dayFactor));
      const epp = Math.round((energy / production) * 100) / 100;

      records.push({
        date,
        machine: m.id,
        machineName: m.name,
        energy,
        production,
        runtime_hours: Math.round(m.runtime_hours * dayFactor * 10) / 10,
        idle_hours: Math.round(m.idle_hours * (1 + Math.random() * 0.5) * 10) / 10,
        energy_per_part: epp,
        cost_per_part: Math.round(epp * 8.5 * 100) / 100,
        efficiency_score: Math.min(100, Math.round(m.efficiency_score * dayFactor)),
        status: m.status,
      });
    }
  }

  return records;
}

export const allEnergyOutputRecords = generateRecords();

export function filterByDateRange(from: Date, to: Date): EnergyOutputRecord[] {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  return allEnergyOutputRecords.filter(r => r.date >= start && r.date <= end);
}

export function aggregateByMachine(records: EnergyOutputRecord[]) {
  const map = new Map<string, { machine: string; name: string; totalEnergy: number; totalParts: number; totalRuntime: number; totalIdle: number; days: number; effSum: number }>();

  for (const r of records) {
    if (r.status === 'maintenance') continue;
    const existing = map.get(r.machine);
    if (existing) {
      existing.totalEnergy += r.energy;
      existing.totalParts += r.production;
      existing.totalRuntime += r.runtime_hours;
      existing.totalIdle += r.idle_hours;
      existing.days++;
      existing.effSum += r.efficiency_score;
    } else {
      map.set(r.machine, {
        machine: r.machine,
        name: r.machineName,
        totalEnergy: r.energy,
        totalParts: r.production,
        totalRuntime: r.runtime_hours,
        totalIdle: r.idle_hours,
        days: 1,
        effSum: r.efficiency_score,
      });
    }
  }

  return Array.from(map.values()).map(m => ({
    name: m.machine,
    machineName: m.name,
    energy_per_part: m.totalParts > 0 ? Math.round((m.totalEnergy / m.totalParts) * 100) / 100 : 0,
    cost_per_part: m.totalParts > 0 ? Math.round((m.totalEnergy / m.totalParts) * 8.5 * 100) / 100 : 0,
    totalEnergy: Math.round(m.totalEnergy * 10) / 10,
    totalParts: m.totalParts,
    avgEfficiency: Math.round(m.effSum / m.days),
  }));
}
