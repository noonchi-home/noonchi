import { useEffect, useState, useSyncExternalStore } from "react";
import { createPhoneController, type PhoneController } from "./controller";

const noSubscription = () => () => {};
const noView = () => null;

export function usePhonePortal(enabled: boolean) {
  const [controller, setController] = useState<PhoneController | null>(null);
  useEffect(() => {
    if (!enabled) { setController(null); return; }
    const { protocol, host } = window.location;
    const phone = createPhoneController({ portal: true, location: { protocol, host, search: "" } });
    const stop = () => phone.stopAr();
    window.addEventListener("pagehide", stop);
    window.addEventListener("popstate", stop);
    setController(phone);
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("popstate", stop);
      phone.close();
    };
  }, [enabled]);
  const phone = enabled ? controller : null;
  const view = useSyncExternalStore(phone?.subscribe ?? noSubscription, phone?.view ?? noView);
  return { phone, view };
}
