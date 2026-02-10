import mongoose from "../config/mongo.js";

const CallLogSchema = new mongoose.Schema(
    {
        agentName: String,
        customerName: String,
        dueAmount: String,
        dueDate: String,
        paymentRawResponse: String,

        paymentIntent: String,
        rescheduleDate: String,
        rescheduleTime: String,
        paymentMethod: String,

        callStatus: {
            type: String,
            enum: ["completed", "idle-timeout", "client-close", "agent-close", "error"],
            default: "completed",
        },

        meta: Object,
    },
    { timestamps: true }
);

export const CallLog = mongoose.model("CallLog", CallLogSchema);
