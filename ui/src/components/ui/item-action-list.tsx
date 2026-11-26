// 21st.dev「Item Action List」(id 28284, sean0205/item-action-list) 받은 코드.
// 바꾼 것: component 14671의 ItemMedia·ItemContent·ItemActions를 써서 실제 값을 한 줄에 놓고, 단추 대신 행 전체를 링크로 열게 한다.
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./item";
import "./item-action-list.css";

type ActionItem = { href: string; title: string; value?: string; icon: LucideIcon };

export function ItemActionList({ label, items }: { label: string; items: readonly ActionItem[] }) {
  const listId = useId();

  return (
    <nav aria-label={label}>
      <ul role="list" className="item-action-list">
        {items.map(({ href, title, value, icon: Icon }, index) => {
          const titleId = `${listId}-title-${index}`;
          const valueId = value ? `${listId}-value-${index}` : undefined;
          return (
            <li key={href}>
              <Item asChild size="sm" className="item-action-list__row">
                <a href={href} aria-labelledby={titleId} aria-describedby={valueId}>
                  <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
                  <ItemContent><ItemTitle id={titleId}>{title}</ItemTitle></ItemContent>
                  <ItemActions>
                    {value && <ItemDescription id={valueId}>{value}</ItemDescription>}
                    <ChevronRight size={16} aria-hidden="true" />
                  </ItemActions>
                </a>
              </Item>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
