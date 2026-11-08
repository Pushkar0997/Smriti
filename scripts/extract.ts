import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { getGeminiClient, GENERATION_MODEL } from "../lib/gemini";

export type DocType = "QB" | "Slides" | "Notes" | "Assignment" | "Worked";

export interface PlanItem {
  path: string;
  include: boolean;
  docType: DocType;
  title: string;
}

export interface FileReport {
  path: string;
  outputPath: string;
  docType: DocType;
  title: string;
  status: "extracted" | "skipped" | "failed";
  chars: number;
  pages: number;
  nearEmptyPages: number[];
  ocrUsed: boolean;
  warnings: string[];
  error?: string;
}

export interface ExtractionReport {
  generatedAt: string;
  sourceRoot: string;
  totalPlanned: number;
  included: number;
  extracted: number;
  skipped: number;
  failed: number;
  files: FileReport[];
}

export interface ExtractOptions {
  sourceRoot: string;
  planPath?: string;
  outputDir?: string;
  reportPath?: string;
  force?: boolean;
}

/**
 * Decode XML entities to plain text characters.
 */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Clean whitespace without altering verbatim wording.
 */
function cleanParagraphText(raw: string): string {
  return decodeXmlEntities(raw)
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Extract text per page from a text-layer PDF using official pdfjs-dist legacy build.
 */
export async function extractTextPdf(
  buffer: Buffer
): Promise<{ pages: Array<{ pageNum: number; text: string }>; totalChars: number }> {
  const pdfjsPath = pathToFileURL(
    path.resolve(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")
  ).href;
  const pdfjsLib = await import(pdfjsPath);

  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  const pages: Array<{ pageNum: number; text: string }> = [];
  let totalChars = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items || [];

    // Group items by vertical position (Y coordinate) to preserve line breaks
    const linesMap = new Map<number, string[]>();
    for (const item of items) {
      if ("str" in item && item.str) {
        const y = Math.round(item.transform?.[5] ?? 0);
        if (!linesMap.has(y)) {
          linesMap.set(y, []);
        }
        linesMap.get(y)!.push(item.str);
      }
    }

    // Sort lines from top of page to bottom (descending Y)
    const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
    const lines = sortedY.map((y) => linesMap.get(y)!.join(" ").trim()).filter(Boolean);

    const pageText = lines.join("\n").trim();
    totalChars += pageText.length;
    pages.push({ pageNum: i, text: pageText });
  }

  return { pages, totalChars };
}

/**
 * Extract verbatim slide titles and body text from PPTX OpenXML archive.
 */
export async function extractPptx(
  buffer: Buffer
): Promise<{ slides: Array<{ slideNum: number; title: string; text: string }>; totalChars: number }> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)![1], 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)![1], 10);
      return numA - numB;
    });

  const slides: Array<{ slideNum: number; title: string; text: string }> = [];
  let totalChars = 0;

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.file(slideFiles[i])!.async("text");

    let slideTitle = "";
    const shapeRegex = /<p:sp>([\s\S]*?)<\/p:sp>/g;
    let shapeMatch;
    const bodyParagraphs: string[] = [];

    while ((shapeMatch = shapeRegex.exec(slideXml)) !== null) {
      const shapeContent = shapeMatch[1];
      const isTitleShape = /<p:ph[^>]*type="(?:title|ctrTitle)"/i.test(shapeContent);

      const paraRegex = /<a:p>([\s\S]*?)<\/a:p>/g;
      let paraMatch;
      const shapeParas: string[] = [];

      while ((paraMatch = paraRegex.exec(shapeContent)) !== null) {
        const textRegex = /<a:t(?:[^>]*)>([\s\S]*?)<\/a:t>/g;
        let tMatch;
        let pText = "";
        while ((tMatch = textRegex.exec(paraMatch[1])) !== null) {
          pText += tMatch[1];
        }
        const cleaned = cleanParagraphText(pText);
        if (cleaned) {
          shapeParas.push(cleaned);
        }
      }

      if (isTitleShape && shapeParas.length > 0 && !slideTitle) {
        slideTitle = shapeParas.join(" ");
      } else if (shapeParas.length > 0) {
        bodyParagraphs.push(...shapeParas);
      }
    }

    const slideBody = bodyParagraphs.join("\n\n");
    totalChars += (slideTitle.length + slideBody.length);
    slides.push({
      slideNum: i + 1,
      title: slideTitle,
      text: slideBody,
    });
  }

  return { slides, totalChars };
}

/**
 * Extract verbatim sections, heading levels, and tables from DOCX OpenXML archive.
 */
export async function extractDocx(
  buffer: Buffer
): Promise<{ text: string; pagesEstimate: number; totalChars: number }> {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file("word/document.xml")?.async("text");

  if (!docXml) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }

  // Check app.xml for page estimate if available
  let pagesEstimate = 1;
  const appXml = await zip.file("docProps/app.xml")?.async("text");
  if (appXml) {
    const match = /<Pages>(\d+)<\/Pages>/i.exec(appXml);
    if (match) {
      pagesEstimate = Math.max(1, parseInt(match[1], 10));
    }
  }

  // Iterate over paragraphs <w:p> and tables <w:tbl> in document order
  const elementRegex = /<(w:p|w:tbl)(?:[\s>])([\s\S]*?)<\/\1>/g;
  let elemMatch;
  const outputBlocks: string[] = [];

  while ((elemMatch = elementRegex.exec(docXml)) !== null) {
    const tag = elemMatch[1];
    const content = elemMatch[2];

    if (tag === "w:p") {
      // Check paragraph style
      const styleMatch = /<w:pStyle\s+w:val="([^"]+)"/i.exec(content);
      const style = styleMatch ? styleMatch[1].toLowerCase() : "";

      // Extract text runs
      const textRegex = /<w:t(?:[^>]*)>([\s\S]*?)<\/w:t>/g;
      let tMatch;
      let pText = "";
      while ((tMatch = textRegex.exec(content)) !== null) {
        pText += tMatch[1];
      }

      const cleaned = cleanParagraphText(pText);
      if (!cleaned) continue;

      if (style.includes("heading1") || style === "heading 1" || style === "title") {
        outputBlocks.push(`## ${cleaned}`);
      } else if (style.includes("heading2") || style === "heading 2") {
        outputBlocks.push(`### ${cleaned}`);
      } else if (style.includes("heading3") || style === "heading 3") {
        outputBlocks.push(`#### ${cleaned}`);
      } else {
        outputBlocks.push(cleaned);
      }
    } else if (tag === "w:tbl") {
      // Parse table rows <w:tr> and cells <w:tc>
      const rowRegex = /<w:tr(?:[\s>])([\s\S]*?)<\/w:tr>/g;
      let rowMatch;
      const rows: string[][] = [];

      while ((rowMatch = rowRegex.exec(content)) !== null) {
        const rowContent = rowMatch[1];
        const cellRegex = /<w:tc(?:[\s>])([\s\S]*?)<\/w:tc>/g;
        let cellMatch;
        const cells: string[] = [];

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const cellContent = cellMatch[1];
          const textRegex = /<w:t(?:[^>]*)>([\s\S]*?)<\/w:t>/g;
          let tMatch;
          let cText = "";
          while ((tMatch = textRegex.exec(cellContent)) !== null) {
            cText += tMatch[1];
          }
          cells.push(cleanParagraphText(cText).replace(/\|/g, "\\|"));
        }

        if (cells.some((c) => c.length > 0)) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        const colCount = Math.max(...rows.map((r) => r.length));
        const paddedRows = rows.map((r) => {
          while (r.length < colCount) r.push("");
          return r;
        });

        // Markdown table header
        const headerRow = `| ${paddedRows[0].join(" | ")} |`;
        const separatorRow = `| ${paddedRows[0].map(() => "---").join(" | ")} |`;
        const bodyRows = paddedRows.slice(1).map((r) => `| ${r.join(" | ")} |`);

        outputBlocks.push([headerRow, separatorRow, ...bodyRows].join("\n"));
      }
    }
  }

  const fullText = outputBlocks.join("\n\n").trim();
  return { text: fullText, pagesEstimate, totalChars: fullText.length };
}

/**
 * Gemini Vision OCR Prompt per specification
 */
export const VISION_OCR_SYSTEM_PROMPT = `You are a high-fidelity verbatim OCR engine transcribing academic study material (lecture notes, exam question papers, worked problem solutions, and slides).
Your goal is strictly literal transcription.

Rules:
1. Transcribe all text verbatim exactly as written. Do not correct typos, spelling mistakes, or grammatical errors in the source material.
2. Render tables as standard Markdown tables.
3. For figures, graphs, illustrations, or architectural diagrams that cannot be represented as text, write '[diagram: <brief 2-5 word description>]' (e.g. '[diagram: Gantt chart]', '[diagram: PCB state transition]').
4. If any word or equation is completely unreadable or cut off, write '[illegible]'.
5. Do NOT solve, answer, elaborate, summarize, or explain anything. Output only the verbatim transcription of what is on the page.
6. If the document has multiple pages, demarcate each page with '## Page N' followed by its transcribed content. If single page, start with '## Page 1'.`;

/**
 * Call Gemini Vision OCR with rate-limit backoff on 429s.
 */
export async function runGeminiVisionOcr(
  buffer: Buffer,
  mimeType: string,
  maxRetries: number = 4
): Promise<string> {
  const client = getGeminiClient();
  const base64Data = buffer.toString("base64");

  let delayMs = 3000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: GENERATION_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: "Transcribe the contents of this document verbatim following the system rules.",
              },
            ],
          },
        ],
        config: {
          systemInstruction: VISION_OCR_SYSTEM_PROMPT,
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini Vision OCR returned empty response text.");
      }
      return text;
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
      const status = typeof errObj?.status === "number" ? errObj.status : null;
      const message = typeof errObj?.message === "string" ? errObj.message : String(err);
      const is429 =
        status === 429 ||
        message.includes("429") ||
        message.includes("RESOURCE_EXHAUSTED");

      if (is429 && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 500);
        console.warn(
          `[extract] Rate limit (429) encountered. Retrying in ${delayMs + jitter}ms (attempt ${attempt}/${maxRetries})...`
        );
        await new Promise((res) => setTimeout(res, delayMs + jitter));
        delayMs *= 2;
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Gemini Vision OCR failed after ${maxRetries} retries.`);
}

/**
 * Determine warnings for an extraction result.
 */
export function computeWarnings(
  text: string,
  pageCount: number,
  nearEmptyPages: number[]
): string[] {
  const warnings: string[] = [];

  if (nearEmptyPages.length > 0) {
    warnings.push(`Contains ${nearEmptyPages.length} near-empty page(s): [${nearEmptyPages.join(", ")}]`);
  }

  const avgChars = pageCount > 0 ? text.length / pageCount : text.length;
  if (avgChars < 100) {
    warnings.push(`Very low text density (average ${Math.round(avgChars)} chars/page)`);
  }

  // Non-alphanumeric ratio check
  const nonWhitespace = text.replace(/\s+/g, "");
  if (nonWhitespace.length > 0) {
    const nonAlphaNum = nonWhitespace.replace(/[a-zA-Z0-9]/g, "");
    const ratio = nonAlphaNum.length / nonWhitespace.length;
    if (ratio > 0.35) {
      warnings.push(`High non-alphanumeric ratio (${(ratio * 100).toFixed(1)}%)`);
    }
  }

  return warnings;
}

/**
 * Main execution function: processes plan.json and extracts verbatim markdown.
 */
export async function runExtraction(options: ExtractOptions): Promise<ExtractionReport> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const planPath = options.planPath || path.resolve(process.cwd(), "local", "plan.json");
  const outputDir = options.outputDir || path.resolve(process.cwd(), "local", "extracted");
  const reportPath = options.reportPath || path.resolve(process.cwd(), "local", "extraction_report.json");
  const force = !!options.force;

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source root directory does not exist: ${sourceRoot}`);
  }
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file does not exist: ${planPath}`);
  }

  const planRaw = fs.readFileSync(planPath, "utf-8");
  const planItems: PlanItem[] = JSON.parse(planRaw);

  const includedItems = planItems.filter((item) => item.include === true);
  console.log(`\n=== SMRITI EXTRACTION PIPELINE (M1-CONTENT-02a) ===`);
  console.log(`Source root: ${sourceRoot}`);
  console.log(`Plan file: ${planPath}`);
  console.log(`Total items in plan: ${planItems.length} (Included: ${includedItems.length})`);
  console.log(`Output directory: ${outputDir}\n`);

  fs.mkdirSync(outputDir, { recursive: true });

  const fileReports: FileReport[] = [];
  let extractedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let idx = 0; idx < includedItems.length; idx++) {
    const item = includedItems[idx];
    const sourceFilePath = path.join(sourceRoot, item.path);
    const targetRelative = item.path.replace(/\.[^/.]+$/, "") + ".md";
    const targetOutputPath = path.join(outputDir, targetRelative);

    console.log(`[extract] [${idx + 1}/${includedItems.length}] Processing: ${item.path}`);

    // Idempotency: skip if already exists and !force
    if (fs.existsSync(targetOutputPath) && !force) {
      console.log(`  -> Skipped (already extracted: ${targetRelative})`);
      const existingContent = fs.readFileSync(targetOutputPath, "utf-8");
      skippedCount++;
      fileReports.push({
        path: item.path,
        outputPath: targetRelative,
        docType: item.docType,
        title: item.title,
        status: "skipped",
        chars: existingContent.length,
        pages: 1,
        nearEmptyPages: [],
        ocrUsed: false,
        warnings: ["Skipped: output file already exists. Use --force to re-extract."],
      });
      continue;
    }

    if (!fs.existsSync(sourceFilePath)) {
      console.error(`  -> Failed: source file does not exist at ${sourceFilePath}`);
      failedCount++;
      fileReports.push({
        path: item.path,
        outputPath: targetRelative,
        docType: item.docType,
        title: item.title,
        status: "failed",
        chars: 0,
        pages: 0,
        nearEmptyPages: [],
        ocrUsed: false,
        warnings: ["File not found"],
        error: `File not found: ${sourceFilePath}`,
      });
      continue;
    }

    try {
      const ext = path.extname(sourceFilePath).toLowerCase().replace(/^\./, "");
      const buffer = fs.readFileSync(sourceFilePath);

      let markdownBody = "";
      let pagesCount = 1;
      let ocrUsed = false;
      const nearEmptyPages: number[] = [];

      if (ext === "pptx") {
        // PPTX extraction via jszip
        const pptxResult = await extractPptx(buffer);
        pagesCount = pptxResult.slides.length;
        const slideBlocks: string[] = [];

        pptxResult.slides.forEach((s) => {
          if (s.text.length < 50) {
            nearEmptyPages.push(s.slideNum);
          }
          const slideHeading = s.title
            ? `## Slide ${s.slideNum}: ${s.title}`
            : `## Slide ${s.slideNum}`;
          slideBlocks.push(`${slideHeading}\n\n${s.text}`);
        });

        markdownBody = slideBlocks.join("\n\n");
      } else if (ext === "docx") {
        // DOCX extraction via jszip
        const docxResult = await extractDocx(buffer);
        pagesCount = docxResult.pagesEstimate;
        markdownBody = docxResult.text;
      } else if (ext === "png" || ext === "jpg" || ext === "jpeg") {
        // Image extraction via Gemini Vision OCR
        ocrUsed = true;
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";
        const ocrText = await runGeminiVisionOcr(buffer, mimeType);
        markdownBody = ocrText;
        pagesCount = 1;
        if (ocrText.length < 50) {
          nearEmptyPages.push(1);
        }
      } else if (ext === "pdf") {
        // Determine whether PDF has a text layer using deterministic pdfjs extraction
        const pdfTextResult = await extractTextPdf(buffer);

        // If PDF contains >= 50 characters across pages, use deterministic text extraction
        if (pdfTextResult.totalChars >= 50) {
          pagesCount = pdfTextResult.pages.length;
          const pageBlocks: string[] = [];

          pdfTextResult.pages.forEach((p) => {
            if (p.text.length < 50) {
              nearEmptyPages.push(p.pageNum);
            }
            pageBlocks.push(`## Page ${p.pageNum}\n\n${p.text}`);
          });

          markdownBody = pageBlocks.join("\n\n");
        } else {
          // Image-only / scanned PDF: process via Gemini Vision OCR
          console.log(`  -> Text layer empty (< 50 chars). Routing to Gemini Vision OCR...`);
          ocrUsed = true;
          const ocrText = await runGeminiVisionOcr(buffer, "application/pdf");
          markdownBody = ocrText;
          pagesCount = Math.max(1, pdfTextResult.pages.length);
        }
      } else {
        throw new Error(`Unsupported file extension: .${ext}`);
      }

      // Assemble final document with # <title> heading
      const finalMarkdown = `# ${item.title}\n\n${markdownBody.trim()}\n`;

      // Ensure target directory exists
      fs.mkdirSync(path.dirname(targetOutputPath), { recursive: true });
      fs.writeFileSync(targetOutputPath, finalMarkdown, "utf-8");

      const warnings = computeWarnings(finalMarkdown, pagesCount, nearEmptyPages);
      extractedCount++;

      console.log(
        `  -> Extracted successfully: ${targetRelative} (${finalMarkdown.length} chars, ${pagesCount} pages/slides, OCR: ${ocrUsed})`
      );
      if (warnings.length > 0) {
        warnings.forEach((w) => console.log(`     Warning: ${w}`));
      }

      fileReports.push({
        path: item.path,
        outputPath: targetRelative,
        docType: item.docType,
        title: item.title,
        status: "extracted",
        chars: finalMarkdown.length,
        pages: pagesCount,
        nearEmptyPages,
        ocrUsed,
        warnings,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  -> Failed extracting ${item.path}: ${msg}`);
      failedCount++;
      fileReports.push({
        path: item.path,
        outputPath: targetRelative,
        docType: item.docType,
        title: item.title,
        status: "failed",
        chars: 0,
        pages: 0,
        nearEmptyPages: [],
        ocrUsed: false,
        warnings: ["Extraction failed"],
        error: msg,
      });
    }
  }

  const report: ExtractionReport = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    totalPlanned: planItems.length,
    included: includedItems.length,
    extracted: extractedCount,
    skipped: skippedCount,
    failed: failedCount,
    files: fileReports,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nExtraction report written to: ${reportPath}`);

  return report;
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith("extract.ts")) {
  const rawArgs = process.argv.slice(2);
  const force = rawArgs.includes("--force");
  const nonFlagArgs = rawArgs.filter((a) => a !== "--force");

  let sourceRoot: string | undefined;
  let planPath: string | undefined;
  let outputDir: string | undefined;
  let reportPath: string | undefined;

  for (let i = 0; i < nonFlagArgs.length; i++) {
    const arg = nonFlagArgs[i];
    if (arg === "--plan" && nonFlagArgs[i + 1]) {
      planPath = nonFlagArgs[++i];
    } else if (arg === "--output" && nonFlagArgs[i + 1]) {
      outputDir = nonFlagArgs[++i];
    } else if (arg === "--report" && nonFlagArgs[i + 1]) {
      reportPath = nonFlagArgs[++i];
    } else if (!sourceRoot) {
      sourceRoot = arg;
    } else if (!planPath) {
      planPath = arg;
    } else if (!outputDir) {
      outputDir = arg;
    } else if (!reportPath) {
      reportPath = arg;
    }
  }

  if (!sourceRoot) {
    console.error(
      "Usage: npm run extract -- <source-root-dir> [--plan local/plan.json] [--output local/extracted] [--report local/extraction_report.json] [--force]"
    );
    console.error(
      'Example: npm run extract -- "D:\\Academics & Study Material\\college_study_material\\SEM 4\\OS"'
    );
    process.exit(1);
  }

  runExtraction({ sourceRoot, planPath, outputDir, reportPath, force }).catch((err) => {
    console.error(`[extract] Fatal error: ${err.message}`);
    process.exit(1);
  });
}
