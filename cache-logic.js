export function parseByteRange(rangeHeader, totalBytes) {
  if (
    !Number.isInteger(totalBytes) ||
    totalBytes <= 0 ||
    typeof rangeHeader !== "string" ||
    !rangeHeader.startsWith("bytes=") ||
    rangeHeader.includes(",")
  ) {
    return null;
  }

  const [startText, endText] = rangeHeader.slice(6).split("-", 2);
  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      start: Math.max(0, totalBytes - suffixLength),
      end: totalBytes - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? totalBytes - 1 : Number(endText);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(requestedEnd) ||
    start < 0 ||
    start >= totalBytes ||
    requestedEnd < start
  ) {
    return null;
  }

  return { start, end: Math.min(requestedEnd, totalBytes - 1) };
}

export function cacheMetadataMatches(expected, cached) {
  return (
    Number(cached.bytes) === expected.bytes && cached.sha256 === expected.sha256
  );
}
