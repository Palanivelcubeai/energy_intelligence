export interface MachineData {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'maintenance';
  kW: number;
  kWh: number;
  parts_produced: number;
  energy_per_part: number;
  runtime_hours: number;
  idle_hours: number;
  efficiency_score: number;
  trend?: { time: string; value: number }[];
}

export interface InsightData {
  id: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  message: string;
  financial_impact: string;
  production_impact: string;
  confidence: number;
  suggested_action: string;
  suggested_actions?: string[];
  machine: string | null;
}

export interface UserRecord {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export interface SystemConfig {
  plantName: string;
  location: string;
  industryType: string;
  machineCount: number;
  tariffPerKwh: number;
  contractDemand: number;
  gridEmissionFactor: number;
  demandPenaltyRate: number;
  renewablePercent: number;
  pfMinimum: number;
  thdMaximum: number;
  idleTimeThreshold: number;
  heatThreshold: number;
  demandWarningPercent: number;
  energyPerPartDeviation: number;
}

export interface MachineConfig {
  id: string;
  name: string;
  ratedPower: number;
  productionTarget: number;
  heatThreshold: number;
  status: 'running' | 'idle' | 'maintenance';
}
