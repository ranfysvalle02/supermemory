import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const messagePartSchema = new Schema(
	{
		type: { type: String, required: true },
		text: { type: String, default: "" },
	},
	{ _id: false },
)

const threadMessageSchema = new Schema(
	{
		id: { type: String, default: () => nanoid() },
		role: { type: String, required: true },
		parts: { type: [messagePartSchema], default: [] },
		createdAt: { type: Date, default: Date.now },
	},
	{ _id: false },
)

const threadSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		orgId: { type: String, required: true, index: true },
		projectId: { type: String, default: null },
		title: { type: String, default: "New Chat" },
		messages: { type: [threadMessageSchema], default: [] },
	},
	{
		timestamps: true,
		toJSON: {
			transform(_doc, ret: Record<string, unknown>) {
				ret.id = ret._id
				delete ret._id
				delete ret.__v
				return ret
			},
		},
	},
)

threadSchema.index({ orgId: 1, projectId: 1 })

export const ThreadModel = mongoose.model("Thread", threadSchema)
