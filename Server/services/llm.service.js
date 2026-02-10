import { openai } from "../config/openai.js";

export function normalizeLangLabel(norm) {
    norm = (norm || "").toLowerCase();
    return norm === "hi" ? "Hindi" : norm === "hinglish" ? "Hinglish" : "English";
}

export async function getHelloLine({ lang = "en" } = {}) {
    const human = normalizeLangLabel(lang);
    const msg = `Give a single short ${human} line to start a call: "Hello, can you hear me clearly?"`;
    const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [{ role: "user", content: msg }]
    });
    return r.choices?.[0]?.message?.content?.replace(/(^"|"$)/g, "") || "Hello, can you hear me clearly?";
}

export async function buildIntroScript({ recruiterName, companyName, companyAbout, role, lang = "en", profile }) {
    const human = normalizeLangLabel(lang);
    const prompt = `
You are a recruiter beginning an interview. Language: ${human}.
Return STRICT JSON ONLY: {"identity":"","company":"","role":"","ask_intro":""}
- identity: Your name & company in one natural line.
- company: One-liner about what the company does.
- role: One-liner about the position & expectations.
- ask_intro: Ask the candidate to introduce themselves briefly.

Context:
Recruiter: ${recruiterName || "Recruiter"}
Company: ${companyName || "Our Company"}
About: ${companyAbout || "We build scalable digital products for global clients."}
Role: ${role || "Software Engineer"}
Candidate: ${(profile?.name || "Candidate")}
`.trim();

    const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }]
    });
    const t = r.choices?.[0]?.message?.content || "{}";
    const m = t.match(/{[\s\S]*}/);
    return m ? JSON.parse(m[0]) : {};
}

export async function guardrail({ text, lang = "en", role = "Software Engineer", profile }) {
    const human = normalizeLangLabel(lang);
    const snippet = profile ? JSON.stringify(profile).slice(0, 1200) : "";
    const prompt = `
You are an interview guardrail + coach. Language: ${human}. Role: ${role}.
Candidate profile (if any): ${snippet || "(none)"}

Return STRICT JSON ONLY:
{"intent":"","recruiter_reply":"","coach":""}

- intent: one of ["answer_on_topic","question_on_topic","smalltalk","off_topic","nonsense","inappropriate"]
- recruiter_reply: 1–2 sentence polite interviewer response in ${human}
- coach: ≤18 words suggestion for candidate's next answer in ${human}

Candidate said: """${text}"""
`.trim();

    const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }]
    });
    const t = r.choices?.[0]?.message?.content || "{}";
    const m = t.match(/{[\s\S]*}/);
    return m ? JSON.parse(m[0]) : { intent: "answer_on_topic", recruiter_reply: "Thank you. Could you elaborate a bit more?", coach: "Share results and your exact role." };
}
