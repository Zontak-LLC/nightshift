/**
 * Following one growing log file. Work is in BYTES until a line is complete: a read can end in the middle of a
 * multibyte character (an emoji, "€"), so text is decoded only once its whole line has arrived.
 */
export type TailState = {
  /** Bytes of the file already read. */
  offset: number;
  /** The start of a line whose end has not been written yet. */
  partial: Buffer;
  /** Started in the middle of the file: everything up to the first line break is a cut line and is dropped. */
  skipping: boolean;
};

export const START: TailState = { offset: 0, partial: Buffer.alloc(0), skipping: false };

/** A line longer than this with no end in sight is dropped (the parser refuses such lines anyway). */
const MAX_PARTIAL = 4_000_000;

/** Adds the bytes read from `state.offset` and returns the complete lines they finished. */
export function advance(state: TailState, chunk: Buffer): { state: TailState; lines: string[] } {
  const offset = state.offset + chunk.length;
  let bytes = state.partial.length ? Buffer.concat([state.partial, chunk]) : chunk;
  let skipping = state.skipping;
  if (skipping) {
    const end = bytes.indexOf(0x0a);
    if (end === -1) return { state: { offset, partial: Buffer.alloc(0), skipping }, lines: [] };
    bytes = bytes.subarray(end + 1);
    skipping = false;
  }
  const cut = bytes.lastIndexOf(0x0a);
  if (cut === -1) {
    const partial = bytes.length > MAX_PARTIAL ? Buffer.alloc(0) : Buffer.from(bytes);
    return { state: { offset, partial, skipping: bytes.length > MAX_PARTIAL }, lines: [] };
  }
  const lines = bytes
    .subarray(0, cut)
    .toString("utf8")
    .split("\n")
    .filter((l) => l.trim());
  return { state: { offset, partial: Buffer.from(bytes.subarray(cut + 1)), skipping }, lines };
}

/** Where to start a file seen for the first time: `from`, dropping the cut line when that is not the file's start. */
export function startAt(from: number): TailState {
  // One byte early: when that byte is the line break before `from`, only it is dropped and no whole line is lost.
  return from <= 0 ? START : { offset: from - 1, partial: Buffer.alloc(0), skipping: true };
}
