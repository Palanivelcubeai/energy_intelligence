import { machines } from './mockData';

export const GRID_EMISSION_FACTOR = 0.82; // kg CO₂ per kWh
export const DIESEL_EMISSION_FACTOR = 2.68; // kg CO₂ per liter (future)

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
  demandWarningPercent: number;
  energyPerPartDeviation: number;
}

export const defaultConfig: SystemConfig = {
  plantName: 'Precision CNC Works',
  location: 'Pune, Maharashtra',
  industryType: 'Automotive Components',
  machineCount: 5,
  tariffPerKwh: 8.5,
  contractDemand: 85,
  gridEmissionFactor: GRID_EMISSION_FACTOR,
  demandPenaltyRate: 350,
  renewablePercent: 22,
  pfMinimum: 0.9,
  thdMaximum: 5,
  idleTimeThreshold: 1.5,
  demandWarningPercent: 90,
  energyPerPartDeviation: 15,
};

export interface MachineConfig {
  id: string;
  name: string;
  ratedPower: number;
  productionTarget: number;
  status: 'running' | 'idle' | 'maintenance';
}

export const defaultMachineConfigs: MachineConfig[] = [
  { id: 'CNC-1', name: 'CNC-1 (Haas VF-2)', ratedPower: 22, productionTarget: 160, status: 'running' },
  { id: 'CNC-2', name: 'CNC-2 (DMG Mori)', ratedPower: 26, productionTarget: 140, status: 'running' },
  { id: 'CNC-3', name: 'CNC-3 (Mazak)', ratedPower: 20, productionTarget: 120, status: 'idle' },
  { id: 'CNC-4', name: 'CNC-4 (Fanuc)', ratedPower: 18, productionTarget: 170, status: 'running' },
  { id: 'CNC-5', name: 'CNC-5 (Okuma)', ratedPower: 15, productionTarget: 80, status: 'maintenance' },
];

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Operator';
}

export const defaultUsers: UserRecord[] = [
  { id: '1', name: 'Rajesh Kumar', email: 'rajesh@cncworks.in', role: 'Admin' },
  { id: '2', name: 'Priya Sharma', email: 'priya@cncworks.in', role: 'Manager' },
  { id: '3', name: 'Amit Patel', email: 'amit@cncworks.in', role: 'Operator' },
  { id: '4', name: 'Sneha Desai', email: 'sneha@cncworks.in', role: 'Manager' },
];

export const getCarbonMetrics = (emissionFactor: number, renewablePercent: number) => {
  const totalKwh = machines.reduce((s, m) => s + m.kWh, 0);
  const totalParts = machines.reduce((s, m) => s + m.parts_produced, 0);
  const totalCO2Today = totalKwh * emissionFactor;
  const totalCO2Month = totalCO2Today * 26; // working days
  const carbonIntensity = totalCO2Today / totalParts;
  const carbonSaved = totalKwh * (renewablePercent / 100) * emissionFactor;
  const sustainabilityScore = Math.round(
    Math.min(100, 40 + (renewablePercent * 1.2) + (100 - (carbonIntensity * 80)) + (carbonSaved / totalCO2Today * 20))
  );

  return {
    totalCO2Today: Math.round(totalCO2Today * 100) / 100,
    totalCO2Month: Math.round(totalCO2Month / 1000 * 100) / 100,
    carbonIntensity: Math.round(carbonIntensity * 1000) / 1000,
    renewablePercent,
    carbonSaved: Math.round(carbonSaved * 100) / 100,
    sustainabilityScore: Math.min(100, Math.max(0, sustainabilityScore)),
  };
};

export const generate30DayCO2 = (emissionFactor: number) => {
  const data = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayLabel = `${date.getDate()}/${date.getMonth() + 1}`;
    const baseKwh = 580 + Math.random() * 120;
    const co2 = baseKwh * emissionFactor;
    const parts = Math.floor(450 + Math.random() * 200);
    data.push({
      date: dayLabel,
      co2: Math.round(co2 * 10) / 10,
      kwh: Math.round(baseKwh * 10) / 10,
      intensity: Math.round((co2 / parts) * 1000) / 1000,
      parts,
    });
  }
  return data;
};

export const getCO2ByMachine = (emissionFactor: number) =>
  machines.map(m => ({
    name: m.id,
    co2: Math.round(m.kWh * emissionFactor * 100) / 100,
    kwh: m.kWh,
  }));

export interface CarbonInsight {
  severity: 'warning' | 'success' | 'info';
  message: string;
  carbonReduction: string;
  financialImpact: string;
  recommendation: string;
}

export const getCarbonInsights = (emissionFactor: number, renewablePercent: number): CarbonInsight[] => {
  const avgEnergyPerPart = machines.reduce((s, m) => s + m.energy_per_part, 0) / machines.length;
  const insightsList: CarbonInsight[] = [];

  machines.forEach(m => {
    if (m.energy_per_part > avgEnergyPerPart * 1.1) {
      insightsList.push({
        severity: 'warning',
        message: `${m.id} carbon intensity ${((m.energy_per_part - avgEnergyPerPart) / avgEnergyPerPart * 100).toFixed(0)}% above plant average`,
        carbonReduction: `${(m.kWh * emissionFactor * 0.15).toFixed(1)} kg CO₂/day reducible`,
        financialImpact: `₹${(m.kWh * 0.15 * 8.5).toFixed(0)}/day savings potential`,
        recommendation: `Optimize ${m.id} toolpath and cutting parameters to reduce energy per part`,
      });
    }
  });

  if (renewablePercent < 30) {
    insightsList.push({
      severity: 'info',
      message: `Increasing renewable energy from ${renewablePercent}% to 30% would significantly cut emissions`,
      carbonReduction: `${(machines.reduce((s, m) => s + m.kWh, 0) * (0.30 - renewablePercent / 100) * emissionFactor).toFixed(1)} kg CO₂/day`,
      financialImpact: `Green energy certificates available at ₹2.5/kWh premium`,
      recommendation: 'Explore rooftop solar or open-access renewable procurement',
    });
  }

  const totalParts = machines.reduce((s, m) => s + m.parts_produced, 0);
  const totalCO2 = machines.reduce((s, m) => s + m.kWh, 0) * emissionFactor;
  if (totalParts > 500 && totalCO2 / totalParts < avgEnergyPerPart * emissionFactor) {
    insightsList.push({
      severity: 'success',
      message: 'Production efficiency improving — more parts with stable CO₂ output',
      carbonReduction: `${(avgEnergyPerPart * emissionFactor * totalParts * 0.05).toFixed(1)} kg CO₂ saved vs baseline`,
      financialImpact: `₹${(totalParts * 0.05 * avgEnergyPerPart * 8.5).toFixed(0)} cost avoidance`,
      recommendation: 'Document current best practices and replicate across all machines',
    });
  }

  insightsList.push({
    severity: 'info',
    message: 'Off-peak production shifting could reduce grid carbon intensity by 12%',
    carbonReduction: `${(totalCO2 * 0.12).toFixed(1)} kg CO₂/day`,
    financialImpact: `₹${(machines.reduce((s, m) => s + m.kWh, 0) * 0.12 * 8.5).toFixed(0)}/day with ToD tariff`,
    recommendation: 'Move non-critical machining to 22:00–06:00 for lower grid emission factor',
  });

  return insightsList;
};
