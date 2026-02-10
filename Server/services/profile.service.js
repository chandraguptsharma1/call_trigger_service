import { openai } from "../config/openai.js";

const PROFILE_PROMPT = (resume) => `
Extract a structured candidate profile from the resume text below.

Return STRICT JSON ONLY with exactly these keys:
{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "headline": "",
  "years_experience": 0,
  "skills": [],
  "top_projects": [
    { "title": "", "tech": [], "summary": "" }
  ],
  "education": [
    { "degree": "", "branch": "", "institute": "", "year": "" }
  ],
  "links": { "github": "", "portfolio": "", "linkedin": "" }
}

Rules:
- Fill what you can; unknown -> "" or [] or 0.
- Skills: 8–15 high-signal items, lowercase.
- Summaries <= 30 words.

Resume:
"""${resume.slice(0, 120000)}"""
`.trim();

export async function extractProfile(resumeText) {
    let content = "";
    const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [{ role: "user", content: PROFILE_PROMPT(resumeText) }],
    });
    content = r.choices?.[0]?.message?.content || "";
    const m = content.match(/{[\s\S]*}/);
    return m ? JSON.parse(m[0]) : {};
}
