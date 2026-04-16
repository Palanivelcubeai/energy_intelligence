import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Shield, Save, Building2, Zap, Cpu, Bell
} from "lucide-react";
import { apiClient } from "@/services/apiClient";
import type { SystemConfig, MachineConfig } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { usePlantConfig } from "@/context/PlantConfigContext";
import { useAuth } from "@/hooks/useAuth";

export default function AdminConfig() {
  const { toast } = useToast();
  const { setPlantName } = usePlantConfig();
  const { email } = useAuth();
  const [config, setConfig] = useState<SystemConfig>({
    plantName: '', location: '', industryType: '', machineCount: 0,
    tariffPerKwh: 0, contractDemand: 0, gridEmissionFactor: 0, demandPenaltyRate: 0,
    renewablePercent: 0, pfMinimum: 0, thdMaximum: 0, idleTimeThreshold: 0, heatThreshold: 85,
    demandWarningPercent: 0, energyPerPartDeviation: 0,
  });
  const [machines, setMachines] = useState<MachineConfig[]>([]);

  useEffect(() => {
    apiClient.get("/config").then(r => setConfig(r.data)).catch(() => {});
    apiClient.get("/machines").then(r => {
      setMachines(r.data.map((m: { id: string; name: string; rated_power_kw: number; production_target: number; heat_threshold_c: number; status: string }) => ({
        id: m.id, name: m.name, ratedPower: Number(m.rated_power_kw),
        productionTarget: m.production_target, heatThreshold: Number(m.heat_threshold_c ?? 85),
        status: m.status as MachineConfig['status'],
      })));
    }).catch(() => {});
  }, []);

  const updateConfig = <K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateMachine = (id: string, field: keyof MachineConfig, value: string | number) => {
    setMachines(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleSave = async () => {
    try {
      await apiClient.put("/config", config);
      await Promise.all(machines.map(m =>
        apiClient.put(`/machines/${m.id}/config`, {
          name: m.name,
          rated_power_kw: m.ratedPower,
          production_target: m.productionTarget,
          heat_threshold_c: m.heatThreshold,
          status: m.status,
          changed_by: email || "admin",
          source: "admin-config",
        })
      ));
      if (config.plantName) setPlantName(config.plantName);
      toast({
        title: "Configuration Saved",
        description: "All settings have been applied. Dashboards will reflect changes.",
      });
    } catch {
      toast({ title: "Save Failed", description: "Could not save configuration.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configuration</h1>
          <p className="text-sm text-muted-foreground">System-level settings affecting all dashboards</p>
        </div>
      </div>

      {/* Row 1: Plant Config + Alert Thresholds side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* A. Plant Configuration */}
        <div className="kpi-card space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Plant Configuration</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
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

        {/* D. Alert Thresholds */}
        <div className="kpi-card space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-warning" />
            <h3 className="text-sm font-semibold text-foreground">Alert Threshold Settings</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Energy/Part Deviation (%)</Label>
              <Input type="number" value={config.energyPerPartDeviation} onChange={e => updateConfig('energyPerPartDeviation', parseFloat(e.target.value) || 0)} className="font-mono" />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Energy Configuration full width */}
      <div className="kpi-card space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Energy Configuration</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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

      {/* Row 3: Machine Configuration full width */}
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
                <TableHead className="text-xs">Heat Threshold (°C)</TableHead>
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
                    <Input type="number" value={m.ratedPower} onChange={e => updateMachine(m.id, 'ratedPower', parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono w-24" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={m.productionTarget} onChange={e => updateMachine(m.id, 'productionTarget', parseInt(e.target.value) || 0)} className="h-8 text-xs font-mono w-28" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={m.heatThreshold} onChange={e => updateMachine(m.id, 'heatThreshold', parseFloat(e.target.value) || 0)} className="h-8 text-xs font-mono w-28" />
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

      <Button className="gap-2" onClick={handleSave}>
        <Save className="h-4 w-4" /> Save All Configuration
      </Button>
    </div>
  );
}
