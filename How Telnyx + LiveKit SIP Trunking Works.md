 How Telnyx + LiveKit SIP Trunking Works

  The whole thing is a 3-step setup done once, then the trunk ID is reused forever.

---

  Concept First

  Your Server → LiveKit → (SIP Trunk) → Telnyx → PSTN → Real Phone

  LiveKit doesn't know how to reach the PSTN (real phone network). Telnyx does. The SIP trunk is the bridge between LiveKit and Telnyx. You configure it once, get a trunk ID (ST_xxxxx),
  and store it as an env var.

---

  Step 1 — Configure Telnyx (done on Telnyx dashboard / API)

  Three things on the Telnyx side:

  1a. Create an FQDN Connection (the SIP credentials Telnyx will use)
  curl -X POST [https://api.telnyx.com/v2/fqdn_connections](https://api.telnyx.com/v2/fqdn_connections)   
    -H "Authorization: Bearer $TELNYX_API_KEY"   
    -d '{
      "connection_name": "LiveKit trunk",
      "user_name": "my-username",     ← you pick this
      "password": "my-password",      ← you pick this
      "outbound": { "outbound_voice_profile_id": "..." }
    }'

# Response gives you a connection_id

  1b. Point that connection at LiveKit's SIP endpoint
  curl -X POST [https://api.telnyx.com/v2/fqdns](https://api.telnyx.com/v2/fqdns)   
    -d '{
      "connection_id": "",
      "fqdn": "vjnxecm0tjk.sip.livekit.cloud",  ← your LiveKit SIP URL (from LiveKit dashboard)
      "port": 5060
    }'

  1c. Attach your Telnyx phone number to the connection
  curl -X PATCH [https://api.telnyx.com/v2/phone_numbers/](https://api.telnyx.com/v2/phone_numbers/)[ ](https://api.telnyx.com/v2/phone_numbers/)  
    -d '{ "connection_id": "" }'

  Now Telnyx knows: "when I get a call to/from this number, use these SIP credentials, and route to LiveKit."

---

  Step 2 — Create the OutboundTrunk on LiveKit (run once, gives you the ST_ ID)

  const outboundTrunk = await sipClient.createSipOutboundTrunk(
    'Telnyx Outbound',
    'sip.telnyx.com',           // Telnyx's SIP server address
    ['+15105550100'],            // Your Telnyx phone number (caller ID)
    {
      auth_username: 'my-username',   // ← same username you set in Step 1a
      auth_password: 'my-password',   // ← same password you set in Step 1a
    }
  );

  console.log(outboundTrunk.sipTrunkId);  // → "ST_xxxxxxxxxxxxxxxxxx"

  This registers LiveKit with Telnyx using the credentials from Step 1. LiveKit saves this trunk configuration and gives you back the ST_ ID.

  You only run this once. The ID goes into your .env:
  LIVEKIT_SIP_TRUNK_ID=ST_xxxxxxxxxxxxxxxxxx

---

  Step 3 — Use the trunk ID at runtime to dial phones

  Every time you start a call in server.ts:
  await sipClient.createSipParticipant(
    env.LIVEKIT_SIP_TRUNK_ID,   // "ST_xxxxx" — tells LiveKit which trunk to use
    "+91XXXXXXXXXX",             // the number to dial
    "capture-abc123",            // which LiveKit room to put them in
    { waitUntilAnswered: true }
  );

  LiveKit looks up the trunk → finds Telnyx credentials → sends a SIP INVITE to sip.telnyx.com with auth → Telnyx accepts and dials the real phone via PSTN.

---

  The Mental Model

  ┌─────────────┐      ST_xxxxx      ┌──────────┐      SIP creds      ┌────────┐      PSTN      ┌───────────┐
  │  server.ts  │ ────────────────▶ │  LiveKit  │ ─────────────────▶ │ Telnyx │ ─────────────▶ │ Real Phone │
  │             │  createSipParticipant  │          │  auth_user/pass    │        │  dials number  │           │
  └─────────────┘                   └──────────┘                     └────────┘                └───────────┘

- ST_xxxxx = LiveKit's internal ID for "use these Telnyx credentials"
- Telnyx = the PSTN gateway that actually dials real phones
- SIP = the protocol they speak to each other

