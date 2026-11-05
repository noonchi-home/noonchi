// Chain of Thought(21st.dev id 28391)가 쓰는 도우미. 값이 바뀔 때마다 (지금 값, 앞 값)으로 부른다. 처음에는 앞 값이 undefined다.
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
