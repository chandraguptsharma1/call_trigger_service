import mongoose from "mongoose";

const MONGO_URI =
    process.env.MONGO_URI || "mongodb+srv://cgcosmos1100:z3wjniNCVyE03ezt@3g-cluster.qd35h.mongodb.net/voice_ai";

export async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI, {
            autoIndex: true,
        });

        console.log("🍃 MongoDB connected successfully");
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1);
    }
}

export default mongoose;
