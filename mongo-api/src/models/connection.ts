import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const connectionSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		provider: { type: String, required: true },
		orgId: { type: String, required: true, index: true },
		userId: { type: String, required: true },
		email: { type: String, default: null },
		documentLimit: { type: Number, default: 10000 },
		containerTags: { type: [String], default: [] },
		accessToken: { type: String, default: null },
		refreshToken: { type: String, default: null },
		expiresAt: { type: Date, default: null },
		metadata: { type: Schema.Types.Mixed, default: {} },
	},
	{
		timestamps: { createdAt: true, updatedAt: false },
		toJSON: {
			transform(_doc, ret: Record<string, unknown>) {
				ret.id = ret._id
				delete ret._id
				delete ret.__v
				delete ret.accessToken
				delete ret.refreshToken
				return ret
			},
		},
	},
)

export const ConnectionModel = mongoose.model("Connection", connectionSchema)
