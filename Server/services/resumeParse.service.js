import fs from "fs";

const ext = (p) => (p.split(".").pop() || "").toLowerCase();

export async function extractText(filePath, mimetype = "", originalname = "") {
    const e = ext(originalname || filePath);

    if (mimetype.includes("pdf") || e === "pdf") {
        // ✅ try deep import first to skip index self-test
        let pdfParse;
        try {
            ({ default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js"));
        } catch {
            ({ default: pdfParse } = await import("pdf-parse")); // fallback
        }
        const buf = fs.readFileSync(filePath);
        const { text } = await pdfParse(buf);
        return text || "";
    }

    if (
        mimetype.includes("officedocument") ||
        mimetype.includes("word") ||
        e === "docx"
    ) {
        const { default: mammoth } = await import("mammoth");
        const buf = fs.readFileSync(filePath);
        const { value } = await mammoth.extractRawText({ buffer: buf });
        return value || "";
    }

    // .txt fallback
    return fs.readFileSync(filePath, "utf8");
}
