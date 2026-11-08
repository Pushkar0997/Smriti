import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

export interface ManifestItem {
  relativePath: string;
  type: string;
  sizeBytes: number;
  slideOrPageCount: number | null;
  sha256: string;
  duplicateGroupId: string | null;
  hasTextLayer: boolean | null;
  tier: string;
  include: boolean | null;
}

export interface InventoryResult {
  sourceDirectory: string;
  generatedAt: string;
  totalFiles: number;
  totalSizeBytes: number;
  duplicateGroupsCount: number;
  duplicateFilesCount: number;
  typeBreakdown: Record<string, number>;
  items: ManifestItem[];
}

/**
 * Format bytes to a human-readable string (KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Compute SHA-256 hash of a file buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Inspect a PDF file buffer to extract page count and detect if a text layer exists.
 */
export async function inspectPdf(
  buffer: Buffer
): Promise<{ pageCount: number; hasTextLayer: boolean }> {
  try {
    const doc = await PDFDocument.load(buffer);
    const pageCount = doc.getPageCount();
    let hasTextLayer = false;

    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const rawContents = page.node.Contents();
      if (!rawContents) continue;

      const contentsObj = page.node.context.lookup(rawContents);
      if (!contentsObj) continue;

      const contentsRecord = contentsObj as unknown as { asArray?: () => unknown[] };
      const streams =
        typeof contentsRecord.asArray === "function"
          ? contentsRecord.asArray()
          : [contentsObj];

      for (const s of streams) {
        const stream = page.node.context.lookup(s as Parameters<typeof page.node.context.lookup>[0]) as unknown as {
          getContents?: () => Uint8Array | number[];
        } | null;
        if (!stream || typeof stream.getContents !== "function") continue;

        const raw = Buffer.from(stream.getContents());
        let textContent = "";
        try {
          textContent = zlib.inflateSync(raw).toString("latin1");
        } catch {
          textContent = raw.toString("latin1");
        }

        // Check for PDF text operators: BT (begin text) ... ET (end text) with text rendering Tj/TJ/'/"
        if (/BT[\s\S]*?(?:Tj|TJ|'|")[\s\S]*?ET/.test(textContent)) {
          hasTextLayer = true;
          break;
        }
      }
      if (hasTextLayer) break;
    }

    return { pageCount, hasTextLayer };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[inventory] Warning: Failed to parse PDF: ${msg}`);
    return { pageCount: 0, hasTextLayer: false };
  }
}

/**
 * Inspect a PPTX or DOCX OpenXML archive buffer to extract slide or page count.
 */
export async function inspectOffice(
  buffer: Buffer,
  extension: string
): Promise<{ slideOrPageCount: number | null }> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    if (extension === "pptx") {
      // PPTX: count slide files and cross-check app.xml
      const slideEntries = Object.keys(zip.files).filter((f) =>
        /^ppt\/slides\/slide\d+\.xml$/i.test(f)
      );
      let count = slideEntries.length;

      const appXml = await zip.file("docProps/app.xml")?.async("text");
      if (appXml) {
        const match = /<Slides>(\d+)<\/Slides>/i.exec(appXml);
        if (match) {
          count = parseInt(match[1], 10);
        }
      }
      return { slideOrPageCount: count > 0 ? count : null };
    }

    if (extension === "docx") {
      // DOCX: check app.xml for <Pages>
      const appXml = await zip.file("docProps/app.xml")?.async("text");
      if (appXml) {
        const match = /<Pages>(\d+)<\/Pages>/i.exec(appXml);
        if (match) {
          const pages = parseInt(match[1], 10);
          return { slideOrPageCount: pages > 0 ? pages : null };
        }
      }
      return { slideOrPageCount: null };
    }

    return { slideOrPageCount: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[inventory] Warning: Failed to parse OpenXML archive: ${msg}`);
    return { slideOrPageCount: null };
  }
}

/**
 * Recursively find all files in a directory.
 * Strictly read-only; skips hidden directories and files (starting with dot).
 */
export function collectFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Run inventory on a directory and write local/manifest.json.
 */
export async function runInventory(
  targetDir: string,
  manifestOutputPath: string = path.resolve(process.cwd(), "local", "manifest.json")
): Promise<InventoryResult> {
  const resolvedTarget = path.resolve(targetDir);

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target directory does not exist: ${resolvedTarget}`);
  }

  const stat = fs.statSync(resolvedTarget);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${resolvedTarget}`);
  }

  console.log(`\n=== SMRITI COURSE MATERIAL INVENTORY ===`);
  console.log(`Scanning target directory: ${resolvedTarget}`);

  const allFilePaths = collectFiles(resolvedTarget);
  console.log(`Found ${allFilePaths.length} file(s). Inspecting files...\n`);

  interface IntermediateItem {
    relativePath: string;
    type: string;
    sizeBytes: number;
    slideOrPageCount: number | null;
    sha256: string;
    hasTextLayer: boolean | null;
  }

  const intermediateList: IntermediateItem[] = [];
  const hashMap = new Map<string, string[]>(); // sha256 -> relativePaths[]

  for (const filePath of allFilePaths) {
    const relPath = path.relative(resolvedTarget, filePath).replace(/\\/g, "/");
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, "") || "unknown";
    const fileStat = fs.statSync(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    const sha256 = computeSha256(fileBuffer);

    let slideOrPageCount: number | null = null;
    let hasTextLayer: boolean | null = null;

    if (ext === "pdf") {
      const pdfInfo = await inspectPdf(fileBuffer);
      slideOrPageCount = pdfInfo.pageCount;
      hasTextLayer = pdfInfo.hasTextLayer;
    } else if (ext === "pptx" || ext === "docx") {
      const officeInfo = await inspectOffice(fileBuffer, ext);
      slideOrPageCount = officeInfo.slideOrPageCount;
    }

    // Register hash for duplicate detection
    if (!hashMap.has(sha256)) {
      hashMap.set(sha256, []);
    }
    hashMap.get(sha256)!.push(relPath);

    intermediateList.push({
      relativePath: relPath,
      type: ext,
      sizeBytes: fileStat.size,
      slideOrPageCount,
      sha256,
      hasTextLayer,
    });
  }

  // Assign duplicate group IDs
  const duplicateGroupMap = new Map<string, string>();
  let dupGroupCounter = 1;
  let totalDuplicateFiles = 0;

  for (const [hash, filePaths] of hashMap.entries()) {
    if (filePaths.length > 1) {
      const groupId = `dup-${dupGroupCounter++}`;
      duplicateGroupMap.set(hash, groupId);
      totalDuplicateFiles += filePaths.length;
    }
  }

  // Construct final manifest items
  const items: ManifestItem[] = intermediateList.map((item) => ({
    relativePath: item.relativePath,
    type: item.type,
    sizeBytes: item.sizeBytes,
    slideOrPageCount: item.slideOrPageCount,
    sha256: item.sha256,
    duplicateGroupId: duplicateGroupMap.get(item.sha256) ?? null,
    hasTextLayer: item.hasTextLayer,
    tier: "",
    include: null,
  }));

  // Calculate statistics
  const typeBreakdown: Record<string, number> = {};
  let totalSizeBytes = 0;

  for (const item of items) {
    totalSizeBytes += item.sizeBytes;
    typeBreakdown[item.type] = (typeBreakdown[item.type] ?? 0) + 1;
  }

  const result: InventoryResult = {
    sourceDirectory: resolvedTarget,
    generatedAt: new Date().toISOString(),
    totalFiles: items.length,
    totalSizeBytes,
    duplicateGroupsCount: duplicateGroupMap.size,
    duplicateFilesCount: totalDuplicateFiles,
    typeBreakdown,
    items,
  };

  // Ensure output directory exists (local/)
  const outputDir = path.dirname(manifestOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write manifest.json
  fs.writeFileSync(manifestOutputPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Manifest written to: ${manifestOutputPath}\n`);

  // Print readable table
  printManifestTable(result);

  return result;
}

/**
 * Print a readable summary table to stdout.
 */
export function printManifestTable(result: InventoryResult): void {
  console.log("-------------------------------------------------------------------------------------------------------------------");
  console.log(
    `| ${"#".padEnd(3)} | ${"Relative Path".padEnd(42)} | ${"Type".padEnd(5)} | ${"Size".padEnd(9)} | ${"Pages/Sld".padEnd(9)} | ${"Text Layer?".padEnd(11)} | ${"Dup Group".padEnd(9)} | ${"Tier".padEnd(4)} | ${"Inc".padEnd(3)} |`
  );
  console.log("-------------------------------------------------------------------------------------------------------------------");

  result.items.forEach((item, index) => {
    const idxStr = String(index + 1).padEnd(3);
    const pathStr =
      item.relativePath.length > 42
        ? `...${item.relativePath.slice(-39)}`
        : item.relativePath.padEnd(42);
    const typeStr = item.type.toUpperCase().padEnd(5);
    const sizeStr = formatBytes(item.sizeBytes).padEnd(9);
    const countStr = item.slideOrPageCount !== null ? String(item.slideOrPageCount).padEnd(9) : "-".padEnd(9);
    const textLayerStr =
      item.hasTextLayer === null
        ? "-".padEnd(11)
        : item.hasTextLayer
        ? "Yes".padEnd(11)
        : "No (Image)".padEnd(11);
    const dupStr = (item.duplicateGroupId ?? "-").padEnd(9);
    const tierStr = (item.tier || "-").padEnd(4);
    const incStr = item.include !== null ? String(item.include).padEnd(3) : "-".padEnd(3);

    console.log(
      `| ${idxStr} | ${pathStr} | ${typeStr} | ${sizeStr} | ${countStr} | ${textLayerStr} | ${dupStr} | ${tierStr} | ${incStr} |`
    );
  });

  console.log("-------------------------------------------------------------------------------------------------------------------");
  console.log(`\nSummary:`);
  console.log(`- Total Files: ${result.totalFiles}`);
  console.log(`- Total Size: ${formatBytes(result.totalSizeBytes)}`);
  console.log(`- Duplicate Sets: ${result.duplicateGroupsCount} (${result.duplicateFilesCount} files affected)`);
  console.log(`- Types:`, Object.entries(result.typeBreakdown).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(", "));
  console.log("");
}

// CLI entrypoint if executed directly
if (process.argv[1] && process.argv[1].endsWith("inventory.ts")) {
  const targetArg = process.argv[2];
  if (!targetArg) {
    console.error("Usage: npm run inventory -- <folder-path>");
    console.error("Example: npm run inventory -- ./local/course_files");
    process.exit(1);
  }

  runInventory(targetArg).catch((err) => {
    console.error(`[inventory] Error: ${err.message}`);
    process.exit(1);
  });
}

