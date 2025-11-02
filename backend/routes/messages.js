import express from "express";
import Message from "../models/Message.js";
const router = express.Router();

// Get messages between two users
router.get("/:userId/:contactId", async (req, res) => {
  const { userId, contactId } = req.params;
  const msgs = await Message.find({
    $or: [
      { senderId: userId, receiverId: contactId },
      { senderId: contactId, receiverId: userId },
    ],
  }).sort({ createdAt: 1 });
  res.json(msgs);
});

// Send a message
router.post("/", async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json(msg);
});

export default router;
