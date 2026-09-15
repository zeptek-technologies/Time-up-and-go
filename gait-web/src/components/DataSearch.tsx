import { useRef } from "react";

export default function DataSearch({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="data-search">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
      <input ref={inputRef} type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" aria-label={`ล้าง${label}`} onClick={() => { onChange(""); inputRef.current?.focus(); }}>×</button>}
    </div>
  );
}
