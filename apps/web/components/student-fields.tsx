"use client";
export function Input({ label, name, defaultValue = "", type = "text", required = true, maxLength = 80 }: { label: string; name: string; defaultValue?: string; type?: string; required?: boolean; maxLength?: number }) {
  return <label className="block text-sm font-semibold">{label}<input className="field mt-1 w-full" name={name} type={type} required={required} maxLength={maxLength} defaultValue={defaultValue} /></label>;
}
