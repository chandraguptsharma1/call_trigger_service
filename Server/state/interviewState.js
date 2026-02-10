export const state = {
    RESUME_TEXT: "",
    PROFILE: null,
    QUESTIONS: [],
    CONFIG: {
        recruiterName: "AI Recruiter",
        companyName: "Acme Corp",
        companyAbout: "We build scalable digital products for global clients.",
        role: "Software Engineer",
        jd: "",
        lang: "en"
    },
    FLOW: { started: false, introDone: false, current: 0, finished: false }
};
export function resetFlow() {
    state.FLOW = { started: false, introDone: false, current: 0, finished: false };
    state.QUESTIONS = [];
}
