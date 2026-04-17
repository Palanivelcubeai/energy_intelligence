import { useState, useEffect, useMemo } from 'react';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/services/apiClient';
import ReportTable from '@/components/ReportTable';
import IntelligenceReportDocument, { type IntelligenceReportDocumentData } from '@/components/IntelligenceReportDocument';
import ExcelJS from 'exceljs';
import { useToast } from '@/hooks/use-toast';
import { usePlantConfig } from '@/context/PlantConfigContext';

const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const REPORTS_CACHE_KEY = 'reports.cache.meta.v1';
const REPORT_DATA_CACHE_KEY = 'reports.cache.data.v1';
const INTELLIGENCE_DOC_CACHE_KEY = 'reports.cache.intelligence.v1';

let reportsCache: ReportMeta[] = [];
let reportsCacheAt = 0;
let reportDataCache: Record<string, Record<string, unknown>[]> = {};
let reportDataCacheAt = 0;
let intelligenceDocCache: IntelligenceReportDocumentData | null = null;
let intelligenceDocCacheAt = 0;

function hydrateCachesFromSessionStorage() {
  if (typeof window === 'undefined') return;

  try {
    const metaRaw = window.sessionStorage.getItem(REPORTS_CACHE_KEY);
    if (metaRaw) {
      const parsed = JSON.parse(metaRaw) as { at: number; data: ReportMeta[] };
      if (Array.isArray(parsed?.data) && Number.isFinite(parsed?.at)) {
        reportsCache = parsed.data;
        reportsCacheAt = parsed.at;
      }
    }
  } catch {}

  try {
    const dataRaw = window.sessionStorage.getItem(REPORT_DATA_CACHE_KEY);
    if (dataRaw) {
      const parsed = JSON.parse(dataRaw) as { at: number; data: Record<string, Record<string, unknown>[]> };
      if (parsed?.data && typeof parsed.data === 'object' && Number.isFinite(parsed?.at)) {
        reportDataCache = parsed.data;
        reportDataCacheAt = parsed.at;
      }
    }
  } catch {}

  try {
    const intelRaw = window.sessionStorage.getItem(INTELLIGENCE_DOC_CACHE_KEY);
    if (intelRaw) {
      const parsed = JSON.parse(intelRaw) as { at: number; data: IntelligenceReportDocumentData | null };
      if ('data' in (parsed || {}) && Number.isFinite(parsed?.at)) {
        intelligenceDocCache = parsed.data;
        intelligenceDocCacheAt = parsed.at;
      }
    }
  } catch {}
}

function persistReportCachesToSessionStorage() {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      REPORTS_CACHE_KEY,
      JSON.stringify({ at: reportsCacheAt, data: reportsCache })
    );
  } catch {}

  try {
    window.sessionStorage.setItem(
      REPORT_DATA_CACHE_KEY,
      JSON.stringify({ at: reportDataCacheAt, data: reportDataCache })
    );
  } catch {}

  try {
    window.sessionStorage.setItem(
      INTELLIGENCE_DOC_CACHE_KEY,
      JSON.stringify({ at: intelligenceDocCacheAt, data: intelligenceDocCache })
    );
  } catch {}
}

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
    { key: 'recommended_action', label: 'Recommended Action' },
  ],
};

interface ReportMeta { key: string; name: string; description: string; lastGenerated: string }

async function elementToPngDataUrl(element: HTMLElement): Promise<string | null> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

async function fetchImageAsDataUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function Reports() {
  const { toast } = useToast();
  const { plantName } = usePlantConfig();
  const [reports, setReports] = useState<ReportMeta[]>(() => {
    const cacheFresh = Date.now() - reportsCacheAt <= REPORT_CACHE_TTL_MS;
    return cacheFresh ? reportsCache : [];
  });
  const [reportData, setReportData] = useState<Record<string, Record<string, unknown>[]>>(() => {
    const cacheFresh = Date.now() - reportDataCacheAt <= REPORT_CACHE_TTL_MS;
    return cacheFresh ? reportDataCache : {};
  });
  const [loadingByKey, setLoadingByKey] = useState<Record<string, boolean>>({});
  const [intelligenceDoc, setIntelligenceDoc] = useState<IntelligenceReportDocumentData | null>(() => {
    const cacheFresh = Date.now() - intelligenceDocCacheAt <= REPORT_CACHE_TTL_MS;
    return cacheFresh ? intelligenceDocCache : null;
  });
  const [loadingIntelligenceDoc, setLoadingIntelligenceDoc] = useState(false);
  const [exportingIntelligencePdf, setExportingIntelligencePdf] = useState(false);

  useEffect(() => {
    hydrateCachesFromSessionStorage();

    const reportsFresh = Date.now() - reportsCacheAt <= REPORT_CACHE_TTL_MS;
    const dataFresh = Date.now() - reportDataCacheAt <= REPORT_CACHE_TTL_MS;
    const intelFresh = Date.now() - intelligenceDocCacheAt <= REPORT_CACHE_TTL_MS;

    if (reportsFresh && reportsCache.length > 0 && reports.length === 0) {
      setReports(reportsCache);
    }
    if (dataFresh && Object.keys(reportDataCache).length > 0 && Object.keys(reportData).length === 0) {
      setReportData(reportDataCache);
    }
    if (intelFresh && intelligenceDocCache && !intelligenceDoc) {
      setIntelligenceDoc(intelligenceDocCache);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cacheFresh = Date.now() - reportsCacheAt <= REPORT_CACHE_TTL_MS;

    if (cacheFresh && reportsCache.length > 0) {
      setReports(reportsCache);
    }

    apiClient
      .get('/reports/list')
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data : [];
        setReports(list);
        reportsCache = list;
        reportsCacheAt = Date.now();
        persistReportCachesToSessionStorage();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
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
    let intelligenceRefreshTimer: number | null = null;
    const dataCacheFresh = Date.now() - reportDataCacheAt <= REPORT_CACHE_TTL_MS;
    const intelligenceCacheFresh = Date.now() - intelligenceDocCacheAt <= REPORT_CACHE_TTL_MS;
    const cacheHasAllReports = orderedReports.every((r) => Array.isArray(reportDataCache[r.key]));
    const shouldFetchReportData = !dataCacheFresh || !cacheHasAllReports;
    const shouldFetchIntelligence = !intelligenceCacheFresh;

    // Show loading only if a report has no cached rows at all.
    const nextLoading: Record<string, boolean> = {};
    orderedReports.forEach((r) => {
      const hasCachedData = Array.isArray(reportDataCache[r.key]);
      const hasLocalData = Array.isArray(reportData[r.key]);
      nextLoading[r.key] = shouldFetchReportData && !hasCachedData && !hasLocalData;
    });
    setLoadingByKey(nextLoading);

    // Hydrate from cache immediately if available to avoid tab-switch flicker.
    if (Object.keys(reportData).length === 0 && Object.keys(reportDataCache).length > 0) {
      setReportData(reportDataCache);
    }

    if (!shouldFetchReportData) {
      setReportData(reportDataCache);
      const noLoading: Record<string, boolean> = {};
      orderedReports.forEach((r) => {
        noLoading[r.key] = false;
      });
      setLoadingByKey(noLoading);
    }

    if (shouldFetchReportData) {
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
        reportDataCache = nextData;
        reportDataCacheAt = Date.now();
        persistReportCachesToSessionStorage();
      });
    }

    const hasIntelligence = orderedReports.some((r) => r.key === 'intelligence_summary');
    if (hasIntelligence && (shouldFetchIntelligence || !intelligenceDocCache)) {
      setLoadingIntelligenceDoc(!intelligenceDocCache);

      apiClient
        .get('/reports/intelligence-summary/document-fast', { timeout: 7000 })
        .then((r) => {
          if (cancelled) return;
          setIntelligenceDoc(r.data);
          intelligenceDocCache = r.data;
          intelligenceDocCacheAt = Date.now();
          persistReportCachesToSessionStorage();
        })
        .catch(() => {
          if (cancelled) return;
          if (!intelligenceDocCache) {
            setIntelligenceDoc(null);
            intelligenceDocCache = null;
            intelligenceDocCacheAt = 0;
            persistReportCachesToSessionStorage();
          }
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingIntelligenceDoc(false);

          apiClient
            .get('/reports/intelligence-summary/document')
            .then((r) => {
              if (cancelled) return;
              setIntelligenceDoc(r.data);
              intelligenceDocCache = r.data;
              intelligenceDocCacheAt = Date.now();
              persistReportCachesToSessionStorage();
            })
            .catch(() => {
              // Keep fast payload and avoid clearing the rendered document on full-refresh failures.
            });
        });
    } else if (hasIntelligence && intelligenceDocCache) {
      setIntelligenceDoc(intelligenceDocCache);
      setLoadingIntelligenceDoc(false);
    }

    if (hasIntelligence) {
      intelligenceRefreshTimer = window.setInterval(() => {
        if (cancelled || document.hidden) return;

        apiClient
          .get('/reports/intelligence-summary/document-fast', { timeout: 7000 })
          .then((r) => {
            if (cancelled) return;
            setIntelligenceDoc(r.data);
            intelligenceDocCache = r.data;
            intelligenceDocCacheAt = Date.now();
            persistReportCachesToSessionStorage();
          })
          .catch(() => {
            // Keep existing intelligence content if refresh fails.
          });
      }, 30000);
    }

    return () => {
      cancelled = true;
      if (intelligenceRefreshTimer != null) {
        window.clearInterval(intelligenceRefreshTimer);
      }
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

  const downloadIntelligencePdf = async () => {
    try {
      setExportingIntelligencePdf(true);

      let exportDoc = intelligenceDoc;
      if (!exportDoc) {
        const response = await apiClient.get('/reports/intelligence-summary/document');
        exportDoc = response.data as IntelligenceReportDocumentData;
        setIntelligenceDoc(exportDoc);
      }

      if (!exportDoc) {
        toast({ title: 'PDF export unavailable', description: 'Intelligence report data is not ready yet.', variant: 'destructive' });
        return;
      }

      const jsPdfModule = await import('jspdf');
      const doc = new jsPdfModule.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

      const pageWidth = 210;
      const pageHeight = 297;
      const leftMargin = 38.1; // 1.5 inch
      const rightMargin = 25.4; // 1 inch
      const topMargin = 25.4; // 1 inch
      const bottomMargin = 25.4; // 1 inch
      const topContentStart = topMargin + 10;
      const bottomReserve = 10;
      const contentWidth = pageWidth - leftMargin - rightMargin;
      const lineHeight = 6.35; // 12pt with 1.5 line spacing in mm
      let y = topContentStart;
      const logoDataUrl = await fetchImageAsDataUrl('/clean.png');

      const fitText = (value: string, maxWidth: number) => {
        const text = String(value || '');
        if (doc.getTextWidth(text) <= maxWidth) return text;
        let out = text;
        while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxWidth) {
          out = out.slice(0, -1);
        }
        return `${out}...`;
      };

      const addHeader = () => {
        if (logoDataUrl) {
          doc.addImage(logoDataUrl, 'PNG', pageWidth - rightMargin - 14, 8, 12, 12);
        }
        doc.setFont('times', 'bold');
        doc.setFontSize(14);
        doc.text((plantName || 'Plant').toUpperCase(), leftMargin, 12);
        doc.setFontSize(12);
        doc.text('AI Intelligence Report', leftMargin, 18);
        doc.setDrawColor(210, 210, 210);
        doc.line(leftMargin, 21, pageWidth - rightMargin, 21);
      };

      const addFooter = (pageNumber: number, totalPages: number) => {
        doc.setDrawColor(210, 210, 210);
        doc.line(leftMargin, pageHeight - bottomMargin + 5, pageWidth - rightMargin, pageHeight - bottomMargin + 5);
        doc.setFont('times', 'normal');
        doc.setFontSize(10);
        doc.text('Confidential - Internal Use Only', leftMargin, pageHeight - bottomMargin + 11);
        doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - rightMargin, pageHeight - bottomMargin + 11, { align: 'right' });
      };

      const ensureSpace = (needed = 12) => {
        const availableBottom = pageHeight - bottomMargin - bottomReserve;
        if (y + needed > availableBottom) {
          doc.addPage();
          addHeader();
          y = topContentStart;
        }
      };

      const writeHeading = (text: string) => {
        ensureSpace(14);
        doc.setFont('times', 'bold');
        doc.setFontSize(14);
        doc.text(text, leftMargin, y);
        y += 8;
      };

      const writeSubHeading = (text: string) => {
        ensureSpace(14);
        if (y > topContentStart) y += 1.5;
        doc.setFont('times', 'bold');
        doc.setFontSize(14);
        doc.text(text, leftMargin, y);
        y += 9;
      };

      const writeSectionItemHeading = (text: string) => {
        ensureSpace(11);
        doc.setFont('times', 'bold');
        doc.setFontSize(12);
        const lines = doc.splitTextToSize(text.trim(), contentWidth);
        doc.text(lines, leftMargin, y, { maxWidth: contentWidth, lineHeightFactor: 1.3 });
        y += lines.length * 5.4 + 1.5;
      };

      const writeBody = (text: string) => {
        const cleanText = text.trim();
        if (!cleanText) return;
        doc.setFont('times', 'normal');
        doc.setFontSize(12);
        const lines = doc.splitTextToSize(cleanText, contentWidth);
        const needed = Math.max(8, lines.length * lineHeight + 2.5);
        ensureSpace(needed);
        doc.text(lines, leftMargin, y, { maxWidth: contentWidth, lineHeightFactor: 1.45 });
        y += lines.length * lineHeight + 2.5;
      };

      const writeBullet = (text: string) => {
        const bulletPrefix = '- ';
        const hangingIndent = doc.getTextWidth(bulletPrefix);
        const lines = doc.splitTextToSize(text, contentWidth - hangingIndent);
        const needed = Math.max(8, lines.length * lineHeight + 1.5);
        ensureSpace(needed);
        doc.setFont('times', 'normal');
        doc.setFontSize(12);
        doc.text(bulletPrefix, leftMargin, y);
        doc.text(lines, leftMargin + hangingIndent, y, { maxWidth: contentWidth - hangingIndent, lineHeightFactor: 1.45 });
        y += lines.length * lineHeight + 1.5;
      };

      const writeMachineTable = () => {
        writeSubHeading('Machine Snapshot');
        ensureSpace(12);

        const cols = [
          { key: 'machine', label: 'Machine', width: 52 },
          { key: 'parts', label: 'Parts', width: 18 },
          { key: 'rejectRate', label: 'Reject %', width: 22 },
          { key: 'efficiency', label: 'Eff %', width: 18 },
          { key: 'powerFactor', label: 'PF', width: 14 },
          { key: 'risk', label: 'Risk', width: 16 },
        ] as const;

        const rowHeight = 8;
        const startX = leftMargin;

        doc.setFillColor(240, 245, 250);
        doc.rect(startX, y, cols.reduce((s, c) => s + c.width, 0), rowHeight, 'F');
        doc.setFont('times', 'bold');
        doc.setFontSize(9);
        let x = startX + 1.5;
        cols.forEach((col) => {
          doc.text(col.label, x, y + 4.8);
          x += col.width;
        });
        y += rowHeight;

        doc.setFont('times', 'normal');
        doc.setFontSize(9);
        exportDoc.machines.slice(0, 10).forEach((machine) => {
          ensureSpace(rowHeight + 2);
          let rowX = startX + 1.5;

          const values = [
            String(machine.machine),
            String(machine.parts),
            `${machine.rejectRate}%`,
            `${machine.efficiency}%`,
            String(machine.powerFactor),
            String(machine.risk),
          ];

          values.forEach((value, index) => {
            const colWidth = cols[index].width - 3;
            const clipped = fitText(value, colWidth);
            doc.text(clipped, rowX, y + 4.8);
            rowX += cols[index].width;
          });

          doc.setDrawColor(230, 230, 230);
          doc.line(startX, y + rowHeight, startX + cols.reduce((s, c) => s + c.width, 0), y + rowHeight);
          y += rowHeight;
        });

        y += 5;
      };

      const writeAppendixTable = () => {
        const appendixRows = Array.isArray(reportData.intelligence_summary)
          ? reportData.intelligence_summary
          : [];
        if (appendixRows.length === 0) return;

        writeSubHeading('Detailed Metrics Appendix');
        const maxRows = 35;

        const fieldGap = 4.6;
        const blockPad = 2.2;
        const blockBottomGap = 2.8;
        const wrapWidth = contentWidth - 4;

        const normalizeText = (value: unknown) => String(value ?? '-').replace(/\s+/g, ' ').trim() || '-';

        const metricLines = (label: string, value: unknown, boldLabel = true) => {
          const text = `${label}: ${normalizeText(value)}`;
          const lines = doc.splitTextToSize(text, wrapWidth);
          return {
            lines,
            lineHeight: boldLabel ? 4.9 : 4.6,
            boldLabel,
          };
        };

        appendixRows.slice(0, maxRows).forEach((row) => {
          const lines = [
            metricLines('Section', row.section),
            metricLines('Metric', row.metric),
            metricLines('Value', row.value),
            metricLines('Status', row.status),
            metricLines('Recommended Action', row.recommended_action, false),
          ];

          const contentHeight = lines.reduce((sum, item) => {
            const count = Math.max(1, item.lines.length);
            return sum + count * item.lineHeight;
          }, 0) + fieldGap * (lines.length - 1);
          const blockHeight = contentHeight + blockPad * 2;

          ensureSpace(blockHeight + blockBottomGap);
          doc.setFillColor(250, 250, 250);
          doc.roundedRect(leftMargin, y, contentWidth, blockHeight, 1.5, 1.5, 'F');
          doc.setDrawColor(228, 228, 228);
          doc.roundedRect(leftMargin, y, contentWidth, blockHeight, 1.5, 1.5, 'S');

          let cursorY = y + blockPad + 3.6;
          lines.forEach((item) => {
            doc.setFont('times', item.boldLabel ? 'bold' : 'normal');
            doc.setFontSize(9);
            doc.text(item.lines, leftMargin + 2, cursorY, {
              maxWidth: wrapWidth,
              lineHeightFactor: 1.2,
            });
            cursorY += Math.max(1, item.lines.length) * item.lineHeight + fieldGap;
          });

          y += blockHeight + blockBottomGap;
        });

        if (appendixRows.length > maxRows) {
          writeBody(`Appendix truncated to first ${maxRows} rows for PDF readability. Total rows available: ${appendixRows.length}.`);
        }
      };

      addHeader();

      writeHeading(exportDoc.title || 'Intelligence Report');
      doc.setFont('times', 'normal');
      doc.setFontSize(12);
      doc.text(`Generated: ${new Date(exportDoc.generatedAt).toLocaleString()}`, leftMargin, y);
      y += 5;
      doc.text(`Model: ${exportDoc.modelUsed}`, leftMargin, y);
      y += 8;

      writeSubHeading('Executive Summary');
      writeBody(exportDoc.executiveSummary || 'No executive summary available.');

      writeSubHeading('KPI Summary');
      writeBullet(`AI accuracy: ${exportDoc.aiAccuracy.overall}%`);
      writeBullet(`Machine status split: Running ${exportDoc.kpis.runningMachines}, Idle ${exportDoc.kpis.idleMachines}, Maintenance ${exportDoc.kpis.maintenanceMachines}`);
      writeBullet(`Total production: ${exportDoc.kpis.totalProduction} parts`);
      writeBullet(`Total energy: ${exportDoc.kpis.totalEnergy} kWh`);
      writeBullet(`Average efficiency: ${exportDoc.kpis.avgEfficiency}%`);
      writeBullet(`Reject rate: ${exportDoc.kpis.rejectRatePct}%`);
      writeBullet(`Utilization: ${exportDoc.kpis.utilizationPct}%`);

      writeSubHeading('AI Accuracy Details');
      const pdfInsightConfidenceLabel = exportDoc.aiAccuracy.insightConfidence == null
        ? 'N/A'
        : `${exportDoc.aiAccuracy.insightConfidence}%${exportDoc.aiAccuracy.insightConfidenceEstimated ? ' (estimated)' : ''}`;
      const pdfDemandBacktestLabel = exportDoc.aiAccuracy.demandBacktestReady
        ? `${exportDoc.aiAccuracy.demandBacktest}%`
        : `Pending (${exportDoc.aiAccuracy.demandBacktestSamples ?? 0}/${exportDoc.aiAccuracy.demandBacktestMinSamples ?? 7} days)`;
      writeBullet(`Insight confidence: ${pdfInsightConfidenceLabel}`);
      writeBullet(`Predictive confidence: ${exportDoc.aiAccuracy.predictiveConfidence}%`);
      writeBullet(`Data freshness: ${exportDoc.aiAccuracy.dataFreshness}%`);
      writeBullet(`Demand backtest: ${pdfDemandBacktestLabel}`);
      writeBullet(`Demand hit-rate (20% error band): ${exportDoc.aiAccuracy.demandHitRate}%`);
      writeBullet(`Demand hit-rate (10% error band): ${exportDoc.aiAccuracy.demandHitRate10 ?? 0}%`);
      writeBullet(`Demand MAPE: ${exportDoc.aiAccuracy.demandMape}%`);

      if (exportDoc.sectionSummaries.length > 0) {
        writeSubHeading('Section Summaries');
        exportDoc.sectionSummaries.forEach((section) => {
          writeSectionItemHeading(section.heading);
          writeBody(section.summary);
        });
      }

      if (exportDoc.recommendations.length > 0) {
        writeSubHeading('Recommendations');
        exportDoc.recommendations.forEach((rec, index) => {
          writeBullet(`${index + 1}. ${rec}`);
        });
      }

      writeMachineTable();
  writeAppendixTable();

  // Wait for chart components to finish render/layout before capture.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const productionChartEl = document.getElementById('intel-chart-production');
      const demandChartEl = document.getElementById('intel-chart-demand');

      const productionChartImage = productionChartEl instanceof HTMLElement
        ? await elementToPngDataUrl(productionChartEl)
        : null;
      const demandChartImage = demandChartEl instanceof HTMLElement
        ? await elementToPngDataUrl(demandChartEl)
        : null;

      if (productionChartImage || demandChartImage) {
        writeSubHeading('Charts');

        if (productionChartImage) {
          ensureSpace(86);
          doc.setFont('times', 'bold');
          doc.setFontSize(14);
          doc.text('Production, Energy and Efficiency Trend', leftMargin, y);
          y += 4;
          doc.addImage(productionChartImage, 'PNG', leftMargin, y, contentWidth, 70);
          y += 76;
        }

        if (demandChartImage) {
          ensureSpace(86);
          doc.setFont('times', 'bold');
          doc.setFontSize(14);
          doc.text('Demand Prediction Backtest', leftMargin, y);
          y += 4;
          doc.addImage(demandChartImage, 'PNG', leftMargin, y, contentWidth, 70);
          y += 76;
        }
      } else {
        writeSubHeading('Charts');
        writeBody('Chart image capture was unavailable at export time. Please keep chart sections visible and try again.');
      }

      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        addFooter(page, totalPages);
      }

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      doc.save(`Intelligence_Report_${dateStr}.pdf`);
      toast({ title: 'PDF downloaded', description: 'Intelligence report PDF has been generated successfully.' });
    } catch {
      toast({ title: 'PDF download failed', description: 'Unable to generate PDF right now. Please try again.', variant: 'destructive' });
    } finally {
      setExportingIntelligencePdf(false);
    }
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

                {r.key !== 'intelligence_summary' ? (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={() => downloadExcel(r)}
                    >
                      <Download className="h-3 w-3 mr-1" /> Download Excel
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={downloadIntelligencePdf}
                      disabled={loadingIntelligenceDoc || exportingIntelligencePdf}
                    >
                      <Download className="h-3 w-3 mr-1" /> {exportingIntelligencePdf ? 'Preparing PDF...' : 'Download PDF'}
                    </Button>
                  </div>
                )}
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
