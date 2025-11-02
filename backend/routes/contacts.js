import express from "express";
import Contact from "../models/Contact.js";
const router = express.Router();

// Get contacts for a user
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  const contacts = await Contact.find({ userId });
  res.json(contacts);
});

// Add new contact
router.post("/", async (req, res) => {
  const { userId, name, phone } = req.body;
  const contact = new Contact({ userId, contactId: phone, name, phone });
  await contact.save();
  res.json(contact);
});

export default router;
