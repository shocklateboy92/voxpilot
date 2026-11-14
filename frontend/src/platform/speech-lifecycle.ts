const jobs = new Set<() => void>();
let generation = 0;
export const speechBackendGeneration = () => generation;
export function registerSpeechJob(cancel: () => void) {
  jobs.add(cancel);
  return () => jobs.delete(cancel);
}
export function abortSpeechJobs() {
  generation += 1;
  for (const cancel of jobs) cancel();
}
window.addEventListener("pagehide", abortSpeechJobs);
if (import.meta.hot) import.meta.hot.dispose(abortSpeechJobs);
