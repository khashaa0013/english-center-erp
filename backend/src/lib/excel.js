// =====================================================================
// Excel экспорт ба импорт (exceljs)
// =====================================================================
import ExcelJS from 'exceljs';

// sheets: [{ name, columns: [{ header, key, width }], rows: [] }]
export async function sendWorkbook(res, fileName, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'English Center ERP';
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c) => ({ width: 18, ...c }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(sheet.rows);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  await wb.xlsx.write(res);
  res.end();
}

// Эхний sheet-ийн мөрүүдийг { header: value } объект болгож уншина
export async function readSheetRows(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value ?? '').trim().toLowerCase(); });
  const rows = [];
  ws.eachRow((row, rowNo) => {
    if (rowNo === 1) return;
    const obj = { _row: rowNo };
    row.eachCell((cell, col) => {
      const v = cell.value;
      obj[headers[col]] = v && typeof v === 'object' && 'result' in v ? v.result : (v && typeof v === 'object' && 'text' in v ? v.text : v);
    });
    rows.push(obj);
  });
  return rows;
}
