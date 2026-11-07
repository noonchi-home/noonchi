// 21st.dev「Chain of Thought」(id 28391, nexus-ui/chain-of-thought) 받은 코드.
// 바꾼 것: 받은 꾸러미에 빠진 의존 도우미 useOnChange를 받은 코드가 부르는 이름·모양대로 채웠다(화면에 보이는 것 없음). 값이 바뀔 때마다 (지금 값, 앞 값)으로 부르고, 처음에는 앞 값이 undefined다.
import { useEffect, useRef } from "react";

export function useOnChange<T>(value: T, onChange: (current: T, previous: T | undefined) => void) {
  const previous = useRef<T | undefined>(undefined);
  const handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    const before = previous.current;
    previous.current = value;
    handler.current(value, before);
  }, [value]);
}
