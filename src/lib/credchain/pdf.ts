/** Tiny PDF writer (Helvetica, WinAnsi). Runs in the browser. */

function esc(s: string): string {
  const clean = s.replace(/[^\x20-\x7E]/g, "?");
  return clean.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export type PdfLine = { text: string; size?: number; bold?: boolean; x?: number; y?: number };

export function pdfBytes(title: string, body: string[]): Uint8Array {
  const pages: string[] = [];
  let cmds: string[] = [];
  let y = 800;
  const flush = () => {
    pages.push(cmds.join("\n"));
    cmds = [];
    y = 800;
  };
  const write = (text: string, size: number, bold: boolean, x = 48) => {
    if (y < 56) flush();
    const font = bold ? "/F2" : "/F1";
    cmds.push(`BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj ET`);
    y -= size + 6;
  };
  write(title, 16, true);
  y -= 4;
  for (const line of body) write(line, 10, false);
  if (cmds.length) pages.push(cmds.join("\n"));

  const objects: string[] = [];
  const fontRegular = 3;
  const fontBold = 4;
  let id = 5;
  const kids: string[] = [];
  for (const raw of pages) {
    const content = raw.endsWith("\n") ? raw : `${raw}\n`;
    const pageId = id;
    const contentId = id + 1;
    id += 2;
    kids.push(`${pageId} 0 R`);
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >> endobj`,
    );
    objects.push(`${contentId} 0 obj << /Length ${content.length} >> stream\n${content}endstream endobj`);
  }
  const catalog = `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`;
  const pageTree = `2 0 obj << /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >> endobj`;
  const f1 = `3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`;
  const f2 = `4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`;
  const all = [catalog, pageTree, f1, f2, ...objects];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of all) {
    offsets.push(out.length);
    out += obj + "\n";
  }
  const xrefAt = out.length;
  let xref = `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= all.length; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += xref;
  out += `trailer << /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(out);
}

export function downloadBytes(filename: string, mime: string, data: BlobPart) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return `\uFEFF${[headers, ...rows].map((r) => r.map(cell).join(",")).join("\n")}`;
}
