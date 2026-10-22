"use client";
import { Printer } from "lucide-react";

// Browser print of the current report; the print stylesheet keeps only the report.
export function PrintButton() {
  return <button type="button" className="btn-secondary" onClick={() => window.print()}><Printer aria-hidden size={18} />Imprimir</button>;
}
