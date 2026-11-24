const appId = "app.noonchi.android";

export function readTwaTarget(setup: unknown): { url: string; origin: string } {
  const value = (setup as { android_twa?: unknown } | null)?.android_twa;
  const addressError = () => new Error("허브의 클로이드 연결 주소를 확인해 주세요.");
  if (!value || typeof value !== "object") throw addressError();
  const target = value as Record<string, unknown>;
  if (target.package_name !== appId) throw new Error("허브에 등록된 Android 앱이 달라요.");
  if (target.statements_configured !== true) throw new Error("허브에 Android 앱 서명을 등록해 주세요.");
  if (typeof target.phone_url !== "string" || typeof target.assetlinks_url !== "string") throw addressError();

  let phone: URL;
  let assetLinks: URL;
  try {
    phone = new URL(target.phone_url);
    assetLinks = new URL(target.assetlinks_url);
  } catch { throw addressError(); }
  if (phone.protocol !== "https:" || phone.pathname !== "/phone/" || phone.username || phone.password || phone.search || phone.hash) {
    throw addressError();
  }
  if (assetLinks.href !== new URL("/.well-known/assetlinks.json", phone.origin).href) throw addressError();
  return { url: phone.href, origin: phone.origin };
}
