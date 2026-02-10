import fs from "fs";
export const writeText = (fp, text) => fs.writeFileSync(fp, text, "utf8");
export const writeJSON = (fp, obj) => fs.writeFileSync(fp, JSON.stringify(obj, null, 2), "utf8");
export const readJSON = (fp) => JSON.parse(fs.readFileSync(fp, "utf8"));
