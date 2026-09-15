interface Props {
  label: string;
  total: number;
  start: number;
  end: number;
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({ label, total, start, end, page, pageCount, pageSize, onPageChange, onPageSizeChange }: Props) {
  return (
    <nav className="data-pagination" aria-label={`แบ่งหน้า${label}`}>
      <span className="data-pagination__range" role="status" aria-live="polite">
        {total ? `${start}-${end} จาก ${total} รายการ` : "0 รายการ"}
      </span>
      <label className="data-pagination__size">
        <span>ต่อหน้า</span>
        <select aria-label={`จำนวน${label}ต่อหน้า`} value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
          {[5, 10, 20].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <div className="data-pagination__steps">
        <button type="button" aria-label={`${label}หน้าก่อนหน้า`} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>←</button>
        <span>หน้า <strong>{page}</strong> / {pageCount}</span>
        <button type="button" aria-label={`${label}หน้าถัดไป`} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>→</button>
      </div>
    </nav>
  );
}
