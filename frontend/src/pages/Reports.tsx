import { useState, useEffect } from 'react';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { apiClient } from '@/services/apiClient';
import ReportTable from '@/components/ReportTable';
import ExcelJS from 'exceljs';

const reportColumns: Record<string, { key: string; label: string }[]> = {
  daily_cnc_energy: [
    { key: 'date', label: 'Date' }, { key: 'machine', label: 'CNC Machine' },
    { key: 'energy_kwh', label: 'Energy (kWh)' }, { key: 'runtime_hrs', label: 'Runtime (hrs)' },
    { key: 'idle_hrs', label: 'Idle Time (hrs)' }, { key: 'energy_per_part', label: 'Energy per Part' },
    { key: 'status', label: 'Status' },
  ],
  production: [
    { key: 'date', label: 'Date' }, { key: 'machine', label: 'CNC Machine' },
    { key: 'shift', label: 'Shift' }, { key: 'parts_produced', label: 'Parts Produced' },
    { key: 'rejected_parts', label: 'Rejected Parts' }, { key: 'production_target', label: 'Production Target' },
    { key: 'efficiency', label: 'Efficiency %' },
  ],
  energy_per_part: [
    { key: 'machine', label: 'CNC Machine' }, { key: 'total_energy', label: 'Total Energy (kWh)' },
    { key: 'total_parts', label: 'Total Parts' }, { key: 'energy_per_part', label: 'Energy per Part' },
    { key: 'cost_per_part', label: 'Cost per Part (₹)' }, { key: 'efficiency_rank', label: 'Efficiency Rank' },
  ],
  monthly_efficiency: [
    { key: 'month', label: 'Month' }, { key: 'total_energy', label: 'Total Energy (kWh)' },
    { key: 'total_production', label: 'Total Production' }, { key: 'avg_energy_per_part', label: 'Avg Energy per Part' },
    { key: 'efficiency_score', label: 'Efficiency Score' }, { key: 'carbon_intensity', label: 'Carbon Intensity' },
  ],
  peak_demand: [
    { key: 'date', label: 'Date' }, { key: 'time_block', label: 'Time Block' },
    { key: 'demand_kva', label: 'Demand (kVA)' }, { key: 'contract_demand', label: 'Contract Demand' },
    { key: 'utilization', label: '% Utilization' }, { key: 'risk_level', label: 'Risk Level' },
  ],
  cost_optimization: [
    { key: 'machine', label: 'CNC Machine' }, { key: 'energy_cost', label: 'Energy Cost (₹)' },
    { key: 'idle_cost', label: 'Idle Cost (₹)' }, { key: 'potential_savings', label: 'Potential Savings (₹)' },
  ],
};

interface ReportMeta { key: string; name: string; description: string; lastGenerated: string }

export default function Reports() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    apiClient.get("/reports/list").then(r => setReports(r.data)).catch(() => {});
  }, []);

  const selected = reports.find(r => r.key === selectedKey) ?? null;
  const columns = selectedKey ? (reportColumns[selectedKey] || []) : [];

  const openReport = (key: string) => {
    setSelectedKey(key);
    setLoadingData(true);
    apiClient.get(`/reports/${key}/data`).then(r => setTableData(r.data)).catch(() => setTableData([])).finally(() => setLoadingData(false));
  };

  const downloadExcel = async (e: React.MouseEvent, report: ReportMeta) => {
    e.stopPropagation();
    const cols = reportColumns[report.key] || [];
    try {
      const { data } = await apiClient.get(`/reports/${report.key}/data`);
      const wsData = [
        cols.map(c => c.label),
        ...data.map((row: Record<string, unknown>) => cols.map(c => row[c.key])),
      ];
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Report');
      ws.addRows(wsData);
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `${report.name.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* handled by interceptor */ }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate and download operational reports</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map(r => (
          <div
            key={r.key}
            className="kpi-card cursor-pointer transition-all hover:ring-1 hover:ring-primary/50"
            onClick={() => openReport(r.key)}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{r.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] text-muted-foreground">Format: Excel</span>
                  <span className="text-[10px] text-muted-foreground">Last: {r.lastGenerated ? new Date(r.lastGenerated).toLocaleDateString() : 'Never'}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={(e) => downloadExcel(e, r)}
                  >
                    <Download className="h-3 w-3 mr-1" /> Download Excel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedKey(null); }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>
              {loadingData ? (
                <p className="text-sm text-muted-foreground py-4">Loading report data...</p>
              ) : (
                <ReportTable
                  reportName={selected.name}
                  columns={columns}
                  data={tableData}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
