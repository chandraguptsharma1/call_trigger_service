export function notFound(req, res, next) {
    res.status(404).json({ ok: false, error: "Route not found" });
}
export function errorHandler(err, req, res, next) {
    console.error("❌", err);
    res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
}
