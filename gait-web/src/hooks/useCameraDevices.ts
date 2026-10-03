// Lists the machine's video inputs so staff can pick which camera to use
// (a laptop's built-in webcam vs. the tripod camera aimed at the walkway —
// and later, the front/side pair).
import { useCallback, useEffect, useState } from "react";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export function useCameraDevices() {
  const [devices, setDevices] = useState<CameraDevice[]>([]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((d) => d.kind === "videoinput")
          // Browsers withhold `label` until camera permission has been granted
          // at least once, so fall back to a positional name — the list is
          // still usable for picking before the first start.
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `กล้อง ${i + 1}` })),
      );
    } catch {
      // Enumeration can fail on insecure origins; leaving the list empty just
      // hides the picker and the default camera is used.
    }
  }, []);

  useEffect(() => {
    // refresh() sets state only after an await, never synchronously in the
    // effect body; queueing it keeps that explicit for the hooks lint rule.
    queueMicrotask(() => void refresh());
    const md = navigator.mediaDevices;
    // Fires when a camera is plugged in or removed.
    md?.addEventListener?.("devicechange", refresh);
    return () => md?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  return { devices, refresh };
}
