import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback: (retry: () => void) => ReactNode };
type State = { failed: boolean };

/** 화면을 그리다 오류가 나면 앱을 끄지 않고 fallback을 보여 준다. retry는 같은 화면을 처음부터 다시 그린다. */
export class ScreenBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
