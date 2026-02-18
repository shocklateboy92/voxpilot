import "./style.css";

interface HealthResponse {
  status: string;
  app_name: string;
}

const API_BASE = window.location.origin;

async function checkHealth(): Promise<void> {
  const el = document.getElementById("status");
  if (!el) return;

  try {
    const response = await fetch(`${API_BASE}/api/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status.toString()}`);
    }
    const data: HealthResponse = await response.json() as HealthResponse;
    el.textContent = `${data.app_name} — status: ${data.status}`;
    el.classList.add("ok");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    el.textContent = `Backend unreachable: ${message}`;
    el.classList.add("error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void checkHealth();
});
