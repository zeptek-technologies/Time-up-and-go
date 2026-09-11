import { useState } from "react";
import { paginate } from "../lib/pagination";

export function usePagination<T>(items: readonly T[], filterKey: string) {
  const [state, setState] = useState({ key: filterKey, page: 1, size: 5 });
  const result = paginate(items, state.key === filterKey ? state.page : 1, state.size);
  // Reset on changed filters and permanently clamp after realtime removal.
  if (state.key !== filterKey || state.page !== result.page) {
    setState({ ...state, key: filterKey, page: result.page });
  }
  return { ...result,
    onPageChange: (page: number) => { setState({ ...state, page }); },
    onPageSizeChange: (size: number) => { setState({ ...state, page: 1, size }); },
  };
}
