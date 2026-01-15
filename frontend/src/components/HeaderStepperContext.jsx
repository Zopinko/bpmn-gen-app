import { createContext, useContext, useMemo, useState } from "react";

const HeaderStepperContext = createContext({
  state: null,
  setState: () => {},
});

export function HeaderStepperProvider({ children }) {
  const [state, setState] = useState(null);
  const value = useMemo(() => ({ state, setState }), [state]);
  return <HeaderStepperContext.Provider value={value}>{children}</HeaderStepperContext.Provider>;
}

export function useHeaderStepper() {
  return useContext(HeaderStepperContext);
}
