const ports = { racing: 5173, esports: 5174, dashboard: 5175 };
/** Set public app URLs when deploying the demos to separate origins. */
export function appUrl(app: keyof typeof ports, path = "") {
  const configured = import.meta.env[`VITE_${app.toUpperCase()}_APP_URL`] as
    string | undefined;
  const base =
    configured ??
    `http://${window.location.hostname || "127.0.0.1"}:${ports[app]}`;
  return `${base.replace(/\/$/, "")}${path}`;
}
