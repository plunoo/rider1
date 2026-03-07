import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export function exportToExcel<T extends object>(rows: T[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([out], { type: "application/octet-stream" }), `${filename}.xlsx`);
}
