export default async function handler(req, res) {
  const mediaId = req.query.id;

  if (!mediaId) {
    return res.status(400).send("Missing media id");
  }

  try {
    // Step 1: Get the media URL from Meta
    const metaLookupResponse = await fetch(
      `https://graph.facebook.com/v22.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      }
    );

    if (!metaLookupResponse.ok) {
      const err = await metaLookupResponse.text();
      console.error("Meta lookup failed:", metaLookupResponse.status, err);
      return res.status(502).send("Failed to look up media");
    }

    const mediaInfo = await metaLookupResponse.json();
    const mediaUrl = mediaInfo.url;
    const mimeType = mediaInfo.mime_type || "application/octet-stream";

    if (!mediaUrl) {
      return res.status(404).send("Media URL not found");
    }

    // Step 2: Download the file from Meta (needs auth header)
    const fileResponse = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    });

    if (!fileResponse.ok) {
      const err = await fileResponse.text();
      console.error("Meta file download failed:", fileResponse.status, err);
      return res.status(502).send("Failed to download media");
    }

    // Step 3: Stream the file back to whoever requested (Airtable)
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

    // Determine a reasonable filename extension from mime type
    const extension = mimeType.split("/")[1]?.split(";")[0] || "bin";
    const filename = `whatsapp-${mediaId}.${extension}`;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(fileBuffer);
  } catch (err) {
    console.error("Error in /api/media:", err);
    return res.status(500).send("Internal error");
  }
}
