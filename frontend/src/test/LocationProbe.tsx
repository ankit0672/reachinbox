import { useLocation } from "react-router";

/** Exposes the router's current URL to tests as data-testid="location". */
export function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="location" hidden>
      {`${pathname}${search}`}
    </output>
  );
}
