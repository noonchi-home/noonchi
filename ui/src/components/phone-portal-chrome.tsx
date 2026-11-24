import { House, Map, Settings } from "lucide-react";
import { useEffect, useEffectEvent } from "react";
import { SimpleNavbar } from "./ui/header-navbar";
import { MobileNavigationTabs } from "./ui/mobile-navigation-tabs";
import "./phone-portal-chrome.css";

const wordmark = `${import.meta.env.BASE_URL}brand/noonchi-wordmark.svg`;
const mascot = `${import.meta.env.BASE_URL}brand/mascot-large.webp`;

const tabs = [
  { id: "home", label: "홈", href: "/mobile/?tab=home", icon: House },
  { id: "scan", label: "집 관리", href: "/mobile/?tab=house", icon: Map },
  { id: "settings", label: "설정", href: "/mobile/settings/", icon: Settings },
] as const;

export type PhonePortalTab = (typeof tabs)[number]["id"];

type PhonePortalNavProps = {
  active: PhonePortalTab;
  onTab?: (tab: PhonePortalTab) => void;
};

export function PhonePortalNav({ active, onTab }: PhonePortalNavProps) {
  return <MobileNavigationTabs label="폰 메뉴" tabs={tabs} active={active} onTab={onTab} />;
}

export function NoonchiWordmark() {
  return <img className="noonchi-wordmark" src={wordmark} alt="NOONCHI" width={2130} height={374} />;
}

export function PhonePortalHeader({ label }: { label?: string } = {}) {
  return (
    <header className={label ? "phone-portal-header" : "phone-portal-header phone-portal-header--centered"}>
      <SimpleNavbar title={<NoonchiWordmark />} label={label} />
    </header>
  );
}

export function PhoneHomePeek({ registered = false }: { registered?: boolean } = {}) {
  if (registered) return (
    <div className="phone-home-peek phone-home-peek--registered" aria-hidden="true">
      <div className="phone-home-peek__crop">
        <img src={mascot} alt="" width={618} height={1080} />
      </div>
    </div>
  );
  return (
    <div className="phone-home-peek" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}brand/face-peek.webp`} alt="" width={768} height={252} />
    </div>
  );
}

export function PhoneLaunchHero({ onDone }: { onDone: () => void }) {
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    const timer = window.setTimeout(() => finish(), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="phone-launch-hero">
      <div className="phone-launch-hero__stage">
        <div className="phone-launch-hero__logo"><NoonchiWordmark /></div>
        <img className="phone-launch-hero__mascot" src={mascot}
          alt="" width={618} height={1080} fetchPriority="high" />
      </div>
    </div>
  );
}
