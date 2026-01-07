export function formatContentType(ct?: string | null): string {
  if (!ct) return 'UNKNOWN';
  const lower = ct.toLowerCase();

  // Word documents (doc, docx)
  if (
    lower.includes('wordprocessingml') ||
    lower.includes('msword') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc') ||
    lower.includes('application/msword')
  ) {
    return 'APPLICATION/DOC';
  }

  // PDF
  if (lower.includes('pdf')) return 'APPLICATION/PDF';

  // PowerPoint / presentations
  if (lower.includes('presentation') || lower.includes('powerpoint') || lower.includes('ppt')) {
    return 'APPLICATION/PPT';
  }

  // Spreadsheets
  if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('sheet') || lower.includes('xlsx') || lower.includes('csv')) {
    return 'APPLICATION/XLS';
  }

  // Generic short-circuit for common friendly names
  if (lower === 'article' || lower === 'video' || lower === 'audio') {
    return (ct || '').toUpperCase();
  }

  // Fallback: return the original content type uppercased
  return ct.toUpperCase();
}
