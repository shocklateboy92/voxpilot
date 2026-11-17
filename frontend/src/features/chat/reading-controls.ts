/** Optional reading-mode capability; state and both transitions travel together. */
export interface ReadingControls {
  readonly reading: boolean;
  expand: () => void;
  /** Return to reading and dismiss composer focus. */
  collapse: () => void;
}
