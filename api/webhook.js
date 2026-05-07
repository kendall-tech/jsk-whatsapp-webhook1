export default async function handler(req, res) {
  // Meta's verification handshake (GET request)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // Incoming WhatsApp message (POST request)
  if (req.method === "POST") {
    try {
      const body = req.body;
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];

      // Status updates (delivery/read receipts) — ignore
      if (!message) {
        return res.status(200).send("ok");
      }

      const messageId = message.id;
      const from = message.from;
      const timestamp = new Date(parseInt(message.timestamp) * 1000).toISOString();
      const messageType = message.type || "text";
      const bodyText = message.text?.body || `[${messageType} message]`;
      const replyTo = message.context?.id || null;
      const hasAttachment = ["image", "document", "audio", "video", "sticker"].includes(messageType);

      // Look up manufacturer by WhatsApp number
      const manufacturerId = await findManufacturer(from);

      // Create the message in Airtable
      await createAirtableMessage({
        messageId,
        from,
        timestamp,
        body: bodyText,
        messageType,
        replyTo,
        hasAttachment,
        manufacturerId,
      });

      return res.status(200).send("ok");
    } catch (err) {
      console.error("Error processing webhook:", err);
      // Always return 200 so Meta doesn't retry-storm
      return res.status(200).send("ok");
    }
  }

  return res.status(405).send("Method not allowed");
}

async function findManufacturer(phoneNumber) {
  const formula = encodeURIComponent(`FIND("${phoneNumber}", {WhatsApp Numbers})`);
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Manufacturers?filterByFormula=${formula}&maxRecords=1`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.records?.[0]?.id || null;
}

async function createAirtableMessage(msg) {
  const fields = {
    "Message ID": msg.messageId,
    "Timestamp": msg.timestamp,
    "Direction": "inbound",
    "Body": msg.body,
    "Has Attachment": msg.hasAttachment,
    "Attachment Type": msg.hasAttachment ? msg.messageType : "none",
    "Style Code Source": "unknown",
    "Needs Review": true,
  };

  if (msg.manufacturerId) {
    fields["Manufacturer"] = [msg.manufacturerId];
  }

  if (msg.replyTo) {
    fields["Reply To Message ID"] = msg.replyTo;
  }

  const response = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/WhatsApp%20Messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error("Airtable error:", response.status, errText);
  }
}
