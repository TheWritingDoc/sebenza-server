// MongoDB: Create Transaction Request with job images
app.post("/api/transactions/request", auth, upload.array("jobImages", 5), async (req, res) => {
  try {
    const { serviceId, providerId, randAmount, description } = req.body;
    
    const requester = await User.findById(req.userId);
    if (!requester) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const amount = parseFloat(randAmount) || 50;
    
    if (requester.randBalance < amount) {
      return res.status(400).json({ error: "Insufficient Rand balance" });
    }

    requester.randBalance -= amount;
    requester.escrowRand += amount;
    await requester.save();

    const jobDescriptionImages = req.files ? req.files.map(file => ({
      url: `/uploads/proof/${file.filename}`,
      caption: description || "",
      uploadedAt: new Date()
    })) : [];

    const transaction = new Transaction({
      requesterId: req.userId,
      providerId,
      serviceId,
      randAmount: amount,
      jobDescriptionImages,
      proofImages: [],
      status: "pending",
      escrowStatus: "held"
    });

    await transaction.save();

    res.json({
      message: "Service requested. Rand held in escrow.",
      transactionId: transaction._id,
      jobImages: jobDescriptionImages.length
    });
  } catch (err) {
    console.error("Request error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});
