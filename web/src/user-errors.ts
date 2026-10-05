/** Keep engineering diagnostics out of the UI while preserving actionable errors verbatim. */
export function userErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /(?:geometry|mesh|model insert|final terrain|overlay|preset overlay) packet|metadata is inconsistent|batches are out of order/i.test(
      message,
    )
  )
    return 'Something went wrong while building the model. Your design is unchanged—try again.';
  if (
    /did not produce a valid solid|solid geometry is invalid|not watertight|degenerate triangles/i.test(
      message,
    )
  )
    return 'Some selected details could not be combined into a printable model. Try disabling the most recently added feature.';
  if (/3MF|Bambu Studio project metadata|PrusaSlicer project metadata/i.test(message))
    return 'We could not create a valid slicer project. Try the export again.';
  if (/Data service returned \d+|catalog query failed/i.test(message))
    return 'Terrain data is temporarily unavailable. Try again in a few minutes—your current design is safe.';
  if (/More than 16 raster assets|2 million sample browser limit/i.test(message))
    return 'This area is too large at the selected detail level. Choose a smaller area or lower the terrain detail.';
  const annotation = message.match(/^Annotation (.+) could not form a solid/i);
  if (annotation)
    return `The “${annotation[1]}” label cannot be added here. Move it or make it larger.`;
  return message;
}
