// TEMPORARY debug helper for manually QA-ing extraction quality.
// Delete this file (and its two call sites in extractor.js) once testing
// is done — it is not meant to ship.

export function logExtractionResult(result) {
  const { text, extractionMethod, length } = result;

  console.table([
    {
      domain: window.location.hostname,
      extractionMethod,
      textLength: length,
      first200: text.slice(0, 200),
      last200: text.slice(-200),
    },
  ]);
}
