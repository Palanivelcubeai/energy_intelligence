import { machines, shiftProduction, costData, monthlyProduction, demandData } from './mockData';
import { defaultConfig, getCarbonMetrics } from './carbonData';

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  lastGenerated: string;
  columns: { key: string; label: string }[];
  getData: () => Record<string, unknown>[];
}

const today = new Date();
const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const reportDefinitions: ReportDefinition[] = [
  {
    key: 'daily_cnc_energy',
    name: 'Daily CNC Energy Report',
    description: 'Energy consumption summary for all CNC machines',
    lastGenerated: 'Today, 06:00 AM',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'machine', label: 'CNC Machine' },
      { key: 'energy_kwh', label: 'Energy (kWh)' },
      { key: 'runtime_hrs', label: 'Runtime (hrs)' },
      { key: 'idle_hrs', label: 'Idle Time (hrs)' },
      { key: 'energy_per_part', label: 'Energy per Part' },
      { key: 'status', label: 'Status' },
    ],
    getData: () => {
      const rows: Record<string, unknown>[] = [];
      for (let d = 6; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(date.getDate() - d);
        const dateStr = formatDate(date);
        machines.forEach(m => {
          const variance = 0.85 + Math.random() * 0.3;
          rows.push({
            date: dateStr,
            machine: m.name,
            energy_kwh: Math.round(m.kWh * variance * 10) / 10,
            runtime_hrs: Math.round((m.runtime_hours * variance) * 10) / 10,
            idle_hrs: Math.round((m.idle_hours * (1 + (Math.random() - 0.5) * 0.4)) * 10) / 10,
            energy_per_part: Math.round(m.energy_per_part * variance * 100) / 100,
            status: m.status.charAt(0).toUpperCase() + m.status.slice(1),
          });
        });
      }
      return rows;
    },
  },
  {
    key: 'production',
    name: 'Production Report',
    description: 'Shift-wise and machine-wise production data',
    lastGenerated: 'Today, 06:00 AM',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'machine', label: 'CNC Machine' },
      { key: 'shift', label: 'Shift' },
      { key: 'parts_produced', label: 'Parts Produced' },
      { key: 'rejected_parts', label: 'Rejected Parts' },
      { key: 'production_target', label: 'Production Target' },
      { key: 'efficiency', label: 'Efficiency %' },
    ],
    getData: () => {
      const rows: Record<string, unknown>[] = [];
      const shifts = ['Shift A (06-14)', 'Shift B (14-22)', 'Shift C (22-06)'];
      for (let d = 6; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(date.getDate() - d);
        const dateStr = formatDate(date);
        machines.forEach(m => {
          shifts.forEach((shift, si) => {
            const sp = shiftProduction[si] as unknown as Record<string, number>;
            const base = sp[m.id] || 0;
            const parts = Math.round(base * (0.85 + Math.random() * 0.3));
            const target = Math.round(base * 1.1);
            const rejected = Math.round(Math.random() * 4);
            rows.push({
              date: dateStr,
              machine: m.name,
              shift,
              parts_produced: parts,
              rejected_parts: rejected,
              production_target: target,
              efficiency: target > 0 ? Math.round((parts / target) * 100) : 0,
            });
          });
        });
      }
      return rows;
    },
  },
  {
    key: 'energy_per_part',
    name: 'Energy per Part Report',
    description: 'Energy efficiency analysis per part type',
    lastGenerated: 'Yesterday, 06:00 AM',
    columns: [
      { key: 'machine', label: 'CNC Machine' },
      { key: 'total_energy', label: 'Total Energy (kWh)' },
      { key: 'total_parts', label: 'Total Parts' },
      { key: 'energy_per_part', label: 'Energy per Part' },
      { key: 'cost_per_part', label: 'Cost per Part (₹)' },
      { key: 'efficiency_rank', label: 'Efficiency Rank' },
    ],
    getData: () => {
      const sorted = [...machines]
        .filter(m => m.parts_produced > 0)
        .sort((a, b) => a.energy_per_part - b.energy_per_part);
      return sorted.map((m, i) => ({
        machine: m.name,
        total_energy: m.kWh,
        total_parts: m.parts_produced,
        energy_per_part: m.energy_per_part,
        cost_per_part: Math.round(m.energy_per_part * defaultConfig.tariffPerKwh * 100) / 100,
        efficiency_rank: i + 1,
      }));
    },
  },
  {
    key: 'monthly_efficiency',
    name: 'Monthly Efficiency Report',
    description: 'Comprehensive monthly plant efficiency analysis',
    lastGenerated: 'Feb 01, 2026',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'total_energy', label: 'Total Energy (kWh)' },
      { key: 'total_production', label: 'Total Production' },
      { key: 'avg_energy_per_part', label: 'Avg Energy per Part' },
      { key: 'efficiency_score', label: 'Efficiency Score' },
      { key: 'carbon_intensity', label: 'Carbon Intensity' },
    ],
    getData: () =>
      monthlyProduction.map(mp => {
        const avgEpp = Math.round((mp.energy / mp.production) * 100) / 100;
        return {
          month: mp.month,
          total_energy: mp.energy,
          total_production: mp.production,
          avg_energy_per_part: avgEpp,
          efficiency_score: Math.round(85 + Math.random() * 12),
          carbon_intensity: Math.round(avgEpp * defaultConfig.gridEmissionFactor * 1000) / 1000,
        };
      }),
  },
  {
    key: 'peak_demand',
    name: 'Peak Demand Analysis',
    description: 'Demand pattern analysis and penalty risk assessment',
    lastGenerated: 'Feb 25, 2026',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'time_block', label: 'Time Block' },
      { key: 'demand_kva', label: 'Demand (kVA)' },
      { key: 'contract_demand', label: 'Contract Demand' },
      { key: 'utilization', label: '% Utilization' },
      { key: 'risk_level', label: 'Risk Level' },
    ],
    getData: () => {
      const rows: Record<string, unknown>[] = [];
      const dd = demandData();
      for (let d = 6; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(date.getDate() - d);
        const dateStr = formatDate(date);
        // Sample every 4th interval (hourly)
        for (let i = 0; i < dd.length; i += 4) {
          const pt = dd[i];
          const demand = Math.round((pt.demand * (0.9 + Math.random() * 0.2)) * 10) / 10;
          const util = Math.round((demand / defaultConfig.contractDemand) * 100);
          rows.push({
            date: dateStr,
            time_block: pt.time,
            demand_kva: demand,
            contract_demand: defaultConfig.contractDemand,
            utilization: util,
            risk_level: util > 95 ? 'Critical' : util > 85 ? 'Warning' : 'Normal',
          });
        }
      }
      return rows;
    },
  },
  {
    key: 'cost_optimization',
    name: 'Cost Optimization Report',
    description: 'Cost savings opportunities and idle waste analysis',
    lastGenerated: 'Feb 24, 2026',
    columns: [
      { key: 'machine', label: 'CNC Machine' },
      { key: 'energy_cost', label: 'Energy Cost (₹)' },
      { key: 'idle_cost', label: 'Idle Cost (₹)' },
      { key: 'potential_savings', label: 'Potential Savings (₹)' },
      { key: 'recommended_action', label: 'Recommended Action' },
    ],
    getData: () => {
      const actions = [
        'Reduce idle time during shift changes',
        'Optimize tool change procedures',
        'Shift to off-peak tariff hours',
        'Implement auto power-down on idle',
        'Schedule preventive maintenance',
      ];
      return costData.machines.map((cm, i) => ({
        machine: machines[i].name,
        energy_cost: cm.energyCost,
        idle_cost: cm.idleCost,
        potential_savings: Math.round(cm.idleCost * 0.7 + cm.energyCost * 0.08),
        recommended_action: actions[i % actions.length],
      }));
    },
  },
];
