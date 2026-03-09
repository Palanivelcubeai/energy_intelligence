export interface MachineData {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'maintenance';
  kW: number;
  kWh: number;
  pf: number;
  voltage: { r: number; y: number; b: number };
  current: { r: number; y: number; b: number };
  runtime_hours: number;
  idle_hours: number;
  parts_produced: number;
  energy_per_part: number;
  product_type: string;
  rejection_count: number;
  efficiency_score: number;
  production_target: number;
}

export interface TimeSeriesPoint {
  time: string;
  value: number;
}

export interface InsightData {
  id: string;
  severity: 'warning' | 'critical' | 'info' | 'success';
  message: string;
  financial_impact: string;
  production_impact: string;
  confidence: number;
  suggested_action: string;
  machine?: string;
}

export const machines: MachineData[] = [
  { id: 'CNC-1', name: 'CNC-1 (Haas VF-2)', status: 'running', kW: 18.5, kWh: 142.3, pf: 0.92, voltage: { r: 415, y: 413, b: 416 }, current: { r: 28.5, y: 27.8, b: 29.1 }, runtime_hours: 7.2, idle_hours: 0.8, parts_produced: 145, energy_per_part: 0.98, product_type: 'Shaft', rejection_count: 2, efficiency_score: 92 },
  { id: 'CNC-2', name: 'CNC-2 (DMG Mori)', status: 'running', kW: 22.1, kWh: 168.7, pf: 0.89, voltage: { r: 412, y: 414, b: 410 }, current: { r: 34.2, y: 33.5, b: 35.0 }, runtime_hours: 6.8, idle_hours: 1.2, parts_produced: 128, energy_per_part: 1.32, product_type: 'Gear', rejection_count: 5, efficiency_score: 78 },
  { id: 'CNC-3', name: 'CNC-3 (Mazak)', status: 'idle', kW: 3.2, kWh: 156.4, pf: 0.85, voltage: { r: 418, y: 415, b: 412 }, current: { r: 5.1, y: 4.8, b: 5.3 }, runtime_hours: 6.0, idle_hours: 2.0, parts_produced: 98, energy_per_part: 1.60, product_type: 'Housing', rejection_count: 8, efficiency_score: 65 },
  { id: 'CNC-4', name: 'CNC-4 (Fanuc)', status: 'running', kW: 15.8, kWh: 118.9, pf: 0.94, voltage: { r: 414, y: 416, b: 413 }, current: { r: 24.3, y: 24.8, b: 24.1 }, runtime_hours: 7.5, idle_hours: 0.5, parts_produced: 162, energy_per_part: 0.73, product_type: 'Bracket', rejection_count: 1, efficiency_score: 95 },
  { id: 'CNC-5', name: 'CNC-5 (Okuma)', status: 'maintenance', kW: 0, kWh: 45.2, pf: 0, voltage: { r: 0, y: 0, b: 0 }, current: { r: 0, y: 0, b: 0 }, runtime_hours: 3.0, idle_hours: 0.5, parts_produced: 52, energy_per_part: 0.87, product_type: 'Pin', rejection_count: 0, efficiency_score: 88 },
];

export const generateLoadCurve = (): TimeSeriesPoint[] => {
  const points: TimeSeriesPoint[] = [];
  const baseLoads = [35, 32, 30, 28, 27, 30, 45, 62, 75, 78, 80, 76, 72, 78, 82, 80, 75, 68, 55, 48, 42, 40, 38, 36];
  for (let i = 0; i < 24; i++) {
    points.push({ time: `${i.toString().padStart(2, '0')}:00`, value: baseLoads[i] + Math.random() * 8 - 4 });
  }
  return points;
};

export const generateProductionTrend = (): { time: string; production: number; energy: number }[] => {
  const data = [];
  for (let i = 0; i < 24; i++) {
    const prod = i >= 6 && i <= 22 ? Math.floor(Math.random() * 40 + 20) : Math.floor(Math.random() * 5);
    data.push({ time: `${i.toString().padStart(2, '0')}:00`, production: prod, energy: prod * (0.8 + Math.random() * 0.6) });
  }
  return data;
};

export const monthlyProduction = [
  { month: 'Jan', production: 12400, energy: 14200 },
  { month: 'Feb', production: 13100, energy: 14800 },
  { month: 'Mar', production: 14500, energy: 15200 },
  { month: 'Apr', production: 13800, energy: 15600 },
  { month: 'May', production: 15200, energy: 16100 },
  { month: 'Jun', production: 14900, energy: 15400 },
  { month: 'Jul', production: 15800, energy: 16800 },
  { month: 'Aug', production: 16200, energy: 17100 },
  { month: 'Sep', production: 15500, energy: 16200 },
  { month: 'Oct', production: 16800, energy: 17500 },
  { month: 'Nov', production: 15900, energy: 16600 },
  { month: 'Dec', production: 14200, energy: 15100 },
];

export const demandData = (): { time: string; demand: number; contract: number }[] => {
  const data = [];
  for (let i = 0; i < 96; i++) {
    const hour = Math.floor(i / 4);
    const min = (i % 4) * 15;
    const base = hour >= 6 && hour <= 22 ? 65 + Math.random() * 25 : 25 + Math.random() * 15;
    data.push({
      time: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
      demand: Math.round(base * 10) / 10,
      contract: 85,
    });
  }
  return data;
};

export const insights: InsightData[] = [
  { id: '1', severity: 'warning', message: 'CNC-3 consuming 22% more energy per part than plant average', financial_impact: '₹12,400/month excess cost', production_impact: 'Tool wear may increase rejection rate', confidence: 87, suggested_action: 'Schedule tool inspection and calibration for CNC-3', machine: 'CNC-3' },
  { id: '2', severity: 'info', message: 'CNC-5 idle for 2.4 hours during production shift', financial_impact: '₹3,200 wasted energy cost', production_impact: '~45 parts lost production', confidence: 95, suggested_action: 'Review production scheduling for CNC-5', machine: 'CNC-5' },
  { id: '3', severity: 'critical', message: 'Peak demand may exceed contract limit at 6:45 PM', financial_impact: '₹45,000 penalty risk', production_impact: 'No direct impact', confidence: 78, suggested_action: 'Stagger CNC-2 and CNC-3 operations during peak hours' },
  { id: '4', severity: 'success', message: 'CNC-4 operating at 14% better efficiency than plant average', financial_impact: '₹8,200/month savings vs average', production_impact: 'Highest parts/kWh ratio', confidence: 94, suggested_action: 'Replicate CNC-4 operating parameters across fleet', machine: 'CNC-4' },
  { id: '5', severity: 'warning', message: 'CNC-2 power factor dropped below 0.9 threshold', financial_impact: '₹5,600/month PF penalty risk', production_impact: 'Reduced machining precision possible', confidence: 91, suggested_action: 'Check capacitor bank and motor condition on CNC-2', machine: 'CNC-2' },
  { id: '6', severity: 'info', message: 'Shifting CNC-4 operation to off-peak hours could save significantly', financial_impact: '₹32,000/month potential savings', production_impact: 'Requires shift rescheduling', confidence: 82, suggested_action: 'Move CNC-4 heavy operations to 22:00-06:00 window', machine: 'CNC-4' },
  { id: '7', severity: 'warning', message: 'CNC-3 abnormal power spike detected at 14:32', financial_impact: '₹2,100 excess energy cost', production_impact: 'Potential part quality deviation', confidence: 76, suggested_action: 'Inspect spindle drive and coolant system on CNC-3', machine: 'CNC-3' },
  { id: '8', severity: 'success', message: 'CNC-1 rejection rate dropped 40% after last calibration', financial_impact: '₹6,800/month material savings', production_impact: '18 fewer rejected parts/day', confidence: 96, suggested_action: 'Schedule similar calibration for other machines', machine: 'CNC-1' },
];

export const shiftProduction = [
  { shift: 'Shift A (06-14)', 'CNC-1': 72, 'CNC-2': 64, 'CNC-3': 48, 'CNC-4': 81, 'CNC-5': 30 },
  { shift: 'Shift B (14-22)', 'CNC-1': 68, 'CNC-2': 58, 'CNC-3': 45, 'CNC-4': 76, 'CNC-5': 22 },
  { shift: 'Shift C (22-06)', 'CNC-1': 5, 'CNC-2': 6, 'CNC-3': 5, 'CNC-4': 5, 'CNC-5': 0 },
];

export const costData = {
  energyRate: 8.5, // ₹ per kWh
  demandCharge: 350, // ₹ per kVA
  contractDemand: 85, // kVA
  machines: machines.map(m => ({
    id: m.id,
    energyCost: Math.round(m.kWh * 8.5),
    costPerPart: m.parts_produced > 0 ? Math.round((m.kWh * 8.5 / m.parts_produced) * 100) / 100 : 0,
    idleCost: Math.round(m.idle_hours * (m.status !== 'maintenance' ? 3.2 : 0) * 8.5),
  })),
};

export const powerQualityData = machines.map(m => ({
  id: m.id,
  voltage: m.voltage,
  current: m.current,
  pf: m.pf,
  frequency: 49.95 + Math.random() * 0.1,
  thd: 2.5 + Math.random() * 4,
  voltageImbalance: Math.random() * 2,
  healthScore: Math.round(70 + Math.random() * 28),
}));

export const generateMachineTrend = (machineId: string): TimeSeriesPoint[] => {
  const machine = machines.find(m => m.id === machineId);
  const base = machine?.kW || 15;
  const points: TimeSeriesPoint[] = [];
  for (let i = 0; i < 24; i++) {
    const isActive = i >= 6 && i <= 22;
    points.push({
      time: `${i.toString().padStart(2, '0')}:00`,
      value: isActive ? base + Math.random() * 8 - 4 : base * 0.15 + Math.random() * 2,
    });
  }
  return points;
};
