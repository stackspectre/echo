/**
 * db.js — MongoDB data layer for Echo (via Mongoose).
 *
 * Pure JavaScript — no native compilation, no Python, no build tools.
 * Just needs a running MongoDB (local install or MongoDB Atlas) and a
 * MONGODB_URI in your .env.
 */

const mongoose = require("mongoose");

const replySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const feedbackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true },
    likedBy: { type: [String], default: [] }, // anonymous client ids that liked this
    replies: { type: [replySchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const Feedback = mongoose.model("Feedback", feedbackSchema);

async function connectDb() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/echo_feedback";
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[db] connected to MongoDB");
}

function isValidId(id) {
  return mongoose.isValidObjectId(id);
}

function toClientReply(r) {
  return { id: r._id.toString(), name: r.name, text: r.text, time: r.createdAt.getTime() };
}

function toClientFeedback(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    rating: doc.rating,
    text: doc.text,
    likes: doc.likedBy.length,
    time: doc.createdAt.getTime(),
    replies: doc.replies.map(toClientReply).sort((a, b) => a.time - b.time),
  };
}

/** Full feed, newest/top/liked, optional text search — used for the public wall. */
async function listFeedback({ sort = "newest", q = "" } = {}) {
  const filter = q
    ? { $or: [{ name: { $regex: escapeRegex(q), $options: "i" } }, { text: { $regex: escapeRegex(q), $options: "i" } }] }
    : {};

  const docs = await Feedback.find(filter);
  const items = docs.map(toClientFeedback);

  if (sort === "top") items.sort((a, b) => b.rating - a.rating || b.time - a.time);
  else if (sort === "liked") items.sort((a, b) => b.likes - a.likes || b.time - a.time);
  else items.sort((a, b) => b.time - a.time);

  return items;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createFeedback({ name, email, rating, text }) {
  const doc = await Feedback.create({ name, email, rating, text });
  return toClientFeedback(doc);
}

async function addReply(feedbackId, { name, text }) {
  if (!isValidId(feedbackId)) return null;
  const doc = await Feedback.findById(feedbackId);
  if (!doc) return null;
  doc.replies.push({ name, text });
  await doc.save();
  return toClientReply(doc.replies[doc.replies.length - 1]);
}

/** Toggles a like for (feedbackId, clientId). Returns { liked, likes } or null if feedback is gone. */
async function toggleLike(feedbackId, clientId) {
  if (!isValidId(feedbackId)) return null;
  const doc = await Feedback.findById(feedbackId);
  if (!doc) return null;

  const idx = doc.likedBy.indexOf(clientId);
  let liked;
  if (idx >= 0) {
    doc.likedBy.splice(idx, 1);
    liked = false;
  } else {
    doc.likedBy.push(clientId);
    liked = true;
  }
  await doc.save();
  return { liked, likes: doc.likedBy.length };
}

async function deleteFeedback(id) {
  if (!isValidId(id)) return false;
  const res = await Feedback.findByIdAndDelete(id);
  return !!res;
}

async function deleteReply(replyId) {
  if (!isValidId(replyId)) return null;
  const doc = await Feedback.findOne({ "replies._id": replyId });
  if (!doc) return null;
  const feedbackId = doc._id.toString();
  doc.replies.id(replyId).deleteOne();
  await doc.save();
  return { feedbackId, replyId };
}

async function getStats() {
  const total = await Feedback.countDocuments({});

  const avgAgg = await Feedback.aggregate([{ $group: { _id: null, avg: { $avg: "$rating" } } }]);
  const avgRating = avgAgg.length ? Math.round(avgAgg[0].avg * 10) / 10 : 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const feedbackToday = await Feedback.countDocuments({ createdAt: { $gte: startOfDay } });

  const repliesTodayAgg = await Feedback.aggregate([
    { $unwind: "$replies" },
    { $match: { "replies.createdAt": { $gte: startOfDay } } },
    { $count: "count" },
  ]);
  const repliesToday = repliesTodayAgg.length ? repliesTodayAgg[0].count : 0;

  const totalRepliesAgg = await Feedback.aggregate([
    { $project: { count: { $size: "$replies" } } },
    { $group: { _id: null, total: { $sum: "$count" } } },
  ]);
  const totalReplies = totalRepliesAgg.length ? totalRepliesAgg[0].total : 0;

  return { total, avgRating, feedbackToday, repliesToday, totalReplies };
}

module.exports = {
  connectDb,
  listFeedback,
  createFeedback,
  addReply,
  toggleLike,
  deleteFeedback,
  deleteReply,
  getStats,
};
