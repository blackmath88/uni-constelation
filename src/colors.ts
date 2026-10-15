// Twenty-one categorical hues, one per cross-faculty subject projection.
// Colour never encodes researcher quality or volume; labels remain the authoritative cue.
export const TOPIC_COLORS = [
  "#2F64D6", "#D2622A", "#1F9473", "#BF3F78", "#7D5BC9", "#A98110",
  "#2E93AE", "#C9443A", "#5A8A2A", "#95593A", "#5E6E9C", "#B86AAE", "#3A4A57",
  "#1769C2", "#C65322", "#16987A", "#C43D73", "#7655D4", "#AD8300", "#2592AB", "#C84137",
];
export const NO_TOPIC = "#9AA3AA";
export function topicColor(topicId: string | null | undefined): string {
  if (!topicId) return NO_TOPIC;
  const i = Number(topicId.slice(1));
  return TOPIC_COLORS[i % TOPIC_COLORS.length];
}
