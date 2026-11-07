/**
 * Legacy chunkText implementation — preserved verbatim from the pre-03b version
 * for equivalence testing only. Never imported in production code.
 */

import { CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS, type ChunkItem } from "../lib/ingest";

export async function chunkTextLegacy(
  text: string,
  countTokensFn: (text: string) => Promise<number>
): Promise<ChunkItem[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: ChunkItem[] = [];
  const tokenCache = new Map<string, number>();

  async function getTokens(str: string): Promise<number> {
    const trimmed = str.trim();
    if (!trimmed) return 0;
    if (tokenCache.has(str)) {
      return tokenCache.get(str)!;
    }
    const count = await countTokensFn(str);
    tokenCache.set(str, count);
    return count;
  }

  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: { index: number; title: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    headings.push({
      index: match.index,
      title: match[2].trim(),
    });
  }

  function getNearestHeading(charIndex: number, chunkNumber: number): string {
    let nearest: string | null = null;
    for (const h of headings) {
      if (h.index <= charIndex) {
        nearest = h.title;
      } else {
        break;
      }
    }
    return nearest || `chunk ${chunkNumber}`;
  }

  let startIndex = 0;
  let chunkIndex = 1;

  while (startIndex < text.length) {
    const remainingText = text.slice(startIndex);
    if (remainingText.trim().length === 0) {
      break;
    }

    const remainingTokens = await getTokens(remainingText);
    if (remainingTokens <= CHUNK_SIZE_TOKENS) {
      chunks.push({
        content: remainingText.trim(),
        sectionLabel: getNearestHeading(startIndex, chunkIndex),
        tokenCount: remainingTokens,
      });
      break;
    }

    let low = 1;
    let high = remainingText.length;
    let bestFitEnd = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = remainingText.slice(0, mid);
      const tokens = await getTokens(slice);

      if (tokens <= CHUNK_SIZE_TOKENS) {
        bestFitEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const candidateSlice = remainingText.slice(0, bestFitEnd);
    const lastParagraphBreak = candidateSlice.lastIndexOf("\n\n");

    let chosenEnd = bestFitEnd;
    if (lastParagraphBreak > 0) {
      const paraSlice = candidateSlice.slice(0, lastParagraphBreak).trimEnd();
      const paraTokens = await getTokens(paraSlice);
      if (paraTokens >= 50) {
        chosenEnd = lastParagraphBreak;
      }
    }

    if (chosenEnd === bestFitEnd) {
      const lastSentenceBreak = Math.max(
        candidateSlice.lastIndexOf(". "),
        candidateSlice.lastIndexOf("? "),
        candidateSlice.lastIndexOf("! "),
        candidateSlice.lastIndexOf("\n")
      );
      if (lastSentenceBreak > candidateSlice.length * 0.5) {
        chosenEnd = lastSentenceBreak + 1;
      } else {
        const lastSpace = candidateSlice.lastIndexOf(" ");
        if (lastSpace > 0) {
          chosenEnd = lastSpace;
        }
      }
    }

    const chunkContent = remainingText.slice(0, chosenEnd).trim();
    const chunkTokens = await getTokens(chunkContent);

    chunks.push({
      content: chunkContent,
      sectionLabel: getNearestHeading(startIndex, chunkIndex),
      tokenCount: chunkTokens,
    });
    chunkIndex++;

    const chunkAbsEnd = startIndex + chosenEnd;

    let overlapLow = 1;
    let overlapHigh = chunkContent.length;
    let bestOverlapLen = 0;

    while (overlapLow <= overlapHigh) {
      const mid = Math.floor((overlapLow + overlapHigh) / 2);
      const suffix = chunkContent.slice(chunkContent.length - mid);
      const tokens = await getTokens(suffix);

      if (tokens <= CHUNK_OVERLAP_TOKENS) {
        bestOverlapLen = mid;
        overlapLow = mid + 1;
      } else {
        overlapHigh = mid - 1;
      }
    }

    let nextStart = chunkAbsEnd - bestOverlapLen;
    if (bestOverlapLen > 0 && nextStart < chunkAbsEnd) {
      const spaceIdx = text.indexOf(" ", nextStart);
      if (spaceIdx !== -1 && spaceIdx < chunkAbsEnd) {
        nextStart = spaceIdx + 1;
      }
    }

    if (nextStart <= startIndex || nextStart >= chunkAbsEnd) {
      nextStart = chunkAbsEnd;
    }

    startIndex = nextStart;
  }

  return chunks;
}

