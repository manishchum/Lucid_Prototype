import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface KPIIndicator {
  name: string;
  description: string;
  formula: string;
}

interface DatasetSuggestion {
  source: string;
  data_points: string[];
  purpose: string;
}

interface SuggestedModule {
  module_id?: string;
  title: string;
  description: string;
  source: 'database' | 'ai-generated';
  content_type?: string;
  relevance_score?: number;
  target_kpi: string;
  kpi_type: 'lead' | 'lag';
  suggested_datasets?: DatasetSuggestion[];
}

interface KPIPDFData {
  roleName: string;
  leadIndicators: KPIIndicator[];
  lagIndicators: KPIIndicator[];
  suggestedModules: SuggestedModule[];
}

export function generateKPIReport(data: KPIPDFData) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  // ─── Color palette ───
  const colors = {
    primary: [59, 91, 219] as [number, number, number],       // Blue
    green: [22, 163, 74] as [number, number, number],          // Green
    blue: [37, 99, 235] as [number, number, number],           // Blue
    purple: [124, 58, 237] as [number, number, number],        // Purple
    orange: [234, 88, 12] as [number, number, number],         // Orange
    darkGray: [31, 41, 55] as [number, number, number],
    medGray: [107, 114, 128] as [number, number, number],
    lightGray: [243, 244, 246] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
  };

  // ─── Helper: check page break ───
  const checkPageBreak = (requiredHeight: number) => {
    if (y + requiredHeight > pageHeight - 20) {
      doc.addPage();
      y = margin;
    }
  };

  // ─── Helper: draw section header ───
  const drawSectionHeader = (title: string, color: [number, number, number]) => {
    checkPageBreak(14);
    doc.setFillColor(...color);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...colors.white);
    doc.text(title, margin + 5, y + 7);
    y += 14;
  };

  // ─── Helper: draw wrapped text and return new y ───
  const drawWrappedText = (text: string, x: number, startY: number, maxWidth: number, fontSize: number = 9, fontStyle: string = 'normal'): number => {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      checkPageBreak(6);
      doc.text(line, x, startY);
      startY += 5;
    }
    return startY;
  };

  // ═══════════════════════════════════════════
  // PAGE 1: COVER / HEADER
  // ═══════════════════════════════════════════

  // Header bar
  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, pageWidth, 45, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...colors.white);
  doc.text('KPI Intelligence Report', margin, 20);

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(220, 220, 255);
  doc.text(`Role: ${data.roleName}`, margin, 32);

  // Date on the right
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 255);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.text(`Generated: ${dateStr}`, pageWidth - margin, 32, { align: 'right' });

  y = 55;

  // ─── Summary Stats ───
  const leadCount = data.leadIndicators.length;
  const lagCount = data.lagIndicators.length;
  const moduleCount = data.suggestedModules.length;

  const statBoxWidth = (contentWidth - 10) / 3;
  const statsData = [
    { label: 'Lead Indicators', value: leadCount.toString(), color: colors.green },
    { label: 'Lag Indicators', value: lagCount.toString(), color: colors.blue },
    { label: 'Suggested Sprints', value: moduleCount.toString(), color: colors.purple },
  ];

  statsData.forEach((stat, i) => {
    const x = margin + i * (statBoxWidth + 5);
    doc.setFillColor(...colors.lightGray);
    doc.roundedRect(x, y, statBoxWidth, 22, 2, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...stat.color);
    doc.text(stat.value, x + statBoxWidth / 2, y + 10, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...colors.medGray);
    doc.text(stat.label, x + statBoxWidth / 2, y + 17, { align: 'center' });
  });

  y += 30;

  // ═══════════════════════════════════════════
  // SECTION: LEAD INDICATORS
  // ═══════════════════════════════════════════

  drawSectionHeader(`Lead Indicators (Predictive Metrics)`, colors.green);

  if (data.leadIndicators.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['#', 'Indicator Name', 'Description', 'Formula']],
      body: data.leadIndicators.map((ind, i) => [
        (i + 1).toString(),
        ind.name,
        ind.description,
        ind.formula || 'N/A',
      ]),
      styles: {
        fontSize: 8,
        cellPadding: 3,
        lineColor: [229, 231, 235],
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [22, 163, 74],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: {
        fillColor: [240, 253, 244],
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 35, fontStyle: 'bold' },
        2: { cellWidth: 70 },
        3: { cellWidth: 'auto', fontStyle: 'italic', textColor: [75, 85, 99] },
      },
      didDrawPage: () => {
        // Reset y on new page
      },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ═══════════════════════════════════════════
  // SECTION: LAG INDICATORS
  // ═══════════════════════════════════════════

  checkPageBreak(30);
  drawSectionHeader(`Lag Indicators (Outcome Metrics)`, colors.blue);

  if (data.lagIndicators.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['#', 'Indicator Name', 'Description', 'Formula']],
      body: data.lagIndicators.map((ind, i) => [
        (i + 1).toString(),
        ind.name,
        ind.description,
        ind.formula || 'N/A',
      ]),
      styles: {
        fontSize: 8,
        cellPadding: 3,
        lineColor: [229, 231, 235],
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: {
        fillColor: [239, 246, 255],
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 35, fontStyle: 'bold' },
        2: { cellWidth: 70 },
        3: { cellWidth: 'auto', fontStyle: 'italic', textColor: [75, 85, 99] },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ═══════════════════════════════════════════
  // SECTION: SUGGESTED SPRINTS BY KPI
  // ═══════════════════════════════════════════

  if (data.suggestedModules.length > 0) {
    checkPageBreak(30);
    drawSectionHeader('Suggested Sprints by KPI', colors.purple);

    // Group modules by KPI type and target_kpi
    const leadModules = data.suggestedModules.filter(m => m.kpi_type === 'lead');
    const lagModules = data.suggestedModules.filter(m => m.kpi_type === 'lag');

    const groupByKpi = (modules: SuggestedModule[]) => {
      return modules.reduce((acc, mod) => {
        if (!acc[mod.target_kpi]) acc[mod.target_kpi] = [];
        acc[mod.target_kpi].push(mod);
        return acc;
      }, {} as Record<string, SuggestedModule[]>);
    };

    // ─── Lead Indicator Sprints ───
    const groupedLead = groupByKpi(leadModules);
    if (Object.keys(groupedLead).length > 0) {
      checkPageBreak(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...colors.green);
      doc.text('Lead Indicator Sprints', margin, y);
      y += 7;

      for (const [kpi, modules] of Object.entries(groupedLead)) {
        checkPageBreak(15);

        // KPI name label
        doc.setFillColor(240, 253, 244);
        doc.roundedRect(margin, y - 4, contentWidth, 8, 1, 1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...colors.darkGray);
        doc.text(`${kpi}`, margin + 3, y + 1);
        y += 8;

        // Modules table for this KPI
        const tableBody: (string | string[])[][] = [];
        modules.forEach((mod, i) => {
          // Format datasets as bullet points
          let datasetsText = 'N/A';
          if (mod.suggested_datasets && mod.suggested_datasets.length > 0) {
            datasetsText = mod.suggested_datasets.map(ds => 
              `• ${ds.source}\n  Track: ${ds.data_points.join(', ')}\n  Purpose: ${ds.purpose}`
            ).join('\n\n');
          }

          tableBody.push([
            (i + 1).toString(),
            mod.title,
            mod.description,
            mod.relevance_score ? `${mod.relevance_score}%` : '-',
            datasetsText,
          ]);
        });

        autoTable(doc, {
          startY: y,
          margin: { left: margin + 2, right: margin },
          head: [['#', 'Sprint Title', 'Description', 'Match', 'Suggested Datasets']],
          body: tableBody,
          styles: {
            fontSize: 7.5,
            cellPadding: 2.5,
            lineColor: [229, 231, 235],
            lineWidth: 0.2,
            overflow: 'linebreak',
          },
          headStyles: {
            fillColor: [22, 163, 74],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
          },
          alternateRowStyles: {
            fillColor: [250, 255, 250],
          },
          columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 30, fontStyle: 'bold' },
            2: { cellWidth: 50 },
            3: { cellWidth: 14, halign: 'center' },
            4: { cellWidth: 'auto', fontSize: 7, textColor: [107, 114, 128] },
          },
        });

        y = (doc as any).lastAutoTable.finalY + 6;
      }
    }

    // ─── Lag Indicator Sprints ───
    const groupedLag = groupByKpi(lagModules);
    if (Object.keys(groupedLag).length > 0) {
      checkPageBreak(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...colors.blue);
      doc.text('Lag Indicator Sprints', margin, y);
      y += 7;

      for (const [kpi, modules] of Object.entries(groupedLag)) {
        checkPageBreak(15);

        // KPI name label
        doc.setFillColor(239, 246, 255);
        doc.roundedRect(margin, y - 4, contentWidth, 8, 1, 1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...colors.darkGray);
        doc.text(`${kpi}`, margin + 3, y + 1);
        y += 8;

        const tableBody: (string | string[])[][] = [];
        modules.forEach((mod, i) => {
          // Format datasets as bullet points
          let datasetsText = 'N/A';
          if (mod.suggested_datasets && mod.suggested_datasets.length > 0) {
            datasetsText = mod.suggested_datasets.map(ds => 
              `• ${ds.source}\n  Track: ${ds.data_points.join(', ')}\n  Purpose: ${ds.purpose}`
            ).join('\n\n');
          }

          tableBody.push([
            (i + 1).toString(),
            mod.title,
            mod.description,
            mod.relevance_score ? `${mod.relevance_score}%` : '-',
            datasetsText,
          ]);
        });

        autoTable(doc, {
          startY: y,
          margin: { left: margin + 2, right: margin },
          head: [['#', 'Sprint Title', 'Description', 'Match', 'Suggested Datasets']],
          body: tableBody,
          styles: {
            fontSize: 7.5,
            cellPadding: 2.5,
            lineColor: [229, 231, 235],
            lineWidth: 0.2,
            overflow: 'linebreak',
          },
          headStyles: {
            fillColor: [37, 99, 235],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
          },
          alternateRowStyles: {
            fillColor: [245, 249, 255],
          },
          columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 30, fontStyle: 'bold' },
            2: { cellWidth: 50 },
            3: { cellWidth: 14, halign: 'center' },
            4: { cellWidth: 'auto', fontSize: 7, textColor: [107, 114, 128] },
          },
        });

        y = (doc as any).lastAutoTable.finalY + 6;
      }
    }
  }

  // ═══════════════════════════════════════════
  // FOOTER on every page
  // ═══════════════════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(245, 245, 245);
    doc.rect(0, pageHeight - 12, pageWidth, 12, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...colors.medGray);
    doc.text('KPI Intelligence Report — Lucid Learning', margin, pageHeight - 5);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
  }

  // ─── Save ───
  const filename = `KPI_Report_${data.roleName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
