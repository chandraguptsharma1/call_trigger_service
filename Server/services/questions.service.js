import { openai } from "../config/openai.js";

const langLabel = (l) => (l === "hi" ? "Hindi" : l === "hinglish" ? "Hinglish" : "English");

export async function buildQuestions({ role, jd, lang, profile }) {
    const human = langLabel(lang);
    const resume = profile ? JSON.stringify(profile).slice(0, 4000) : "(none)";
    const prompt = `
Create 7 interview questions for a ${role || "Software Engineer"}.
Use candidate profile if available:
${resume}

Job description:
${jd || "(not provided)"}

Rules:
- Language: ${human}
- Concise & specific.
- Mix: 1 intro, 3 technical depth, 2 resume-based project, 1 behavioral.
- Return STRICT JSON array of strings.
`.trim();

    let out = [];
    try {
        const r = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.4,
            messages: [{ role: "user", content: prompt }]
        });
        const text = r.choices?.[0]?.message?.content || "[]";
        const m = text.match(/\[[\s\S]*\]/);
        out = m ? JSON.parse(m[0]) : [];
    } catch { }
    if (!Array.isArray(out) || out.length === 0) {
        out = [
            "Can you briefly introduce yourself?",
            "Walk me through a technical decision you made recently and why.",
            "Which tools or libraries are you strongest in for this role?",
            "Tell me about a challenging project and your exact role.",
            "Pick one project from your resume—biggest risk and mitigation?",
            "How do you handle tight deadlines and conflicting priorities?",
            "Do you have any questions for us?"
        ];
    }
    return out.slice(0, 7);
}
