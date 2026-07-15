export function findActiveCueIndex(cues, currentTime) {
  let lower = 0;
  let upper = cues.length - 1;
  let candidate = -1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (cues[middle].start <= currentTime) {
      candidate = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  if (candidate === -1 || currentTime >= cues[candidate].end) {
    return -1;
  }
  return candidate;
}
