// 21st.dev「Mobile Navigation Tabs」(id 27897, shadcnui-blocks/tabs-08) 받은 코드.
// 바꾼 것: component 14371의 아이콘·이름 세로 배열과 밑줄을 유지하고, 세 페이지는 aria-current가 있는 링크로 만든다. 하단 고정과 safe area를 적용했다.
import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "./button";
import "./mobile-navigation-tabs.css";

type NavigationTab<T> = { id: T; label: string; href: string; icon: LucideIcon };

export function MobileNavigationTabs<T extends string>({ label, tabs, active, onTab }: {
  label: string;
  tabs: readonly NavigationTab<T>[];
  active: T;
  onTab?: (tab: T) => void;
}) {
  function select(event: MouseEvent<HTMLAnchorElement>, tab: T) {
    if (!onTab || event.defaultPrevented || event.button !== 0 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    event.preventDefault();
    onTab(tab);
  }

  return (
    <nav aria-label={label} className="phone-portal-nav">
      <ul role="list" className="phone-portal-nav__items">
        {tabs.map(({ id, label, href, icon: Icon }) => (
          <li key={id}>
            <Button asChild variant="ghost" size="sm" className="phone-portal-nav__link">
              <a href={href} aria-current={id === active ? "page" : undefined} onClick={event => select(event, id)}>
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
