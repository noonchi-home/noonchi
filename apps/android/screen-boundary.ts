import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback: (retry: () => void) => ReactNode;
  /** 잡은 오류를 넘겨받는다(허브 보고). 여기서 던져도 경계 밖으로 나가지 않는다. */
  onError?: (error: unknown, componentStack: string | null) => void;
};
type State = { failed: boolean };

/** 화면을 그리다 오류가 나면 앱을 끄지 않고 fallback을 보여 준다. retry는 같은 화면을 처음부터 다시 그린다. */
export class ScreenBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: Partial<ErrorInfo>) {
    const componentStack = info.componentStack ?? null;
    console.error("ScreenBoundary caught a render error", error, componentStack);
    try {
      this.props.onError?.(error, componentStack);
    } catch {
      // 보고가 실패해도 fallback은 이미 떠 있다. 여기서 다시 던지면 앱이 꺼진다.
    }
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
