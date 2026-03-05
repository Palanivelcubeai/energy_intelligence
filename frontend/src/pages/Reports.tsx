import { useState, useMemo } from 'react';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { reportDefinitions } from '@/data/reportData';
import ReportTable from '@/components/ReportTable';
import ExcelJS from 'exceljs';

export default function Reports() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = useMemo(
    () => reportDefinitions.find(r => r.key === selectedKey) ?? null,
    [selectedKey],
  );

  const tableData = useMemo(() => selected?.getData() ?? [], [selected]);

  const downloadExcel = async (e: React.MouseEvent, report: typeof reportDefinitions[number]) => {
    e.stopPropagation();
    const data = report.getData();
    const wsData = [
      report.columns.map(c => c.label),
      ...data.map(row => report.columns.map(c => row[c.key])),
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
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate and download operational reports</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reportDefinitions.map(r => (
          <div
            key={r.key}
            className="kpi-card cursor-pointer transition-all hover:ring-1 hover:ring-primary/50"
            onClick={() => setSelectedKey(r.key)}
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
                  <span className="text-[10px] text-muted-foreground">Last: {r.lastGenerated}</span>
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
              <ReportTable
                reportName={selected.name}
                columns={selected.columns}
                data={tableData}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
