// Contact model (jo aapne banaya hai) - SAHI HAI
// Lekin server code mein bhi changes karne honge

// Frontend contacts loading ka naya system
socket.on('loadContacts', async (userId, callback) => {
  try {
    const contacts = await Contact.find({ userId })
      .populate('contactId', 'name phone isOnline');
    
    const contactData = contacts.map(contact => ({
      _id: contact.contactId._id,
      name: contact.contactId.name,
      phone: contact.contactId.phone,
      isOnline: contact.contactId.isOnline
    }));
    
    callback(contactData);
  } catch (err) {
    console.error("Load contacts error:", err);
    callback([]);
  }
});