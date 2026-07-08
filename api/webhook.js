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
      console.log("WEBHOOK PAYLOAD:", JSON.stringify(body, null, 2));

      const value = body.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      // Status updates (delivery/read receipts) — ignore
      if (!message) {
        return res.status(200).send("ok");
      }

      const messageId = message.id;
      const phoneNumber = message.from || "";
      const bsuid = message.from_user_id || contact?.user_id || "";
      const senderName = contact?.profile?.name || "";
      const timestamp = new Date(parseInt(message.timestamp) * 1000).toISOString();
      const messageType = message.type || "text";
      const bodyText = message.text?.body || `[${messageType} message]`;
      const replyTo = message.context?.id || null;
      const hasAttachment = ["image", "document", "audio", "video", "sticker"].includes(messageType);

      // Extract media_id if present
      let mediaId = null;
      if (hasAttachment) {
        mediaId = message[messageType]?.id || null;
      }

      // Look up manufacturer by BSUID first, then phone
      const manufacturerId = await findManufacturer(bsuid, phoneNumber);

      // Create the message in Airtable
      await createAirtableMessage({
        messageId,
        phoneNumber,
        bsuid,
        senderName,
        timestamp,
        body: bodyText,
        messageType,
        replyTo,
        hasAttachment,
        mediaId,
        manufacturerId,
      });

      return res.status(200).send("ok");
    } catch (err) {
      console.error("Error processing webhook:", err);
      return res.status(200).send("ok");
    }
  }

  return res.status(405).send("Method not allowed");
}

async function findManufacturer(bsuid, phoneNumber) {
  if (bsuid) {
    const found = await searchManufacturer("WhatsApp BSUIDs", bsuid);
    if (found) return found;
  }
  if (phoneNumber) {
    const found = await searchManufacturer("WhatsApp Numbers", phoneNumber);
    if (found) return found;
  }
  return null;
}

async function searchManufacturer(fieldName, value) {
  const formula = encodeURIComponent(`FIND("${value}", {${fieldName}})`);
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

  if (msg.phoneNumber) fields["From"] = msg.phoneNumber;
  if (msg.bsuid) fields["Sender BSUID"] = msg.bsuid;
  if (msg.senderName) fields["Sender Name"] = msg.senderName;
  if (msg.manufacturerId) fields["Manufacturer"] = [msg.manufacturerId];
  if (msg.replyTo) fields["Reply To Message ID"] = msg.replyTo;

  // If there's media, point Airtable at our proxy endpoint
  if (msg.hasAttachment && msg.mediaId) {
    const baseUrl = process.env.PUBLIC_BASE_URL || "https://jsk-whatsapp-webhook1.vercel.app";
    fields["Attachments"] = [
      { url: `${baseUrl}/api/media?id=${msg.mediaId}` }
    ];
  }

  const response = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/WhatsApp%20Messages`,
    {
      method: "POST",
      headers: {
        Authorization:
