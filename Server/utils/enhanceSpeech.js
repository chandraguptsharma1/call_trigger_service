// utils/enhanceSpeech.js
export function enhanceSpeech(text) {
    if (!text) return "";

    let enhanced = text;

    // छोटे pauses
    enhanced = enhanced.replace(/(\.|\?|!)/g, "$1 [pause 400ms]");

    // कुछ keywords को natural break देना
    enhanced = enhanced.replace(/skills/gi, "skills [pause 300ms]");
    enhanced = enhanced.replace(/experience/gi, "experience [pause 300ms]");

    // Greetings soft tone में
    if (/hello|hi|good morning/gi.test(enhanced)) {
        enhanced = `[soft] ${enhanced}`;
    }

    return enhanced;
}
