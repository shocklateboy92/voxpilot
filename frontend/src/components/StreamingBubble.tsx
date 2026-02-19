/**
 * Streaming assistant bubble — shows the in-progress text with a blinking cursor.
 *
 * Receives text as a prop. Solid compiles this to a direct text node
 * update — the same as hand-written `el.textContent = text`.
 */

interface Props {
  text: string;
}

export function StreamingBubble(props: Props) {
  return <div class="message assistant streaming">{props.text}</div>;
}
