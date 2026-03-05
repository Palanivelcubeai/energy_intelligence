import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Shield, Save, Building2, Zap, Cpu, Bell
} from "lucide-react";
import { defaultConfig, defaultMachineConfigs, type SystemConfig, type MachineConfig } from "@/data/carbonData";
import { useToast } from "@/hooks/use-toast";

export default function AdminConfig() {
  const { toast } = useToast();
  const [config, setConfig] = useState<SystemConfig>({ ...defaultConfig });
  const [machines, setMachines] = useState<MachineConfig[]>(defaultMachineConfigs.map(m => ({ ...m })));

  const updateConfig = <K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateMachine = (id: string, field: keyof MachineConfig, value: string | number) => {
    setMachines(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleSave = () => {
    toast({
      title: "Configuration Saved",
      description: "All settings have been applied. Dashboards will reflect changes.",
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configuration</h1>
          <p className="text-sm text-muted-foreground">System-level settings affecting all dashboards</p>
        </div>
      </div>

      {/* A. Plant Configuration */}
      <div className="kpi-card space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Plant Configuration</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Plant Name</Label>
            <Input value={config.plantName} onChange={e => updateConfig('plantName', e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Location</Label>
            <Input value={config.location} onChange={e => updateConfig('location', e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Industry Type</Label>
            <Input value={config.industryType} onChange={e => updateConfig('industryType', e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">CNC Machine Count</Label>
            <Input type="number" value={config.machineCount} onChange={e => updateConfig('machineCount', parseInt(e.target.value) || 0)} className="font-mono" />
          </div>
        </div>
      </div>

      {/* B. Energy Configuration */}
      <div className="kpi-card space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Energy Configuration</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tariff (₹/kWh)</Label>
            <Input type="number" step="0.1" value={config.tariffPerKwh} onChange={e => updateConfig('tariffPerKwh', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Contract Demand (kVA)</Label>
            <Input type="number" value={config.contractDemand} onChange={e => updateConfig('contractDemand', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Grid Emission Factor (kg CO₂/kWh)</Label>
            <Input type="number" step="0.01" value={config.gridEmissionFactor} onChange={e => updateConfig('gridEmissionFactor', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Demand Penalty (₹/kVA)</Label>
            <Input type="number" value={config.demandPenaltyRate} onChange={e => updateConfig('demandPenaltyRate', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Renewable % Override</Label>
            <Input type="number" min="0" max="100" value={config.renewablePercent} onChange={e => updateConfig('renewablePercent', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">Changes to emission factor and tariff dynamically recalculate Carbon, Cost, and AI Insight pages.</p>
      </div>

      {/* C. Machine Configuration */}
      <div className="kpi-card space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Machine Configuration</h3>
        </div>
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Machine</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Rated Power (kW)</TableHead>
                <TableHead className="text-xs">Production Target</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {machines.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.id}</TableCell>
                  <TableCell>
                    <Input value={m.name} onChange={e => updateMachine(m.id, 'name', e.target.value)} className="h-8 text-xs font-mono" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={m.ratedPower} onChange={e => updateMachine(m.id, 'ratedPower', parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono w-20" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={m.productionTarget} onChange={e => updateMachine(m.id, 'productionTarget', parseInt(e.target.value) || 0)} className="h-8 text-xs font-mono w-24" />
                  </TableCell>
                  <TableCell>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                      m.status === 'running' ? 'status-running' : m.status === 'idle' ? 'status-idle' : 'status-maintenance'
                    }`}>{m.status}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* D. Alert Thresholds */}
      <div className="kpi-card space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-foreground">Alert Threshold Settings</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Min Power Factor</Label>
            <Input type="number" step="0.01" value={config.pfMinimum} onChange={e => updateConfig('pfMinimum', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max THD (%)</Label>
            <Input type="number" value={config.thdMaximum} onChange={e => updateConfig('thdMaximum', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Idle Time Threshold (hrs)</Label>
            <Input type="number" step="0.5" value={config.idleTimeThreshold} onChange={e => updateConfig('idleTimeThreshold', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Demand Warning (%)</Label>
            <Input type="number" value={config.demandWarningPercent} onChange={e => updateConfig('demandWarningPercent', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Energy/Part Deviation (%)</Label>
            <Input type="number" value={config.energyPerPartDeviation} onChange={e => updateConfig('energyPerPartDeviation', parseFloat(e.target.value) || 0)} className="font-mono" />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">These thresholds affect AI insight generation and alarm triggers across the platform.</p>
      </div>

      <Button className="gap-2" onClick={handleSave}>
        <Save className="h-4 w-4" /> Save All Configuration
      </Button>
    </div>
  );
}
