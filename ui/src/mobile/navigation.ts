import { isHouseAddress, matchesHouse } from "./house";

export type RegisteredTab = "home" | "house" | "scan";
export type AddressDraft = { query: string; addressPicked: boolean; review: boolean };
const draftKey = "noonchi-mobile-address";

export function requestedTab(): RegisteredTab | null {
  const value = new URLSearchParams(location.search).get("tab");
  return value === "home" || value === "house" || value === "scan" ? value : null;
}

export function readAddressDraft(): AddressDraft {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as AddressDraft | null;
    if (draft && typeof draft.query === "string") {
      return { query: draft.query, addressPicked: draft.addressPicked === true, review: draft.review === true };
    }
  } catch { /* This tab can still use the form in memory. */ }
  return { query: "", addressPicked: false, review: false };
}

export function rememberAddressDraft(draft: AddressDraft) {
  // Preserve this building's search and review across the settings page.
  const supported = draft.addressPicked ? isHouseAddress(draft.query) : matchesHouse(draft.query);
  try {
    if (supported) sessionStorage.setItem(draftKey, JSON.stringify(draft));
    else sessionStorage.removeItem(draftKey);
  } catch { /* This tab can still use the form in memory. */ }
}

const launchKey = "noonchi-mobile-launched";

export function firstMobileLaunch() {
  try { return sessionStorage.getItem(launchKey) !== "1"; } catch { return false; }
}

export function markMobileLaunched() {
  try { sessionStorage.setItem(launchKey, "1"); } catch { /* Ignore disabled storage. */ }
}
