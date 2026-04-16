import { useState, useEffect, useMemo } from 'react';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/services/apiClient';
import ReportTable from '@/components/ReportTable';
import IntelligenceReportDocument, { type IntelligenceReportDocumentData } from '@/components/IntelligenceReportDocument';
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
  intelligence_summary: [
    { key: 'section', label: 'Section' },
    { key: 'metric', label: 'Metric' },
    { key: 'value', label: 'Summary Value' },
    { key: 'status', label: 'Status' },
  ],
};

interface ReportMeta { key: string; name: string; description: string; lastGenerated: string }

export default function Reports() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [reportData, setReportData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingByKey, setLoadingByKey] = useState<Record<string, boolean>>({});
  const [intelligenceDoc, setIntelligenceDoc] = useState<IntelligenceReportDocumentData | null>(null);
  const [loadingIntelligenceDoc, setLoadingIntelligenceDoc] = useState(false);

  useEffect(() => {
    apiClient.get("/reports/list").then(r => setReports(r.data)).catch(() => {});
  }, []);

  const orderedReports = useMemo(() => {
    return [...reports].sort((a, b) => {
      if (a.key === 'intelligence_summary') return -1;
      if (b.key === 'intelligence_summary') return 1;
      return 0;
    });
  }, [reports]);

  useEffect(() => {
    if (orderedReports.length === 0) return;

    let cancelled = false;
    const initLoading: Record<string, boolean> = {};
    orderedReports.forEach((r) => { initLoading[r.key] = true; });
    setLoadingByKey(initLoading);

    Promise.all(
      orderedReports.map(async (report) => {
        try {
          const { data } = await apiClient.get(`/reports/${report.key}/data`);
          return { key: report.key, data: Array.isArray(data) ? data : [] };
        } catch {
          return { key: report.key, data: [] as Record<string, unknown>[] };
        }
      })
    ).then((results) => {
      if (cancelled) return;

      const nextData: Record<string, Record<string, unknown>[]> = {};
      const nextLoading: Record<string, boolean> = {};
      results.forEach((r) => {
        nextData[r.key] = r.data;
        nextLoading[r.key] = false;
      });

      setReportData(nextData);
      setLoadingByKey(nextLoading);
    });

    const hasIntelligence = orderedReports.some((r) => r.key === 'intelligence_summary');
    if (hasIntelligence) {
      setLoadingIntelligenceDoc(true);
      apiClient
        .get('/reports/intelligence-summary/document')
        .then((r) => setIntelligenceDoc(r.data))
        .catch(() => setIntelligenceDoc(null))
        .finally(() => setLoadingIntelligenceDoc(false));
    }

    return () => {
      cancelled = true;
    };
  }, [orderedReports]);

  const downloadExcel = async (report: ReportMeta) => {
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
        <p className="text-sm text-muted-foreground">All reports are visible below. Intelligence Summary is pinned at the top.</p>
      </div>

      <div className="space-y-5">
        {orderedReports.map((r) => {
          const cols = reportColumns[r.key] || [];
          const data = reportData[r.key] || [];
          const isLoading = loadingByKey[r.key];

          return (
            <section
              key={r.key}
              className={`rounded-xl border border-border/60 bg-card/50 p-4 ${r.key === 'intelligence_summary' ? 'ring-1 ring-primary/40' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <h2 className="text-base font-semibold text-foreground">{r.name}</h2>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Last generated: {r.lastGenerated ? new Date(r.lastGenerated).toLocaleString() : 'Never'}</p>
                </div>

                <div>
                  {r.key !== 'intelligence_summary' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={() => downloadExcel(r)}
                    >
                      <Download className="h-3 w-3 mr-1" /> Download Excel
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Excel export not available</span>
                  )}
                </div>
              </div>

              <div className="mt-4">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-4">Loading report data...</p>
                ) : r.key === 'intelligence_summary' && loadingIntelligenceDoc ? (
                  <p className="text-sm text-muted-foreground py-4">Building intelligence documentation...</p>
                ) : r.key === 'intelligence_summary' && intelligenceDoc ? (
                  <div className="space-y-4">
                    <IntelligenceReportDocument data={intelligenceDoc} />
                    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Detailed Metrics Appendix</p>
                      <ReportTable
                        reportName={r.name}
                        columns={cols}
                        data={data}
                        disableExport
                      />
                    </div>
                  </div>
                ) : (
                  <ReportTable
                    reportName={r.name}
                    columns={cols}
                    data={data}
                    disableExport={r.key === 'intelligence_summary'}
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
